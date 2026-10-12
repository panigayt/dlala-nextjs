'use client';

// One-to-one chat thread — mirrors js/chat.js.
// Features: live messages, text/photo (R2) sends, price proposals,
// phone-request flow (3 declines = permanent block), deal confirmation,
// user block, account-block lockdown, sold-state gating, support threads.
// All user-facing strings verbatim from js/chat.js CHAT_L10N.ar and
// js/i18n.ar.js. Chat photos go to R2 ONLY (never Firebase Storage).

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  useRequireAuth,
  LoadingSpinner,
  CompatDocSnap,
  FirebaseClient,
  CompatUser,
  btnSecondaryCls,
} from '@/lib/firebase';
// 11 Oct 2026: withTimeout now in @/lib/timeout — no firebase-compat import.
import { withTimeout } from '@/lib/timeout';
import { formatPrice } from '@/lib/firestore';
import { useLang, getLang, type Lang } from '@/lib/i18n';
import { chatSt } from './chat-strings';

const CONFIRM_DEAL_URL =
  'https://europe-west3-dlala-85cea.cloudfunctions.net/confirmDeal';
const TOGGLE_BLOCK_URL =
  'https://europe-west3-dlala-85cea.cloudfunctions.net/toggleBlock';

interface Msg {
  id: string;
  senderId: string;
  text: string;
  at: unknown;
  isSystem: boolean;
  systemKind?: string;
  systemArgs?: Record<string, string>;
  imageUrl?: string;
  proposal?: { amount: number; status: string };
  readAt?: unknown;
  _sending?: boolean;
}

interface ConvData {
  id: string;
  participants: string[];
  listingId?: string;
  buyerId?: string;
  sellerId?: string;
  phoneRequestBy?: string;
  phoneRequestStatus?: string;
  phoneRequestCount?: number;
  declinesByRequester?: Record<string, number>;
  dealConfirmPending?: boolean;
  dealConfirmedByBuyer?: boolean;
  hiddenFor?: string[];
}

function tsMs(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object') {
    const o = v as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') {
      try {
        return o.toDate().getTime();
      } catch {
        return 0;
      }
    }
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  return 0;
}

function cleanText(s: string): string {
  let out = String(s || '').replace(/[‪-‮⁦-⁩]/g, '');
  if (out.length > 2000) out = out.slice(0, 2000);
  return out.trim();
}

// Arabic-Indic digits -> ASCII, then 9-20 digits — mirrors chat.js.
function normalizePhone(s: string): string {
  const ar = '٠١٢٣٤٥٦٧٨٩';
  let d = String(s || '').replace(/[٠-٩]/g, (ch) => String(ar.indexOf(ch)));
  d = d.replace(/\D/g, '');
  return d.length >= 9 && d.length <= 20 ? d : '';
}

function localizedTitle(title: unknown): string {
  if (!title) return '';
  if (typeof title === 'string') return title;
  if (typeof title === 'object') {
    const o = title as Record<string, string>;
    return o.ar || o.fr || o.en || '';
  }
  return '';
}

function dayLabel(ts: number, lang: Lang): string {
  const d = new Date(ts);
  const now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return chatSt(lang, 'today');
  if (diff === 1) return chatSt(lang, 'yesterday');
  // Legacy parity (js/chat.js:941): LANG === 'ar' ? 'ar-DZ' : LANG
  return d.toLocaleDateString(lang === 'ar' ? 'ar-DZ' : lang);
}

function fmtChatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function systemText(m: Msg, lang: Lang): string {
  const kind = m.systemKind || '';
  const args = m.systemArgs || {};
  switch (kind) {
    case 'phone_requested':
      return (args.name || '') + ' ' + chatSt(lang, 'phoneRequestedSuffix');
    case 'phone_accepted':
      return chatSt(lang, 'phoneAcceptedMsg');
    case 'phone_declined':
      return chatSt(lang, 'phoneDeclinedMsg');
    case 'phone_shared':
      return chatSt(lang, 'phoneShared');
    case 'support_greeting':
      return chatSt(lang, 'supportGreeting');
    case 'support_autoreply':
      return chatSt(lang, 'supportAutoReply');
    default:
      return m.text || '';
  }
}

function proposalStatusText(status: string, lang: Lang): string {
  return status === 'accepted'
    ? chatSt(lang, 'proposalAccepted')
    : status === 'refused'
      ? chatSt(lang, 'proposalRefused')
      : chatSt(lang, 'proposalPending');
}

// Phone flow state — pure derivation, mirrors chat.js phoneFlowState.
interface PhoneFlow {
  pendingBy: string;
  acceptedBy: string;
  declines: Record<string, number>;
  sharedBy: Record<string, boolean>;
  myBlocked: boolean;
}
function phoneFlowState(
  conv: ConvData | null,
  messages: Msg[],
  myUid: string,
  extraShared: Record<string, boolean>
): PhoneFlow {
  const st: PhoneFlow = {
    pendingBy: '',
    acceptedBy: '',
    declines: {},
    sharedBy: {},
    myBlocked: false,
  };
  for (const m of messages || []) {
    if (!m || !m.isSystem) continue;
    const k = m.systemKind || '';
    const s = m.senderId || '';
    if (k === 'phone_requested') {
      st.pendingBy = s;
    } else if (k === 'phone_declined') {
      const slot = conv
        ? { status: conv.phoneRequestStatus || '', by: conv.phoneRequestBy || '' }
        : { status: '', by: '' };
      const target =
        st.pendingBy || (slot.status === 'declined' && slot.by ? slot.by : '');
      if (target) {
        st.declines[target] = (st.declines[target] || 0) + 1;
        st.pendingBy = '';
      }
    } else if (k === 'phone_accepted') {
      st.pendingBy = '';
    } else if (k === 'phone_shared') {
      if (s) st.sharedBy[s] = true;
    }
  }
  const status = (conv && conv.phoneRequestStatus) || 'none';
  const by = (conv && conv.phoneRequestBy) || '';
  if (status === 'requested') st.pendingBy = by;
  else if (status === 'accepted') st.acceptedBy = by;
  else if (status === 'declined') st.pendingBy = '';
  for (const u of Object.keys(extraShared))
    if (extraShared[u]) st.sharedBy[u] = true;
  const officialDeclines = Number(
    (conv && conv.declinesByRequester && conv.declinesByRequester[myUid]) || 0
  );
  st.myBlocked = officialDeclines >= 3 || (st.declines[myUid] || 0) >= 3;
  return st;
}

function mintMessageId(myUid: string): string {
  return (
    'm_' +
    myUid +
    '_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 8)
  );
}

function ChatInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const convId = (params.id as string) || '';
  const authState = useRequireAuth();
  // Language: mirrors js/chat.js — .chat-lang switcher + onLangChange re-render
  // (React re-renders from state on switch; st() always reads the current lang).
  const { lang, setLang } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const st = (k: string) => chatSt(lang, k);

  const [conv, setConv] = useState<ConvData | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [otherName, setOtherName] = useState('');
  const [listingChip, setListingChip] = useState<{
    title: string;
    photo: string;
    id: string;
  } | null>(null);
  const [listingSold, setListingSold] = useState(false);
  const [listingGone, setListingGone] = useState(false);
  const [amBlocked, setAmBlocked] = useState(false);
  const [blockUntilMs, setBlockUntilMs] = useState<number | null>(null);
  const [userBlockSevered, setUserBlockSevered] = useState(false);
  const [iBlockedThem, setIBlockedThem] = useState(false);
  const [revealSharedBy, setRevealSharedBy] = useState<Record<string, boolean>>(
    {}
  );
  const [input, setInput] = useState('');
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalAmt, setProposalAmt] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  // 11 Oct 2026: tracks the uploaded R2 URL across the sendPhoto flow so a
  // failed send retains it for retry (was orphaned + retry was a no-op).
  const publicUrlRef = useRef<string | null>(null);
  // 11 Oct 2026: prevents double-tap duplicate deal confirmations.
  const dealConfirmInFlightRef = useRef(false);
  const [statusBar, setStatusBar] = useState<{
    mode: 'info' | 'error';
    text: string;
  } | null>(null);
  const [failedSend, setFailedSend] = useState<{
    text?: string;
    imageUrl?: string | null;
    proposal?: number | null;
    mid: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // "New messages" pill: shows when messages arrive while the user is
  // scrolled up reading history (legacy js/chat.js parity).
  const [showPill, setShowPill] = useState(false);

  const clientRef = useRef<FirebaseClient | null>(null);
  // 11 Oct 2026: phone flow in-flight guard.
  const phoneBusy = useRef(false);
  const userRef = useRef<CompatUser | null>(null);
  const convRef = useRef<ConvData | null>(null);
  const msgsRef = useRef<Msg[]>([]);
  const unsubsRef = useRef<(() => void)[]>([]);
  // js/chat.js listenersActive parity: listeners attach exactly once —
  // no duplicates, no leaks across re-subscribes (visibility return).
  const listenersActiveRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const lastSendAtRef = useRef(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const openedRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  // js/chat.js unsubscribeAll parity: detach the Firestore listeners
  // (conversation doc + messages query). Called on effect cleanup,
  // on pagehide, and while the page is hidden.
  const unsubscribeAll = useCallback(() => {
    for (const u of unsubsRef.current) {
      try {
        u();
      } catch {
        /* noop */
      }
    }
    unsubsRef.current = [];
    listenersActiveRef.current = false;
  }, []);

  // js/chat.js subscribeAll parity: attach the conversation + messages
  // listeners exactly once (listenersActive guard) — no duplicates when
  // re-subscribing after the tab becomes visible again.
  const subscribeAll = useCallback(
    (client: FirebaseClient) => {
      if (listenersActiveRef.current) return;
      listenersActiveRef.current = true;
      const { db, fsMod } = client;
      const unsubs: (() => void)[] = [];
      unsubs.push(
        fsMod.onSnapshot(
          fsMod.doc(db, `conversations/${convId}`),
          (s) => {
            if (s.exists()) {
              const d = {
                id: s.id,
                ...((s.data() || {}) as object),
              } as ConvData;
              convRef.current = d;
              setConv(d);
            }
          },
          () => {}
        )
      );
      unsubs.push(
        fsMod.onSnapshot(
          fsMod.query(
            fsMod.collection(db, 'conversations', convId, 'messages'),
            // 11 Oct 2026: newest 100 (was oldest 100 — new messages never arrived).
            fsMod.orderBy('at', 'desc'),
            fsMod.limit(100)
          ),
            (snap2) => {
              // desc → reverse for chronological display (legacy parity).
              const list: Msg[] = snap2.docs
                .map((d) => ({ id: d.id, ...((d.data() || {}) as object) }) as Msg)
                .reverse();
              const prevIds = new Set(msgsRef.current.map((m) => m.id));
              const hasNew = list.some((m) => !prevIds.has(m.id));
              msgsRef.current = list;
              setMsgs(list);
              // Legacy applyMsgScroll parity: auto-scroll only when the user
              // is already near the bottom (or first paint); otherwise show
              // the "new messages" pill so history reading isn't yanked.
              if (!hasNew) return;
              if (nearBottomNow()) {
                scrollBottom();
                setShowPill(false);
              } else {
                setShowPill(true);
              }
            },
            () => {}
          )
      );
      unsubsRef.current = unsubs;
    },
    [convId]
  );

  const isSupport = conv?.listingId === 'support';
  const isAnn = conv?.listingId === 'announcements';
  const myUid = authState.status === 'signed-in' ? authState.user.uid : '';
  const otherUid =
    conv && (conv.participants || []).find((p) => p !== myUid);
  const isSeller = conv?.sellerId === myUid;
  const isBuyer = conv?.buyerId === myUid;
  const sold = listingSold || listingGone || !!conv?.dealConfirmedByBuyer;
  const composerLocked = amBlocked || userBlockSevered;

  const pf = phoneFlowState(conv, msgs, myUid, revealSharedBy);

  // ---------- helpers ----------

  function scrollBottom() {
    const sc = scrollerRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }

  // Legacy js/chat.js nearBottomNow(): auto-scroll only when the user is
  // already near the bottom — never yank them away from history.
  function nearBottomNow() {
    const sc = scrollerRef.current;
    return sc
      ? sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140
      : true;
  }

  // ---------- bootstrap ----------

  function markRead(client: FirebaseClient, data: ConvData, uid: string) {
    const { db, fsMod } = client;
    try {
      fsMod
        .updateDoc(fsMod.doc(db, `conversations/${data.id}`), {
          [`unread.${uid}`]: 0,
          [`lastReadAt.${uid}`]: fsMod.serverTimestamp(),
        })
        .catch(() => {});
    } catch {
      /* best-effort */
    }
    fsMod
      .getDocs(
        fsMod.query(
          fsMod.collection(db, 'conversations', data.id, 'messages'),
          fsMod.orderBy('at', 'desc'),
          fsMod.limit(100)
        )
      )
      .then((snap) => {
        const other = (data.participants || []).find((p) => p !== uid) || '';
        const batch = fsMod.writeBatch(db);
        let n = 0;
        for (const d of snap.docs) {
          const m = (d.data() || {}) as Record<string, unknown>;
          if (n < 50 && m.senderId === other && !m.isSystem && !m.readAt) {
            batch.update(d.ref, {
              readAt: fsMod.serverTimestamp(),
            });
            n++;
          }
        }
        if (n) batch.commit().catch(() => {});
      })
      .catch(() => {});
  }

  const openThread = useCallback(
    async (client: FirebaseClient, user: CompatUser) => {
      // Read language at call time (not from render closure): openThread runs once
      // at thread open; getLang() always reflects the latest switch (useLang persists
      // to localStorage synchronously). Keeps the [convId, searchParams] memo intact.
      const gst = (k: string) => chatSt(getLang(), k);
      const uid = user.uid;
      const { db, fsMod } = client;
      let snap: CompatDocSnap;
      try {
        snap = await fsMod.getDoc(fsMod.doc(db, `conversations/${convId}`));
      } catch {
        setFatal(gst('chatError'));
        return;
      }
      if (!snap.exists()) {
        if (convId === `supp_${uid}`) {
          // Create the deterministic support thread.
          try {
            const cfg = await fsMod.getDoc(fsMod.doc(db, 'config/support'));
            const adminId = cfg.exists()
              ? String((cfg.data() || {}).adminId || '')
              : '';
            if (!adminId) throw new Error('no-admin-config');
            if (adminId === uid) throw new Error('no-admin-self');
            await fsMod.setDoc(fsMod.doc(db, `conversations/${convId}`), {
              listingId: 'support',
              buyerId: uid,
              sellerId: adminId,
              participants: [uid, adminId],
              dealConfirmPending: false,
              dealConfirmedByBuyer: false,
              hiddenFor: [],
              phoneRequestBy: '',
              phoneRequestStatus: 'none',
              phoneRequestCount: 0,
              lastMessage: null,
              unread: { [uid]: 0, [adminId]: 0 },
              lastReadAt: { [uid]: null, [adminId]: null },
              createdAt: fsMod.serverTimestamp(),
              updatedAt: fsMod.serverTimestamp(),
            });
            const sys = async (kind: string) => {
              const mref = fsMod.doc(
                fsMod.collection(db, 'conversations', convId, 'messages')
              );
              const batch = fsMod.writeBatch(db);
              batch.set(mref, {
                senderId: uid,
                text: '',
                at: fsMod.serverTimestamp(),
                isSystem: true,
                systemKind: kind,
              });
              batch.update(fsMod.doc(db, `conversations/${convId}`), {
                updatedAt: fsMod.serverTimestamp(),
              });
              // 11 Oct 2026: timeout — hanging commit caused permanent send lock.
      await withTimeout(batch.commit(), 15000);
            };
            await sys('support_greeting');
            await sys('support_autoreply');
            snap = await fsMod.getDoc(fsMod.doc(db, `conversations/${convId}`));
          } catch (e) {
            setFatal(
              (e as Error)?.message === 'no-admin-self'
                ? gst('supportSelfAdmin')
                : gst('supportConfigError')
            );
            return;
          }
        } else {
          setFatal(gst('chatError'));
          return;
        }
      }
      const data = { id: snap.id, ...((snap.data() || {}) as object) } as ConvData;
      if (!(data.participants || []).includes(uid)) {
        setFatal(gst('chatError'));
        return;
      }
      convRef.current = data;
      setConv(data);

      // Verified email required for normal threads; support threads allow
      // any signed-in user.
      if (data.listingId !== 'support' && !user.emailVerified) {
        setFatal(gst('mustVerifyChat'));
        return;
      }

      // Header: peer name + listing chip
      const other = (data.participants || []).find((p) => p !== uid) || '';
      (async () => {
        let name = gst('unknownUser');
        if (data.listingId === 'support') name = gst('supportTitle');
        else if (data.listingId === 'announcements') name = gst('announcementsTitle');
        else if (other) {
          try {
            const d = await fsMod.getDoc(fsMod.doc(db, `users_public/${other}`));
            if (d.exists()) {
              const m = d.data() || {};
              name =
                (m.name as string) ||
                ((m.username as string) ? '@' + m.username : '') ||
                gst('unknownUser');
            }
          } catch {
            /* keep fallback */
          }
        }
        setOtherName(name);
      })();
      (async () => {
        const lid = data.listingId;
        if (!lid || lid === 'support' || lid === 'announcements') return;
        try {
          const d = await fsMod.getDoc(fsMod.doc(db, `listings/${lid}`));
          if (d.exists()) {
            const m = d.data() || {};
            const thumbs =
              (m.photo_thumbs as (string | null)[]) ||
              (m.thumbUrls as string[]) ||
              (m.photoUrls as string[]) ||
              [];
            setListingChip({
              title: localizedTitle(m.title) || gst('deletedListing'),
              photo: thumbs[0] || '',
              id: lid,
            });
            setListingSold(
              m.status === 'sold' || m.soldConfirmed === true
            );
          } else {
            setListingChip({ title: gst('deletedListing'), photo: '', id: lid });
          }
        } catch (e) {
          if ((e as { code?: string })?.code === 'permission-denied') {
            // Sold/hidden listings deny reads to non-sellers — negotiation
            // is closed either way.
            setListingGone(true);
          }
        }
      })();

      // Block states
      (async () => {
        try {
          const d = await fsMod.getDoc(fsMod.doc(db, `blocks/${uid}`));
          let expMs: number | null = null;
          if (d.exists()) {
            const raw = (d.data() || {}).expiresAt;
            expMs =
              raw && typeof (raw as { toDate?: () => Date }).toDate === 'function'
                ? (raw as { toDate: () => Date }).toDate().getTime()
                : typeof raw === 'number'
                  ? raw
                  : null;
          }
          const blocked = d.exists() && (expMs == null || expMs > Date.now());
          setAmBlocked(blocked);
          setBlockUntilMs(blocked ? expMs : null);
        } catch {
          /* keep previous */
        }
      })();
      (async () => {
        if (!other || data.listingId === 'support' || data.listingId === 'announcements') {
          setUserBlockSevered(false);
          return;
        }
        try {
          const [mine, theirs] = await Promise.all([
            fsMod.getDoc(fsMod.doc(db, `blocks/${uid}_${other}`)).catch(() => null),
            fsMod.getDoc(fsMod.doc(db, `blocks/${other}_${uid}`)).catch(() => null),
          ]);
          const iB = !!(
            mine &&
            mine.exists() &&
            (mine.data() || {}).blockerUid
          );
          const theyB = !!(
            theirs &&
            theirs.exists() &&
            (theirs.data() || {}).blockerUid
          );
          setIBlockedThem(iB);
          setUserBlockSevered(iB || theyB);
        } catch {
          /* best-effort */
        }
      })();
      // Reveal state (phone already shared survives message loss)
      (async () => {
        try {
          const r = await fsMod.getDoc(fsMod.doc(db, `reveals/${convId}`));
          if (r.exists() && (r.data() || {}).ownerId) {
            setRevealSharedBy({
              [String((r.data() || {}).ownerId)]: true,
            });
          }
        } catch {
          /* best-effort */
        }
      })();

      // Live subscriptions (js/chat.js subscribeAll — extracted above so the
      // visibilitychange handler can re-attach them on tab return).
      subscribeAll(client);
      openedRef.current = true;
      markRead(client, data, uid);

      // ?offer= pre-fill (never auto-send — crafted-link hardening)
      const offer = searchParams.get('offer');
      if (
        offer &&
        Number(offer) > 0 &&
        data.listingId !== 'support' &&
        data.listingId !== 'announcements'
      ) {
        setProposalAmt(offer);
        setProposalOpen(true);
      }
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has('offer')) {
          url.searchParams.delete('offer');
          window.history.replaceState(null, '', url.toString());
        }
      } catch {
        /* ignore */
      }
    },
    [convId, searchParams, subscribeAll]
  );

  useEffect(() => {
    if (authState.status !== 'signed-in') return;
    if (!convId) {
      router.push('/conversations');
      return;
    }
    clientRef.current = authState.client;
    userRef.current = authState.user;
    // Data-fetch effect: openThread is async and only sets state in async
    // continuations (after await). No synchronous setState — the
    // cascading-render concern does not apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openThread(authState.client, authState.user);
    return () => {
      unsubscribeAll();
      openedRef.current = false;
    };
  }, [authState, convId, openThread, router, unsubscribeAll]);

  // js/chat.js parity: detach Firestore listeners while the page is hidden
  // (no duplicates, no leaks — battery/data on mobile); re-attach on return
  // so the thread is always fresh. pagehide covers full-page unload.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        unsubscribeAll();
      } else if (openedRef.current && clientRef.current) {
        subscribeAll(clientRef.current);
      }
    };
    const onHide = () => unsubscribeAll();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    };
  }, [subscribeAll, unsubscribeAll]);

  // Hide the "new messages" pill once the user scrolls back near the
  // bottom (legacy js/chat.js parity, 140px threshold).
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const onScroll = () => {
      if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140) {
        setShowPill(false);
      }
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
  }, []);

  // ---------- send paths ----------

  function blockedSendGuard(): boolean {
    if (amBlocked) {
      showToast(st('chatBlockedNotice'));
      return true;
    }
    if (userBlockSevered) {
      showToast(st('blockedChatNotice'));
      return true;
    }
    return false;
  }

  async function sendChatMessage(opts: {
    text?: string;
    imageUrl?: string | null;
    proposal?: number | null;
    mid?: string;
  }): Promise<string | null> {
    const client = clientRef.current;
    const user = userRef.current;
    const c = convRef.current;
    if (!client || !user || !c) return null;
    const { db, fsMod } = client;
    if (blockedSendGuard()) return null;
    if (sendInFlightRef.current) {
      showToast(st('tooFast'));
      return null;
    }
    const now = Date.now();
    if (now - lastSendAtRef.current < 3000) {
      showToast(st('tooFast'));
      return null;
    }
    const t = cleanText(opts.text || '');
    if (!t && !opts.imageUrl && opts.proposal == null) return null;
    const msgId = opts.mid || mintMessageId(user.uid);
    const oUid = (c.participants || []).find((p) => p !== user.uid) || '';
    const msg: Record<string, unknown> = {
      senderId: user.uid,
      text: t || (opts.imageUrl ? '📷' : ''),
      at: fsMod.serverTimestamp(),
      isSystem: false,
    };
    if (opts.imageUrl) msg.imageUrl = opts.imageUrl;
    if (opts.proposal != null)
      msg.proposal = { amount: Number(opts.proposal), status: 'pending' };
    sendInFlightRef.current = true;
    // 18 Sep 2026 (Zak): optimistic UI — show the message IMMEDIATELY
    // instead of waiting for the server round-trip. The onSnapshot echo
    // dedupes by msgId when the real message arrives (same doc id, full
    // list replace). Non-fatal — the snapshot renders it anyway.
    try {
      const optimistic: Msg = {
        id: msgId,
        senderId: user.uid,
        text: t || (opts.imageUrl ? '📷' : ''),
        at: Date.now(),
        isSystem: false,
        _sending: true,
      };
      if (opts.imageUrl) optimistic.imageUrl = opts.imageUrl;
      if (opts.proposal != null)
        optimistic.proposal = { amount: Number(opts.proposal), status: 'pending' };
      const next = [...msgsRef.current, optimistic];
      msgsRef.current = next;
      setMsgs(next);
      if (nearBottomNow()) scrollBottom();
      else setShowPill(true);
    } catch {
      /* non-fatal — server snapshot will render it */
    }
    try {
      const batch = fsMod.writeBatch(db);
      batch.set(
        fsMod.doc(db, 'conversations', convId, 'messages', msgId),
        msg
      );
      batch.update(fsMod.doc(db, `conversations/${convId}`), {
        updatedAt: fsMod.serverTimestamp(),
        lastUserMessageAt: fsMod.serverTimestamp(),
        lastMessage: {
          text: t ? t.slice(0, 500) : opts.imageUrl ? '📷' : '',
          proposalAmount: opts.proposal != null ? Number(opts.proposal) : null,
          senderId: user.uid,
          at: fsMod.serverTimestamp(),
        },
        [`unread.${oUid}`]: fsMod.increment(1),
        hiddenFor: fsMod.arrayRemove(oUid),
      });
      // 11 Oct 2026: timeout — hanging commit caused permanent send lock.
      await withTimeout(batch.commit(), 15000);
      lastSendAtRef.current = Date.now();
      setFailedSend(null);
      setStatusBar(null);
      return msgId;
    } catch (e) {
      // Retry-after-commit: the batch may have committed server-side
      // while the response was lost. Check the deterministic id first.
      // 12 Oct 2026: also check on deadline-exceeded (timeout), not just
      // permission-denied — timeouts can commit server-side too.
      const code = (e as { code?: string })?.code;
      if (code === 'permission-denied' || code === 'deadline-exceeded') {
        try {
          const check = await fsMod.getDoc(
            fsMod.doc(db, 'conversations', convId, 'messages', msgId)
          );
          if (check.exists()) {
            lastSendAtRef.current = Date.now();
            setFailedSend(null);
            setStatusBar(null);
            return msgId;
          }
        } catch {
          /* real failure below */
        }
      }
      // Send failed and the doc provably does not exist (the
      // permission-denied retry-after-commit above already returned if it
      // does) — drop the optimistic message so it doesn't linger.
      const cur = msgsRef.current.filter((m) => m.id !== msgId);
      msgsRef.current = cur;
      setMsgs(cur);
      setFailedSend({
        text: opts.text,
        imageUrl: opts.imageUrl,
        proposal: opts.proposal,
        mid: msgId,
      });
      setStatusBar({ mode: 'error', text: st('chatSendFailed') });
      return null;
    } finally {
      sendInFlightRef.current = false;
    }
  }

  function doSendText() {
    const v = input;
    if (!cleanText(v)) return;
    sendChatMessage({ text: v }).then((id) => {
      if (id) setInput('');
    });
  }

  async function retrySend() {
    const p = failedSend;
    setStatusBar(null);
    if (!p) {
      setFailedSend(null);
      return;
    }
    const id = await sendChatMessage({
      text: p.text,
      imageUrl: p.imageUrl,
      proposal: p.proposal,
      mid: p.mid,
    });
    if (id) {
      setFailedSend(null);
      if (p.text != null && input === p.text) setInput('');
    }
  }

  // Photo via R2 ONLY (never Firebase Storage).
  async function sendPhoto(file: File) {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user || !file) return;
    const { authMod } = client;
    // 12 Oct 2026: reset URL ref per send — prevents retry sending previous photo.
    publicUrlRef.current = null;
    // 11 Oct 2026: throttle FIRST — was uploading to R2 before the 3s check,
    // orphaning every throttled photo + wasting bandwidth.
    if (sendInFlightRef.current) {
      showToast(st('tooFast'));
      return;
    }
    if (Date.now() - lastSendAtRef.current < 3000) {
      showToast(st('tooFast'));
      return;
    }
    if (blockedSendGuard()) return;
    if (!file.type || !file.type.startsWith('image/')) {
      showToast(st('imageSendError'));
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast(st('imageSendError'));
      return;
    }
    if (blockedSendGuard()) return;
    setStatusBar({ mode: 'info', text: st('sendingPhoto') });
    try {
      // Downscale to 1280px JPEG 0.8 — mirrors chat.js downscaleChat.
      const blob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const maxDim = 1280;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          cv.getContext('2d')?.drawImage(img, 0, 0, w, h);
          cv.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('blob'))),
            'image/jpeg',
            0.8
          );
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('img'));
        };
        img.src = url;
      });
      const idToken = await authMod.getIdToken(user);
      const safeName = `p${Date.now()}.jpg`;
      const key = `chat/${convId}/${user.uid}/${safeName}`;
      const res = await fetch('/api/r2/chat-upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        // 11 Oct 2026: declare size — server signs ContentLength into the URL.
        body: JSON.stringify({ key, contentType: 'image/jpeg', size: blob.size }),
      });
      if (!res.ok) throw new Error('upload-url');
      const { url, publicUrl } = await res.json();
      publicUrlRef.current = publicUrl;
      const put = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!put.ok) throw new Error('r2-put');
      setStatusBar(null);
      const id = await sendChatMessage({ imageUrl: publicUrl });
      if (!id && !failedSend) {
        setFailedSend({ imageUrl: publicUrl, mid: mintMessageId(user.uid) });
        setStatusBar({ mode: 'error', text: st('chatSendFailed') });
      }
    } catch (e) {
      // 11 Oct 2026: retain imageUrl on failure — retry was a silent no-op
      // (fresh mid with no imageUrl hit the early return).
      const msg = e instanceof Error ? e.message : 'unknown';
      setFailedSend({ imageUrl: publicUrlRef.current || undefined, mid: mintMessageId(user.uid) });
      setStatusBar({ mode: 'error', text: `${st('chatSendFailed')} [${msg}]` });
      showToast(`${st('imageSendError')} [${msg}]`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ---------- proposals ----------

  async function respondProposal(msgId: string, status: 'accepted' | 'refused') {
    const client = clientRef.current;
    if (!client || blockedSendGuard()) return;
    const { db, fsMod } = client;
    if (sold) {
      showToast(st('soldNegotiationClosed'));
      return;
    }
    try {
      await fsMod.updateDoc(
        fsMod.doc(db, 'conversations', convId, 'messages', msgId),
        { 'proposal.status': status }
      );
    } catch {
      showToast(st('errorGeneric'));
    }
  }

  function counterProposal(msgId: string) {
    respondProposal(msgId, 'refused').then(() => {
      if (!sold) {
        setProposalOpen(true);
      }
    });
  }

  async function sendProposal() {
    if (blockedSendGuard()) return;
    if (sold) {
      showToast(st('soldNegotiationClosed'));
      return;
    }
    const amt = Number(proposalAmt);
    if (!amt || amt <= 0) {
      showToast(st('proposalInvalid'));
      return;
    }
    const id = await sendChatMessage({ proposal: amt });
    if (id) {
      setProposalOpen(false);
      setProposalAmt('');
    }
  }

  // ---------- phone flow ----------

  async function appendSystem(
    kind: string,
    args: Record<string, string> = {}
  ): Promise<void> {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) return;
    const { db, fsMod } = client;
    const batch = fsMod.writeBatch(db);
    batch.set(
      fsMod.doc(fsMod.collection(db, 'conversations', convId, 'messages')),
      {
        senderId: user.uid,
        text: '',
        at: fsMod.serverTimestamp(),
        isSystem: true,
        systemKind: kind,
        ...(Object.keys(args).length ? { systemArgs: args } : {}),
      }
    );
    batch.update(fsMod.doc(db, `conversations/${convId}`), {
      updatedAt: fsMod.serverTimestamp(),
    });
    // 11 Oct 2026: timeout — prevents hang.
    await withTimeout(batch.commit(), 15000);
  }

  async function requestPhone() {
    const client = clientRef.current;
    const user = userRef.current;
    const c = convRef.current;
    if (!client || !user || !c || blockedSendGuard()) return;
    const { db, fsMod } = client;
    const prevBy = c.phoneRequestBy;
    const prevStatus = c.phoneRequestStatus;
    const next = { ...c, phoneRequestBy: user.uid, phoneRequestStatus: 'requested' };
    convRef.current = next;
    setConv(next);
    try {
      await fsMod.updateDoc(fsMod.doc(db, `conversations/${convId}`), {
        phoneRequestBy: user.uid,
        phoneRequestStatus: 'requested',
        phoneRequestCount: fsMod.increment(1),
        updatedAt: fsMod.serverTimestamp(),
      });
      await appendSystem('phone_requested', {
        name: (user.displayName || '').trim().split(' ')[0] || st('you'),
      }).catch(() => {});
    } catch {
      const rb = { ...c, phoneRequestBy: prevBy, phoneRequestStatus: prevStatus };
      convRef.current = rb;
      setConv(rb);
      showToast(st('errorGeneric'));
    }
  }

  async function answerPhone(status: 'accepted' | 'declined') {
    const client = clientRef.current;
    const c = convRef.current;
    // 11 Oct 2026: in-flight guard — double-tap double-counted declines.
    if (!client || !c || blockedSendGuard() || phoneBusy.current) return;
    const { db, fsMod } = client;
    phoneBusy.current = true;
    const prevStatus = c.phoneRequestStatus;
    const next = { ...c, phoneRequestStatus: status };
    convRef.current = next;
    setConv(next);
    try {
      const payload: Record<string, unknown> = {
        phoneRequestStatus: status,
        updatedAt: fsMod.serverTimestamp(),
      };
      if (status === 'declined' && c.phoneRequestBy) {
        payload[`declinesByRequester.${c.phoneRequestBy}`] =
          fsMod.increment(1);
      }
      await fsMod.updateDoc(fsMod.doc(db, `conversations/${convId}`), payload);
      await appendSystem(
        status === 'accepted' ? 'phone_accepted' : 'phone_declined',
        {}
      ).catch(() => {});
    } catch {
      const rb = { ...c, phoneRequestStatus: prevStatus };
      convRef.current = rb;
      setConv(rb);
      showToast(st('errorGeneric'));
    } finally {
      phoneBusy.current = false;
    }
  }

  async function sharePhone() {
    const client = clientRef.current;
    const user = userRef.current;
    const c = convRef.current;
    if (!client || !user || !c || blockedSendGuard()) return;
    const { db, fsMod } = client;
    const normalized = normalizePhone(phoneInput);
    if (!normalized) {
      showToast(st('phoneInvalid'));
      return;
    }
    try {
      await fsMod.setDoc(fsMod.doc(db, `reveals/${convId}`), {
        conversationId: convId,
        requesterId: c.phoneRequestBy || '',
        ownerId: user.uid,
        status: 'accepted',
        sharedPhone: normalized,
        updatedAt: fsMod.serverTimestamp(),
      });
      await appendSystem('phone_shared', {});
      const id = await sendChatMessage({ text: normalized });
      if (!id) throw new Error('phone message not sent');
      setRevealSharedBy((prev) => ({ ...prev, [user.uid]: true }));
      setPhoneInput('');
    } catch {
      showToast(st('errorGeneric'));
    }
  }

  // ---------- deal flow ----------

  function dealConfirmErr(code: string): string {
    switch (code) {
      case 'invalid_args':
        return st('dealErrInvalidArgs');
      case 'unauthenticated':
        return st('dealErrUnauth');
      case 'not_buyer':
        return st('dealErrNotBuyer');
      case 'not_pending':
        return st('dealErrNotPending');
      case 'not_found':
        return st('dealErrNotFound');
      case 'already_confirmed':
        return st('dealErrAlready');
      case 'listing_unavailable':
        return st('dealErrUnavailable');
      default:
        return st('dealErrInvalidArgs');
    }
  }

  async function dealConfirmYes() {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user || blockedSendGuard()) return;
    const { authMod } = client;
    // 11 Oct 2026: in-flight guard — double-tap sent duplicate requests.
    if (dealConfirmInFlightRef.current) return;
    dealConfirmInFlightRef.current = true;
    try {
      const token = await authMod.getIdToken(user);
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      let resp: Response;
      try {
        resp = await fetch(CONFIRM_DEAL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({ conversationId: convId }),
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      const data = await resp.json().catch(() => null);
      if (resp.ok && data && data.ok) {
        showToast(st('dealConfirmed'));
        return;
      }
      showToast(dealConfirmErr(data && data.error));
    } catch {
      showToast(st('errorGeneric'));
    } finally {
      dealConfirmInFlightRef.current = false;
    }
  }

  async function dealConfirmNo() {
    const client = clientRef.current;
    const c = convRef.current;
    if (!client || !c || blockedSendGuard()) return;
    const { db, fsMod } = client;
    try {
      await fsMod.updateDoc(fsMod.doc(db, `conversations/${convId}`), {
        dealConfirmPending: false,
        updatedAt: fsMod.serverTimestamp(),
      });
      try {
        await fsMod.updateDoc(fsMod.doc(db, `listings/${c.listingId}`), {
          soldConfirmed: false,
        });
      } catch {
        /* best-effort */
      }
      showToast(st('dealCancelled'));
    } catch {
      showToast(st('errorGeneric'));
    }
  }

  async function dealRequest() {
    const client = clientRef.current;
    if (!client || blockedSendGuard()) return;
    const { db, fsMod } = client;
    try {
      await fsMod.updateDoc(fsMod.doc(db, `conversations/${convId}`), {
        dealConfirmPending: true,
        updatedAt: fsMod.serverTimestamp(),
      });
    } catch {
      showToast(st('errorGeneric'));
    }
  }

  // ---------- block ----------

  async function toggleBlock() {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user || !otherUid) return;
    const { db, fsMod, authMod } = client;
    try {
      const idToken = await authMod.getIdToken(user);
      const res = await fetch(TOGGLE_BLOCK_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ data: { uid: otherUid }, idToken }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.result || typeof json.result.blocked !== 'boolean') {
        throw new Error('blockFailed');
      }
      const blocked = json.result.blocked as boolean;
      setIBlockedThem(blocked);
      setUserBlockSevered(blocked || userBlockSevered);
      if (blocked) setUserBlockSevered(true);
      else {
        // Re-check the pair state after unblock.
        try {
          const theirs = await fsMod
            .getDoc(fsMod.doc(db, `blocks/${otherUid}_${user.uid}`))
            .catch(() => null);
          const theyB = !!(
            theirs &&
            theirs.exists() &&
            (theirs.data() || {}).blockerUid
          );
          setUserBlockSevered(theyB);
        } catch {
          /* keep */
        }
      }
    } catch {
      showToast(st('blockFailed'));
    }
  }

  // ---------- render ----------

  if (authState.status !== 'signed-in') {
    return <LoadingSpinner label={st('loading')} />;
  }

  if (fatal) {
    return (
      <div className="min-h-screen bg-zinc-50" dir="rtl">
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <h1 className="text-lg font-bold text-zinc-900 mb-5">{fatal}</h1>
          <div className="flex gap-2 justify-center">
            <button
              className="rounded-lg bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-800"
              onClick={() => window.location.reload()}
            >
              {st('retry')}
            </button>
            <a
              href="/conversations"
              className={btnSecondaryCls + ' no-underline inline-block'}
            >
              {st('messages')}
            </a>
          </div>
        </main>
      </div>
    );
  }

  if (!conv) {
    return <LoadingSpinner label={st('loading')} />;
  }

  const fmtBlockDate = (ms: number) => {
    try {
      return new Date(ms).toLocaleDateString('ar-DZ', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  // Phone panel (per-direction) — mirrors renderPhonePanel.
  function renderPhonePanel() {
    if (isSupport || isAnn) return null;
    if (userBlockSevered) {
      return (
        <div className="mx-3 my-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          🚫 {st('blockedChatNotice')}
        </div>
      );
    }
    const oUid = otherUid || '';
    const count = conv?.phoneRequestCount || 0;
    const slotBusy = pf.pendingBy !== '' || pf.acceptedBy !== '';
    const name = otherName || st('unknownUser');
    return (
      <div className="mx-3 my-2 space-y-2">
        {pf.sharedBy[oUid] ? (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
            ✅ {st('phoneSharedReceived').replace('{name}', name)}
          </div>
        ) : pf.myBlocked ? (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            🚫 {st('phoneBlockedRequester')}
          </div>
        ) : pf.pendingBy === myUid ? (
          <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
            📞 {st('phoneWaiting')}
          </div>
        ) : pf.acceptedBy === myUid ? (
          <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
            📞 {st('phoneAcceptedMsg')}
          </div>
        ) : (
          // 11 Oct 2026: removed `count < 3` — it was conversation-wide but the
          // rule is per-requester (pf.myBlocked handles it correctly above).
          !slotBusy && (
            <button
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={requestPhone}
            >
              📞 {st('requestPhone')}
            </button>
          )
        )}

        {pf.sharedBy[myUid] ? (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
            ✅ {st('phoneSharedConfirm')}
          </div>
        ) : (conv?.declinesByRequester?.[oUid] || 0) >= 3 || (pf.declines[oUid] || 0) >= 3 ? (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            🚫 {st('phoneBlockedOther').replace('{name}', name)}
          </div>
        ) : pf.pendingBy === oUid ? (
          <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
            📞 {name} {st('phoneRequestedSuffix')}
            <div className="flex gap-2 mt-2">
              <button
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-800"
                onClick={() => answerPhone('accepted')}
              >
                {st('phoneAccept')}
              </button>
              <button
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                onClick={() => answerPhone('declined')}
              >
                {st('phoneDecline')}
              </button>
            </div>
          </div>
        ) : (
          pf.acceptedBy === oUid && (
            <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
              📞 {st('phoneTypeTitle')}
              <div className="flex gap-2 mt-2">
                <input
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  placeholder={st('phonePlaceholder')}
                  className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-base text-zinc-900 text-left"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                />
                <button
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-800"
                  onClick={sharePhone}
                >
                  {st('phoneSend')}
                </button>
              </div>
            </div>
          )
        )}
      </div>
    );
  }

  // Deal panel — mirrors renderDealPanel.
  function renderDealPanel() {
    if (isSupport || isAnn) return null;
    if (conv?.dealConfirmedByBuyer) {
      return (
        <div className="mx-3 my-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
          ✅ {st('dealConfirmed')}
        </div>
      );
    }
    if (listingSold) {
      return (
        <div className="mx-3 my-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
          🤝 {st('dealDoneSold')}
        </div>
      );
    }
    if (conv?.dealConfirmPending) {
      if (isBuyer) {
        return (
          <div className="mx-3 my-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-zinc-800">
            <b>{st('dealPendingTitle')}</b>
            <br />
            {st('dealPendingBody')}
            <div className="flex gap-2 mt-2">
              <button
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-800"
                onClick={dealConfirmYes}
              >
                {st('dealYes')}
              </button>
              <button
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                onClick={dealConfirmNo}
              >
                {st('dealNo')}
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="mx-3 my-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
          ⏳ {st('dealWaiting')}
        </div>
      );
    }
    if (isSeller) {
      return (
        <div className="mx-3 my-2">
          <button
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={dealRequest}
          >
            🤝 {st('dealRequest')}
          </button>
        </div>
      );
    }
    return null;
  }

  let lastDay = '';
  const msgNodes = msgs.map((m) => {
    const ts = tsMs(m.at);
    const nodes: React.ReactNode[] = [];
    if (ts) {
      const day = dayLabel(ts, lang);
      if (day !== lastDay) {
        lastDay = day;
        nodes.push(
          <div key={`day-${m.id}`} className="flex justify-center my-3">
            <span className="rounded-full bg-zinc-200 px-3 py-1 text-xs text-zinc-600">
              {day}
            </span>
          </div>
        );
      }
    }
    if (m.isSystem) {
      nodes.push(
        <div key={m.id} className="flex justify-center my-2">
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-500">
            {systemText(m, lang)}
          </span>
        </div>
      );
      return nodes;
    }
    const mine = m.senderId === myUid;
    const p = m.proposal;
    nodes.push(
      <div
        key={m.id}
        className={`flex ${mine ? 'justify-start' : 'justify-end'} my-1`}
      >
        <div
          className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm ${
            mine
              ? 'bg-emerald-700 text-white rounded-tl-sm'
              : 'bg-white text-zinc-900 rounded-tr-sm'
          }`}
        >
          {m.imageUrl && (
            <a href={m.imageUrl} target="_blank" rel="noopener noreferrer">
              {/* 11 Oct 2026: removed unoptimized — enables AVIF/WebP + resizing for weak internet. */}
              <NextImage
                src={m.imageUrl}
                alt={st('photoLabel')}
                width={640}
                height={480}
                sizes="(max-width: 768px) 80vw, 480px"
                className="rounded-lg mb-1"
                style={{ width: 'auto', height: 'auto', maxHeight: '16rem' }}
                onError={(e) => {
                  // 12 Oct 2026: broken chat photos show a visible placeholder
                  // instead of silently collapsing (was display:none).
                  const img = e.target as HTMLImageElement;
                  img.style.display = 'none';
                  const ph = img
                    .closest('a')
                    ?.querySelector<HTMLElement>('[data-chat-photo-fallback]');
                  if (ph) ph.style.display = 'inline-flex';
                }}
              />
              <span
                data-chat-photo-fallback
                style={{ display: 'none' }}
                className="items-center justify-center gap-2 rounded-lg mb-1 bg-black/10 px-6 py-10 text-xs min-w-[12rem]"
                role="img"
                aria-label={st('photoLabel')}
              >
                <span aria-hidden="true">🖼️</span>
                <span>
                  {lang === 'ar'
                    ? 'تعذّر تحميل الصورة'
                    : lang === 'fr'
                      ? 'Image indisponible'
                      : 'Image unavailable'}
                </span>
              </span>
            </a>
          )}
          {p ? (
            <div>
              <div className="font-bold">💰 {formatPrice(p.amount, lang)}</div>
              <div
                className={`text-xs mt-1 ${
                  p.status === 'accepted'
                    ? 'text-emerald-200'
                    : p.status === 'refused'
                      ? 'text-red-200'
                      : mine
                        ? 'text-emerald-100'
                        : 'text-zinc-500'
                }`}
              >
                {proposalStatusText(p.status, lang)}
              </div>
              {!mine && p.status === 'pending' && !isAnn && !isSupport && !sold && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <button
                    className="rounded-lg bg-white/90 text-emerald-800 px-2.5 py-1 text-xs font-bold"
                    onClick={() => respondProposal(m.id, 'accepted')}
                  >
                    {st('proposalAccept')}
                  </button>
                  <button
                    className="rounded-lg bg-white/20 px-2.5 py-1 text-xs"
                    onClick={() => respondProposal(m.id, 'refused')}
                  >
                    {st('proposalDecline')}
                  </button>
                  <button
                    className="rounded-lg bg-white/20 px-2.5 py-1 text-xs"
                    onClick={() => counterProposal(m.id)}
                  >
                    {st('proposalCounter')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>
          )}
          <div
            className={`flex items-center gap-1 mt-1 text-[11px] ${
              mine ? 'text-emerald-100' : 'text-zinc-400'
            }`}
          >
            {ts > 0 && <span>{fmtChatTime(ts)}</span>}
            {mine && m.readAt ? <span>✓✓</span> : null}
          </div>
        </div>
      </div>
    );
    return nodes;
  });

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col" dir="rtl">
      {/* header */}
      <header className="sticky top-0 z-10 bg-emerald-700 text-white shadow">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-2">
          <button
            aria-label={st('back')}
            className="w-9 h-9 rounded-full hover:bg-emerald-600 flex items-center justify-center text-xl"
            onClick={() => {
              if (window.history && history.length > 1) history.back();
              else router.push('/conversations');
            }}
          >
            {dir === 'rtl' ? '›' : '‹'}
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate">{otherName || '…'}</div>
            {listingChip && listingChip.id && (
              <a
                href={`/listing/${encodeURIComponent(listingChip.id)}`}
                className="flex items-center gap-1.5 text-xs text-emerald-100 hover:underline truncate"
              >
                {listingChip.photo && (
                  <NextImage
                    src={listingChip.photo}
                    alt=""
                    width={20}
                    height={20}
                    className="rounded object-cover"
                  />
                )}
                <span className="truncate">{listingChip.title}</span>
              </a>
            )}
            {listingChip && !listingChip.id && (
              <div className="text-xs text-emerald-100">{listingChip.title}</div>
            )}
            {sold && (
              <span className="inline-block bg-red-700 text-white text-xs font-bold px-2.5 py-0.5 rounded-full mt-0.5">
                🏷️ {st('listingSoldBadge')}
              </span>
            )}
          </div>
          {otherUid && !isSupport && !isAnn && (
            <button
              className="text-xs rounded-lg border border-emerald-500 px-2.5 py-1.5 hover:bg-emerald-600"
              onClick={toggleBlock}
            >
              {iBlockedThem ? st('unblock') : st('block')}
            </button>
          )}
          {/* 0.0.0.43 chat.html parity: in-header language switcher.
              FIX-WEB-033: the active language carries aria-pressed="true". */}
          <div className="flex items-center gap-1" role="group" aria-label="Language">
            {(
              [
                ['ar', 'AR', 'العربية'],
                ['fr', 'FR', 'Français'],
                ['en', 'EN', 'English'],
              ] as const
            ).map(([l, label, aria]) => (
              <button
                key={l}
                type="button"
                lang={l}
                aria-label={aria}
                aria-pressed={l === lang}
                onClick={() => setLang(l)}
                className={`min-w-11 min-h-11 px-2 text-[11px] font-bold rounded ${
                  l === lang
                    ? 'bg-white text-emerald-700'
                    : 'text-emerald-100 hover:bg-emerald-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* account-block banner */}
      {amBlocked && (
        <div className="mx-3 mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          🚫{' '}
          {blockUntilMs != null
            ? st('chatBlockedUntil').replace('{date}', fmtBlockDate(blockUntilMs))
            : st('chatBlockedNotice')}
        </div>
      )}
      {userBlockSevered && !amBlocked && (
        <div className="mx-3 mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          🚫 {st('blockedChatNotice')}
        </div>
      )}

      {/* thread note */}
      {isAnn && (
        <div className="mx-3 mt-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 text-center">
          {st('announcementsNote')}
        </div>
      )}
      {isSupport && (
        <div className="mx-3 mt-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 text-center">
          {st('supportNote')}
        </div>
      )}

      {renderPhonePanel()}
      {renderDealPanel()}

      {/* messages */}
      <div className="relative flex-1 flex flex-col min-h-0">
        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-2">
          {msgs.length === 0 ? (
            <div className="text-center py-10 text-zinc-500">
              <div className="text-4xl mb-2">👋</div>
              <p className="text-sm">{st('sayHello')}</p>
            </div>
          ) : (
            msgNodes
          )}
        </div>
        {showPill && (
          <button
            type="button"
            onClick={() => {
              scrollBottom();
              setShowPill(false);
            }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 rounded-full bg-emerald-700 px-4 py-2 text-[13px] font-bold text-white shadow-lg active:scale-95"
          >
            {st('newMessages')}
          </button>
        )}
      </div>

      {/* send status bar */}
      {statusBar && (
        <div
          className={`mx-3 mb-1 rounded-lg px-3 py-2 text-sm flex items-center justify-between ${
            statusBar.mode === 'error'
              ? 'bg-red-50 border border-red-200 text-red-700'
              : 'bg-zinc-100 text-zinc-700'
          }`}
        >
          <span>{statusBar.text}</span>
          {statusBar.mode === 'error' && (
            <button
              className="font-bold underline"
              onClick={retrySend}
            >
              {st('retrySend')}
            </button>
          )}
        </div>
      )}

      {/* proposal form */}
      {proposalOpen && (
        <div className="mx-3 mb-1 rounded-xl bg-white shadow-sm p-3">
          <div className="font-bold text-sm text-zinc-900 mb-2">
            {st('proposalTitle')}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder={st('proposalAmountPh')}
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900"
              value={proposalAmt}
              onChange={(e) => setProposalAmt(e.target.value)}
            />
            <button
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-800"
              onClick={sendProposal}
            >
              {st('proposalSend')}
            </button>
            <button
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700"
              onClick={() => setProposalOpen(false)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* composer */}
      {!isAnn && (
        <footer className="sticky bottom-0 bg-white border-t border-zinc-200">
          <div className="max-w-2xl mx-auto px-3 py-2">
            <div className="text-[11px] text-amber-700 mb-1.5">
              {st('scamWarning')}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) sendPhoto(f);
                }}
              />
              <button
                aria-label={st('photoLabel')}
                className="w-10 h-10 rounded-full hover:bg-zinc-100 text-xl shrink-0 disabled:opacity-40"
                disabled={composerLocked}
                onClick={() => fileRef.current?.click()}
              >
                📷
              </button>
              <button
                aria-label={st('proposePrice')}
                className="w-10 h-10 rounded-full hover:bg-zinc-100 text-xl shrink-0 disabled:opacity-40"
                disabled={composerLocked || sold}
                style={sold ? { opacity: 0.4 } : undefined}
                onClick={() => setProposalOpen((v) => !v)}
              >
                💰
              </button>
              <input
                aria-label={st('typeMessage')}
                placeholder={st('typeMessage')}
                maxLength={2000}
                autoComplete="off"
                className="flex-1 rounded-full border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none min-w-0"
                value={input}
                disabled={composerLocked}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    doSendText();
                  }
                }}
              />
              <button
                className="rounded-full bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-800 disabled:opacity-60 shrink-0"
                disabled={composerLocked}
                onClick={doSendText}
              >
                {st('send')}
              </button>
            </div>
          </div>
        </footer>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 rounded-full bg-zinc-900 text-white px-5 py-3 shadow-lg text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { lang } = useLang();
  return (
    <Suspense fallback={<LoadingSpinner label={chatSt(lang, 'loading')} />}>
      <ChatInner />
    </Suspense>
  );
}
