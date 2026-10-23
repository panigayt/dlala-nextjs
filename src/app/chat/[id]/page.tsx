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

// BF-4 (R16, 18 Oct 2026): deterministic chronological order. The message
// queries are orderBy('at','desc') + reverse(), but equal `at` timestamps
// (same-ms serverTimestamp, optimistic Date.now() collisions) had
// undefined order — two rapid messages could flip. Secondary sort by
// message id (unique, deterministic).
function sortMsgsChronological(list: Msg[]): Msg[] {
  return [...list].sort((a, b) => {
    const d = tsMs(a.at) - tsMs(b.at);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
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

// R23-3 fix (24 Oct 2026): the phone_requested actor label is resolved
// per VIEWER, never trusted from storage alone. Legacy writers froze
// st('you') — in the WRITER's language at write time — into
// systemArgs.name whenever the requester's Auth displayName was empty,
// so FR/EN viewers read «أنت a demandé votre numéro» and the RECIPIENT
// saw the requester mislabeled as "you". Frozen 'you' values (any of
// the three languages) and a missing name now resolve from the
// message's senderId: the actor viewing their own notice gets the
// localized 'you'; the other party gets the actor's display name (the
// peer profile name this page already loads), falling back to the
// localized generic 'unknownUser'. A REAL stored first name is
// language-neutral and still renders verbatim for both viewers.
const FROZEN_YOU_LABELS = ['أنت', 'vous', 'you'];

interface SystemViewer {
  myUid?: string;
  peerName?: string;
}

function phoneRequestedText(m: Msg, lang: Lang, viewer?: SystemViewer): string {
  const stored = ((m.systemArgs || {}).name || '').trim();
  let actor = '';
  if (stored && !FROZEN_YOU_LABELS.includes(stored.toLowerCase())) {
    actor = stored;
  } else if (viewer && m.senderId && viewer.myUid === m.senderId) {
    actor = chatSt(lang, 'you');
  } else {
    actor =
      ((viewer && viewer.peerName) || '').trim().split(' ')[0] ||
      chatSt(lang, 'unknownUser');
  }
  return actor + ' ' + chatSt(lang, 'phoneRequestedSuffix');
}

function systemText(m: Msg, lang: Lang, viewer?: SystemViewer): string {
  const kind = m.systemKind || '';
  switch (kind) {
    case 'phone_requested':
      return phoneRequestedText(m, lang, viewer);
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
  // D12 (R12, 18 Oct 2026): message history pagination — messages older
  // than the live newest-100 window. Loaded on demand via "load more".
  const [olderMsgs, setOlderMsgs] = useState<Msg[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);

  const clientRef = useRef<FirebaseClient | null>(null);
  // 11 Oct 2026: phone flow in-flight guard.
  const phoneBusy = useRef(false);
  // D6 (R12, 18 Oct 2026): requestPhone in-flight guard (double-tap).
  const requestPhoneBusy = useRef(false);
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
          // D14 (R12, 18 Oct 2026): was silent () => {} — a rejected read
          // left a perpetual spinner. Surface the error.
          (err) => {
            setFatal(
              `${chatSt(getLang(), 'chatError')} [${(err as Error)?.message || 'snapshot'}]`
            );
          }
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
              // desc → chronological display (legacy parity) + BF-4
              // deterministic tiebreak on equal `at` (sort by id).
              const list: Msg[] = sortMsgsChronological(
                snap2.docs.map(
                  (d) => ({ id: d.id, ...((d.data() || {}) as object) }) as Msg
                )
              );
              const prevIds = new Set(msgsRef.current.map((m) => m.id));
              const hasNew = list.some((m) => !prevIds.has(m.id));
              msgsRef.current = list;
              setMsgs(list);
              // Legacy applyMsgScroll parity: auto-scroll only when the user
              // is already near the bottom (or first paint); otherwise show
              // the "new messages" pill so history reading isn't yanked.
              if (!hasNew) return;
              // D3 (R12): messages arrived while the thread is open —
              // mark them read (debounced) so readAt/unread stay fresh.
              markReadSoon();
              if (nearBottomNow()) {
                scrollBottom();
                setShowPill(false);
              } else {
                setShowPill(true);
              }
            },
            // D14 (R12, 18 Oct 2026): was silent () => {} — a rejected
            // read left an empty thread. Surface the error.
            (err) => {
              showToast(
                `${chatSt(getLang(), 'chatError')} [${(err as Error)?.message || 'snapshot'}]`
              );
            }
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

  // D3/D4/D5 (R12, 18 Oct 2026): markRead reworked.
  // - D4: the unread counter reset now happens AFTER the readAt batch
  //   commits (was: counter zeroed immediately, racing incoming messages).
  // - D5: the 50-message cap is removed — the batch marks all fetched
  //   messages (up to the 100 query limit; Firestore batches allow 500).
  // - D3: callers re-run markRead on new incoming messages (debounced)
  //   and on tab-visibility return, so readAt/unread never go stale.
  // FIX-ROUND-37 M2 (18 Oct 2026): the old code only fetched the newest
  // 100 messages — older unread messages kept single ✓ forever. Now
  // paginates through all messages (100/batch, up to 10 batches) using
  // the document-ID tiebreaker, marking every unread message from the
  // other participant. Requires the composite index
  // messages: at [DESCENDING] + __name__ [DESCENDING] — two orderBys
  // on different fields are never servable by single-field indexes.
  // (Round 39, 18 Oct 2026: index verified live in production.)
  async function markRead(client: FirebaseClient, data: ConvData, uid: string) {
    const { db, fsMod } = client;
    const other = (data.participants || []).find((p) => p !== uid) || '';
    const colRef = fsMod.collection(db, 'conversations', data.id, 'messages');
    let totalMarked = 0;
    try {
      let lastAt: unknown = null;
      let lastId: string | null = null;
      // Paginate until a short batch (< 100) or the 10-batch safety cap.
      for (let page = 0; page < 10; page++) {
        // Build the query conditionally to keep types simple.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any;
        if (lastAt !== null && lastId !== null) {
          q = fsMod.query(
            colRef,
            fsMod.orderBy('at', 'desc'),
            fsMod.orderBy(fsMod.documentId(), 'desc'),
            fsMod.startAfter(lastAt, lastId),
            fsMod.limit(100)
          );
        } else {
          q = fsMod.query(
            colRef,
            fsMod.orderBy('at', 'desc'),
            fsMod.orderBy(fsMod.documentId(), 'desc'),
            fsMod.limit(100)
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const snap: any = await fsMod.getDocs(q);
        if (!snap.docs.length) break;
        const batch = fsMod.writeBatch(db);
        let n = 0;
        for (const d of snap.docs) {
          const m = (d.data() || {}) as Record<string, unknown>;
          if (m.senderId === other && !m.isSystem && !m.readAt) {
            batch.update(d.ref, {
              readAt: fsMod.serverTimestamp(),
            });
            n++;
            if (n >= 500) break; // Firestore batch limit
          }
        }
        if (n) {
          await batch.commit().catch(() => {});
          totalMarked += n;
        }
        if (snap.docs.length < 100) break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lastDoc: any = snap.docs[snap.docs.length - 1];
        lastAt = (lastDoc.data() || {} as Record<string, unknown>).at;
        lastId = lastDoc.id;
      }
    } catch {
      /* best-effort */
    }
    // D4: reset the counter only after readAt commits, so a
    // message landing mid-flight doesn't get clobbered.
    const done = () => {
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
    };
    done();
  }

  // D3: debounced re-mark for messages arriving while the thread is open.
  const markReadDebounceRef = useRef(0);
  function markReadSoon() {
    const now = Date.now();
    if (now - markReadDebounceRef.current < 5000) return;
    markReadDebounceRef.current = now;
    const client = clientRef.current;
    const user = userRef.current;
    const c = convRef.current;
    if (client && user && c && !document.hidden) markRead(client, c, user.uid);
  }

  // D12 (R12, 18 Oct 2026): load messages older than the live newest-100
  // window.
  // FIX-ROUND-37 M1 (18 Oct 2026): the old code used startAfter on a bare
  // timestamp value — all docs sharing the boundary timestamp beyond the
  // 100-window were skipped forever. Now uses a document-ID tiebreaker:
  // orderBy('at', 'desc') + orderBy(documentId(), 'desc'), with
  // startAfter(oldestAt, oldestId). The boundary is the oldest SERVER
  // message (skips optimistic _sending rows whose temp IDs aren't
  // Firestore document IDs).
  async function loadOlderMessages() {
    const client = clientRef.current;
    if (!client || loadingOlder || !hasOlder) return;
    const { db, fsMod } = client;
    const all = [...olderMsgs, ...msgsRef.current];
    if (!all.length) return;
    // Oldest SERVER message by `at` (skip optimistic _sending rows —
    // their temp IDs are not Firestore document IDs and can't be used
    // as a __name__ tiebreaker).
    const serverMsgs = all.filter((m) => !m._sending && m.id && !m.id.startsWith('m_'));
    const pool = serverMsgs.length ? serverMsgs : all.filter((m) => m.id);
    if (!pool.length) return;
    const oldest = pool.reduce((a, b) => {
      const ta = a.at as unknown;
      const tb = b.at as unknown;
      const na =
        ta && typeof ta === 'object' && 'toMillis' in (ta as object)
          ? (ta as { toMillis(): number }).toMillis()
          : Number(ta) || 0;
      const nb =
        tb && typeof tb === 'object' && 'toMillis' in (tb as object)
          ? (tb as { toMillis(): number }).toMillis()
          : Number(tb) || 0;
      return na <= nb ? a : b;
    });
    const oldestAt = oldest.at as unknown;
    const oldestId = oldest.id;
    setLoadingOlder(true);
    try {
      const q = fsMod.query(
        fsMod.collection(db, 'conversations', convId, 'messages'),
        fsMod.orderBy('at', 'desc'),
        fsMod.orderBy(fsMod.documentId(), 'desc'),
        fsMod.startAfter(oldestAt, oldestId),
        fsMod.limit(100)
      );
      const snap = await fsMod.getDocs(q);
      // BF-4: same deterministic chronological order as the live window.
      const list: Msg[] = sortMsgsChronological(
        snap.docs.map(
          (d) => ({ id: d.id, ...((d.data() || {}) as object) }) as Msg
        )
      );
      // Dedupe against already-loaded IDs (overlap at the boundary).
      const seen = new Set(all.map((m) => m.id));
      const fresh = list.filter((m) => !seen.has(m.id));
      if (fresh.length) setOlderMsgs((prev) => [...fresh, ...prev]);
      if (list.length < 100) setHasOlder(false);
    } catch {
      showToast(st('errorGeneric'));
    } finally {
      setLoadingOlder(false);
    }
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
            // D13 (R12, 18 Oct 2026): deterministic message IDs for the
            // support greetings — two tabs opening support simultaneously
            // both passed the !exists() check and appended duplicate
            // greetings with random IDs. Fixed IDs make the second write
            // idempotent (overwrite, not duplicate).
            const sys = async (kind: string, fixedId: string) => {
              const mref = fsMod.doc(
                db,
                'conversations',
                convId,
                'messages',
                fixedId
              );
              const batch = fsMod.writeBatch(db);
              batch.set(
                mref,
                {
                  senderId: uid,
                  text: '',
                  at: fsMod.serverTimestamp(),
                  isSystem: true,
                  systemKind: kind,
                },
                { merge: true }
              );
              batch.update(fsMod.doc(db, `conversations/${convId}`), {
                updatedAt: fsMod.serverTimestamp(),
              });
              // 11 Oct 2026: timeout — hanging commit caused permanent send lock.
      await withTimeout(batch.commit(), 15000);
            };
            await sys('support_greeting', 'sys_support_greeting');
            await sys('support_autoreply', 'sys_support_autoreply');
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
      // R52: reload the Auth user first — user.emailVerified is cached on
      // the JS object; a user who verified in another tab would otherwise
      // be wrongly blocked from contacting the seller here.
      if (data.listingId !== 'support') {
        try {
          await client.authMod.reload(user);
        } catch {
          /* ignore — fall through to the cached flag */
        }
        if (!user.emailVerified) {
          setFatal(gst('mustVerifyChat'));
          return;
        }
      }

      // Header: peer name + listing chip
      const other = (data.participants || []).find((p) => p !== uid) || '';
      (async () => {
        let name = gst('unknownUser');
        if (data.listingId === 'support') name = gst('supportTitle');
        else if (data.listingId === 'announcements') name = gst('announcementsTitle');
        else if (other) {
          try {
            const d = await fsMod.getDoc(fsMod.doc(db, `users/${other}`));
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
        // D3 (R12): messages may have arrived while hidden — re-mark.
        markReadSoon();
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
    // D9 (R12, 18 Oct 2026): confine imageUrl to the sender's own R2
    // prefix. Rules enforce the domain; the path prefix
    // chat/{convId}/{uid}/ is enforced here so a participant cannot
    // re-attach another conversation's photo key.
    if (opts.imageUrl) {
      const expectedPrefix = `/chat/${convId}/${user.uid}/`;
      // FIX-ROUND-37 L3 (18 Oct 2026): parse the URL and check the
      // pathname with startsWith instead of a bare .includes() on the
      // full URL string (which could match a query param or fragment).
      let pathOk = false;
      try {
        const u = new URL(opts.imageUrl);
        pathOk = u.pathname.startsWith(expectedPrefix);
      } catch {
        pathOk = false;
      }
      if (!pathOk) {
        showToast(st('imageSendError'));
        return null;
      }
    }
    const msgId = opts.mid || mintMessageId(user.uid);
    const oUid = (c.participants || []).find((p) => p !== user.uid) || '';
    // D16 (R12, 18 Oct 2026): never write junk `unread.` / `hiddenFor`
    // entries when the peer uid is empty — skip those fields instead.
    const hasPeer = oUid !== '';
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
      // D16: only touch unread/hiddenFor when we have a real peer uid.
      const convUpdate: Record<string, unknown> = {
        updatedAt: fsMod.serverTimestamp(),
        lastUserMessageAt: fsMod.serverTimestamp(),
        lastMessage: {
          text: t ? t.slice(0, 500) : opts.imageUrl ? '📷' : '',
          proposalAmount: opts.proposal != null ? Number(opts.proposal) : null,
          senderId: user.uid,
          at: fsMod.serverTimestamp(),
        },
      };
      if (hasPeer) {
        convUpdate[`unread.${oUid}`] = fsMod.increment(1);
        convUpdate.hiddenFor = fsMod.arrayRemove(oUid);
      }
      batch.update(fsMod.doc(db, `conversations/${convId}`), convUpdate);
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
      // D15 (R12, 18 Oct 2026): expanded to ALL transient codes —
      // previously only permission-denied/deadline-exceeded were checked,
      // so unavailable/internal/cancelled after a commit produced
      // spurious failure banners (and, for photos, duplicates via D1).
      const code = (e as { code?: string })?.code;
      const TRANSIENT_CODES = new Set([
        'permission-denied',
        'deadline-exceeded',
        'unavailable',
        'internal',
        'cancelled',
        'unknown',
        'aborted',
        'resource-exhausted',
      ]);
      if (code && TRANSIENT_CODES.has(code)) {
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
    // D2 (R12, 18 Oct 2026): if the failure happened before the R2 upload,
    // there is nothing to resend (no text, no imageUrl, no proposal) —
    // calling sendChatMessage would hit its early return and silently
    // no-op while the error banner was already cleared. Surface a clear
    // error telling the user to re-pick the photo instead.
    if (!p.text && !p.imageUrl && p.proposal == null) {
      setFailedSend(null);
      showToast(st('imageSendError'));
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
    // BF-1 (R16, 18 Oct 2026): reject HEIC/HEIF upfront — Image() cannot
    // decode them, so they failed later with a generic error. Same
    // dedicated message as publish (photoHeic).
    if (/heic|heif/i.test(file.type) || /\.hei(c|f)$/i.test(file.name || '')) {
      showToast(st('photoHeic').replace('{name}', file.name || '?'));
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    // BF-2 (R16, 18 Oct 2026): reject GIFs — they were silently flattened
    // to a JPEG first frame with no notice that the animation was lost.
    // Rejecting with a clear message is the smaller, safer fix.
    if (file.type === 'image/gif' || /\.gif$/i.test(file.name || '')) {
      showToast(st('photoGif'));
      if (fileRef.current) fileRef.current.value = '';
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
        // 18 Oct 2026 (F1): Cache-Control is signed into the presigned URL —
        // the PUT must echo it exactly or R2 rejects the request (403).
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        body: blob,
      });
      if (!put.ok) throw new Error('r2-put');
      setStatusBar(null);
      // D1 (R12, 18 Oct 2026): sendChatMessage already sets failedSend with
      // the ORIGINAL mid on failure (idempotent retry). Do NOT overwrite
      // with a fresh mid here — the stale closure `failedSend` is always
      // null at this point, and a fresh mid would break idempotency and
      // deliver the photo twice if the original commit succeeded.
      await sendChatMessage({ imageUrl: publicUrl });
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
    const c = convRef.current;
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
    // FIX-ROUND-37 M3 (18 Oct 2026): system messages now update
    // lastMessage and bump the peer's unread counter, like regular
    // messages do. Previously only updatedAt was touched, so the
    // conversation-list preview showed stale text and no unread badge
    // appeared for phone requests/shares.
    // The preview text is rendered in the sender's current language via
    // the shared systemText() helper; the conversation list displays
    // lastMessage.text directly.
    const oUid = (c?.participants || []).find((p) => p !== user.uid) || '';
    const hasPeer = !!oUid && oUid !== 'support' && oUid !== 'announcements';
    const sysPreview = systemText(
      {
        id: '',
        senderId: user.uid,
        text: '',
        at: null,
        isSystem: true,
        systemKind: kind,
        systemArgs: args,
      },
      lang,
      // R23-3: the list preview stays in the sender's language AND the
      // sender's perspective (FIX-ROUND-37 M3 design, R23-5) — the actor
      // label resolves exactly as the sender sees it in-chat.
      { myUid: user.uid, peerName: otherName }
    );
    const convUpdate: Record<string, unknown> = {
      updatedAt: fsMod.serverTimestamp(),
      lastMessage: {
        text: sysPreview.slice(0, 500),
        isSystem: true,
        systemKind: kind,
        senderId: user.uid,
        at: fsMod.serverTimestamp(),
      },
    };
    if (hasPeer) {
      convUpdate[`unread.${oUid}`] = fsMod.increment(1);
      convUpdate.hiddenFor = fsMod.arrayRemove(oUid);
    }
    batch.update(fsMod.doc(db, `conversations/${convId}`), convUpdate);
    // 11 Oct 2026: timeout — prevents hang.
    await withTimeout(batch.commit(), 15000);
  }

  async function requestPhone() {
    // R5-4 (18 Oct 2026): the 3-decline permanent block is enforced
    // SERVER-SIDE by Firestore rules (phoneRequestOk: filing denied when
    // declinesByRequester[uid] >= 3). No client-side myBlocked check here
    // is needed for security — a modified client cannot bypass the rules.
    // The UI hides the button when pf.myBlocked (line ~1369); a stale-UI
    // write attempt would simply be rejected by Firestore.
    // D6 (R12, 18 Oct 2026): in-flight guard — double-tap fired two
    // updateDocs; the second was denied by rules with a generic error
    // toast. Guard client-side like answerPhone's phoneBusy.
    const client = clientRef.current;
    const user = userRef.current;
    const c = convRef.current;
    if (!client || !user || !c || blockedSendGuard() || requestPhoneBusy.current)
      return;
    requestPhoneBusy.current = true;
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
      // R23-3 fix: store ONLY a real first name (language-neutral).
      // The old `|| st('you')` fallback froze the writer-language word
      // for "you" into the stored message, mislabeling the actor for
      // every other viewer/language. With no name stored, the renderer
      // resolves the label per viewer from senderId (see
      // phoneRequestedText). Rules allow systemArgs absent or
      // {name}-only for phone_* kinds (systemMessageOk).
      const reqFirst = (user.displayName || '').trim().split(' ')[0];
      await appendSystem(
        'phone_requested',
        reqFirst ? { name: reqFirst } : {}
      ).catch(() => {});
    } catch {
      const rb = { ...c, phoneRequestBy: prevBy, phoneRequestStatus: prevStatus };
      convRef.current = rb;
      setConv(rb);
      showToast(st('errorGeneric'));
    } finally {
      requestPhoneBusy.current = false;
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
      // FIX-ROUND-37 L4 (18 Oct 2026): merge:true — a second reveal
      // (e.g. re-share after decline) must not wipe the first doc's
      // fields.
      await fsMod.setDoc(
        fsMod.doc(db, `reveals/${convId}`),
        {
          conversationId: convId,
          requesterId: c.phoneRequestBy || '',
          ownerId: user.uid,
          status: 'accepted',
          sharedPhone: normalized,
          updatedAt: fsMod.serverTimestamp(),
        },
        { merge: true }
      );
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
      <div className="min-h-screen bg-zinc-50" dir={dir}>
        <main id="main-content" className="max-w-2xl mx-auto px-4 py-16 text-center">
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
  // D12: render older (paginated) messages above the live window.
  const allMsgs = [...olderMsgs, ...msgs];
  const msgNodes = allMsgs.map((m) => {
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
            {systemText(m, lang, { myUid, peerName: otherName })}
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
            className={`flex items-center gap-1 mt-1 text-xs ${
              mine ? 'text-emerald-100' : 'text-zinc-400'
            }`}
          >
            {ts > 0 && <span>{fmtChatTime(ts)}</span>}
            {/* BF-3 (R16, 18 Oct 2026): sent indicator — single ✓ once the
                message is on the server (the onSnapshot echo replaces the
                _sending optimistic row), ✓✓ when read. Rows still sending
                show no check. */}
            {mine && (m.readAt ? <span>✓✓</span> : m._sending ? null : <span>✓</span>)}
          </div>
        </div>
      </div>
    );
    return nodes;
  });

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col" dir={dir}>
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
                className={`min-w-11 min-h-11 px-2 text-xs font-bold rounded ${
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
          {allMsgs.length === 0 ? (
            <div className="text-center py-10 text-zinc-500">
              <div className="text-4xl mb-2">👋</div>
              <p className="text-sm">{st('sayHello')}</p>
            </div>
          ) : (
            <>
              {/* D12: load older message history */}
              {hasOlder && allMsgs.length >= 100 && (
                <div className="text-center py-2">
                  <button
                    type="button"
                    onClick={loadOlderMessages}
                    disabled={loadingOlder}
                    className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-[13px] text-zinc-700 disabled:opacity-50"
                  >
                    {loadingOlder ? '…' : st('loadOlder')}
                  </button>
                </div>
              )}
              {msgNodes}
            </>
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
            <div className="text-xs text-amber-700 mb-1.5">
              {st('scamWarning')}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
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
