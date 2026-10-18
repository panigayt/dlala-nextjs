'use client';

// Conversations list — mirrors js/conversations.js.
// Rules-safe: query ONLY by .where('participants', 'array-contains', uid).
// Live onSnapshot subscription (new messages update previews/badges).
// All user-facing strings verbatim from js/i18n.ar.js (+ CHAT_L10N.ar
// fallbacks where the key only exists there).

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  useRequireAuth,
  LoadingSpinner,
  CompatQuerySnap,
  FirebaseClient,
  CompatUser,
  btnSecondaryCls,
} from '@/lib/firebase';
import { formatPrice, timeAgo } from '@/lib/firestore';
import { snapshotRead, snapshotWrite, snapMs } from '@/lib/snapshot';
import { convSt } from './conversations-strings';
import { useLang, type Lang } from '@/lib/i18n';

interface Conv {
  id: string;
  participants: string[];
  lastMessage?: {
    text?: string;
    proposalAmount?: number | null;
    senderId?: string;
  } | null;
  unread?: Record<string, number>;
  listingId?: string;
  sellerId?: string;
  buyerId?: string;
  hiddenFor?: string[];
  updatedAt?: unknown;
  createdAt?: unknown;
}

// Firestore Timestamp-ish → millis
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

// 0.0.0.22 (Zak): instant paint — last conversations render from
// localStorage, before the SDKs/auth/network. The live subscription then
// refreshes silently. Returns { convs, names, listings } or null.
function paintConvsSnapshot(): {
  convs: Conv[];
  names: Record<string, string>;
  listings: Record<string, { title: string; photo: string }>;
} | null {
  const snap = snapshotRead<{
    convs?: Record<string, unknown>[];
    names?: Record<string, string>;
    listings?: Record<string, { title: string; photo: string }>;
  }>('convs');
  if (!snap || !snap.data || !Array.isArray(snap.data.convs) || !snap.data.convs.length)
    return null;
  try {
    const convs = snap.data.convs
      .filter((c) => c && (c as { id?: unknown }).id)
      .map((c) => ({ ...c, id: String((c as { id: unknown }).id) }) as Conv);
    if (!convs.length) return null;
    return {
      convs,
      names: snap.data.names || {},
      listings: snap.data.listings || {},
    };
  } catch {
    return null;
  }
}

// Algerian phone shapes redacted in list previews (privacy) — mirrors
// conversations.js redactPhones (incl. Arabic-Indic digits).
const PHONE_DIGITS = '0-9\u0660-\u0669\u06F0-\u06F9';
const PHONE_LEAD = '0\u0660\u06F0';
const PHONE_RE = new RegExp(
  '(\\+213|[' + PHONE_LEAD + '])([\\s.\\-]*[' + PHONE_DIGITS + ']){8,9}',
  'g'
);
function redactPhones(s: string): string {
  return String(s).replace(PHONE_RE, '••••••••');
}

function previewText(conv: Conv, uid: string, lang: Lang): string {
  const lm = conv.lastMessage;
  if (!lm) return '';
  let s: string;
  if (lm.proposalAmount != null) s = '💰 ' + formatPrice(lm.proposalAmount, lang);
  else {
    const t = lm.text || '';
    s = t === '📷' ? '📷 ' + convSt(lang, 'photoLabel') : t;
  }
  if (uid && lm.senderId === uid) s = convSt(lang, 'you') + ': ' + s;
  return redactPhones(s);
}

// Legacy localizedText parity (js/app.js): map[LANG] first, then ar.
function localizedTitle(title: unknown, lang: Lang): string {
  if (!title) return '';
  if (typeof title === 'string') return title;
  if (typeof title === 'object') {
    const o = title as Record<string, string>;
    return o[lang] || o.ar || o.fr || o.en || '';
  }
  return '';
}

export default function ConversationsPage() {
  const authState = useRequireAuth();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [listings, setListings] = useState<
    Record<string, { title: string; photo: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  const clientRef = useRef<FirebaseClient | null>(null);
  const userRef = useRef<CompatUser | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  // Round 73 pattern (chat page): language switch re-renders = legacy
  // onLangChange() parity.
  const { lang } = useLang();
  const st = (k: string) => convSt(lang, k);

  const showToast = useCallback((msg: string, ms = 4000) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast(null);
      setHiddenId(null);
    }, ms);
  }, []);

  const loadMeta = useCallback(
    async (items: Conv[], uid: string, client: FirebaseClient, lang: Lang) => {
      const { db, fsMod } = client;
      const otherUids = [
        ...new Set(
          items
            .map((c) => (c.participants || []).find((p) => p !== uid) || '')
            .filter(Boolean)
        ),
      ];
      const listingIds = [
        ...new Set(
          items
            .map((c) => c.listingId || '')
            .filter(
              (id) => id && id !== 'support' && id !== 'announcements'
            )
        ),
      ];
      // Names
      const nameEntries = await Promise.all(
        otherUids.map(async (id) => {
          try {
            const d = await fsMod.getDoc(fsMod.doc(db, `users_public/${id}`));
            if (d.exists()) {
              const m = d.data() || {};
              const name =
                (m.name as string) ||
                ((m.username as string) ? '@' + m.username : '') ||
                convSt(lang, 'unknownUser');
              return [id, name] as const;
            }
          } catch {
            /* keep fallback */
          }
          return [id, convSt(lang, 'unknownUser')] as const;
        })
      );
      // Listings
      const listingEntries = await Promise.all(
        listingIds.map(async (id) => {
          try {
            const d = await fsMod.getDoc(fsMod.doc(db, `listings/${id}`));
            if (d.exists()) {
              const m = d.data() || {};
              const thumbs =
                (m.photo_thumbs as (string | null)[]) ||
                (m.thumbUrls as string[]) ||
                (m.photoUrls as string[]) ||
                [];
              return [
                id,
                { title: localizedTitle(m.title, lang) || convSt(lang, 'deletedListing'), photo: thumbs[0] || '' },
              ] as const;
            }
          } catch {
            /* keep fallback */
          }
          return [id, { title: convSt(lang, 'deletedListing'), photo: '' }] as const;
        })
      );
      setNames((prev) => {
        const next = { ...prev };
        for (const [id, name] of nameEntries) next[id] = name;
        return next;
      });
      setListings((prev) => {
        const next = { ...prev };
        for (const [id, info] of listingEntries) next[id] = info;
        return next;
      });
      // Return fresh maps for snapshot writing (0.0.0.22).
      return {
        names: Object.fromEntries(nameEntries),
        listings: Object.fromEntries(listingEntries),
      };
    },
    []
  );

  const subscribe = useCallback(
    (client: FirebaseClient, user: CompatUser, lang: Lang) => {
      const uid = user.uid;
      const { db, fsMod } = client;
      if (unsubRef.current) {
        try {
          unsubRef.current();
        } catch {
          /* noop */
        }
        unsubRef.current = null;
      }
      const onSnap = (snap: CompatQuerySnap) => {
        setError(null);
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...((d.data() || {}) as object) }) as Conv)
          .filter((c) => !(c.hiddenFor || []).includes(uid))
          .sort((a, b) => tsMs(b.updatedAt) - tsMs(a.updatedAt));
        setConvs(docs);
        // 0.0.0.22 (Zak): save the fresh render for instant paint on next
        // boot. Best-effort; the live subscription is the source of truth.
        loadMeta(docs, uid, client, lang).then((meta) => {
          try {
            snapshotWrite('convs', uid, {
              convs: docs.map((c) => ({
                id: c.id,
                participants: c.participants || [],
                lastMessage: c.lastMessage || null,
                unread: c.unread || {},
                listingId: c.listingId || '',
                hiddenFor: c.hiddenFor || [],
                updatedAt: snapMs(c.updatedAt),
                createdAt: snapMs(c.createdAt),
              })),
              names: meta.names,
              listings: meta.listings,
            });
          } catch {
            /* best-effort */
          }
        }).catch(() => {
          /* meta load failed — skip snapshot */
        });
      };
      const onErr = () => {
        setError(convSt(lang, 'errorGeneric'));
      };
      // Round 153: removed Firestore orderBy('updatedAt') — it requires a
      // composite index (participants array-contains + updatedAt desc) that
      // may not exist, causing the list to appear empty. onSnap already
      // sorts client-side via tsMs(), so the server-side orderBy is redundant.
      unsubRef.current = fsMod.onSnapshot(
        fsMod.query(
          fsMod.collection(db, 'conversations'),
          fsMod.where('participants', 'array-contains', uid),
          fsMod.limit(60)
        ),
        onSnap,
        onErr
      );
    },
    // lang is passed as an argument (not closed over); the effect lists it
    // in deps so a language switch re-subscribes with the new lang
    // (legacy onLangChange() re-render parity).
    [loadMeta]
  );

  useEffect(() => {
    if (authState.status !== 'signed-in') return;
    clientRef.current = authState.client;
    userRef.current = authState.user;
    /* eslint-disable react-hooks/set-state-in-effect -- 0.0.0.22 instant paint: synchronous snapshot paint on mount */
    // 0.0.0.22 (Zak): paint the last good render synchronously, before the
    // live subscription delivers. The subscription then refreshes silently.
    try {
      const cached = paintConvsSnapshot();
      if (cached) {
        setConvs(cached.convs);
        setNames(cached.names);
        setListings(cached.listings);
      }
    } catch {
      /* fall through to the live path */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    subscribe(authState.client, authState.user, lang);
    const onVis = () => {
      if (
        !document.hidden &&
        clientRef.current &&
        userRef.current
      ) {
        subscribe(clientRef.current, userRef.current, lang);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (unsubRef.current) {
        try {
          unsubRef.current();
        } catch {
          /* noop */
        }
        unsubRef.current = null;
      }
    };
  }, [authState, subscribe, lang]);

  async function hideConversation(id: string) {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) return;
    // 11 Oct 2026: removed window.confirm — hangs headless browsers.
    // Hide is reversible (conversation reappears on new message).
    try {
      const { db, fsMod } = client;
      await fsMod.updateDoc(fsMod.doc(db, `conversations/${id}`), {
        hiddenFor: fsMod.arrayUnion(user.uid),
      });
      setConvs((prev) => prev.filter((c) => c.id !== id));
      setHiddenId(id);
      showToast(st('chatHidden'), 6000);
    } catch {
      showToast(st('errorGeneric'));
    }
  }

  async function undoHide(id: string) {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) return;
    try {
      const { db, fsMod } = client;
      await fsMod.updateDoc(fsMod.doc(db, `conversations/${id}`), {
        hiddenFor: fsMod.arrayRemove(user.uid),
      });
      if (clientRef.current && userRef.current)
        subscribe(clientRef.current, userRef.current, lang);
    } catch {
      showToast(st('errorGeneric'));
    }
    setToast(null);
    setHiddenId(null);
  }

  if (authState.status !== 'signed-in') {
    return <LoadingSpinner label={st('loading')} />;
  }
  const uid = authState.user.uid;
  const hasSupport = convs.some((c) => c.listingId === 'support');

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main id="main-content" className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-zinc-900 mb-4">{st('messages')}</h1>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-3 text-sm text-red-700">
            <p className="mb-2">⚠️ {error}</p>
            <button
              className={btnSecondaryCls}
              onClick={() =>
                clientRef.current &&
                userRef.current &&
                subscribe(clientRef.current, userRef.current, lang)
              }
            >
              {st('retry')}
            </button>
          </div>
        )}

        <div className="space-y-2">
          {!hasSupport && (
            <a
              href={`/chat/supp_${uid}`}
              className="flex items-center gap-3 rounded-xl bg-white shadow-sm p-3 no-underline hover:bg-zinc-50"
            >
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-2xl shrink-0">
                🎧
              </div>
              <div className="min-w-0">
                <div className="font-bold text-zinc-900">{st('supportTitle')}</div>
                <div className="text-sm text-zinc-500 truncate">
                  {st('supportContact')}
                </div>
              </div>
            </a>
          )}

          {convs.map((c) => {
            const other = (c.participants || []).find((p) => p !== uid) || '';
            const isSupport = c.listingId === 'support';
            const isAnn = c.listingId === 'announcements';
            const isSellerHere = c.sellerId === uid && c.buyerId !== uid;
            const name = isSupport
              ? st('supportTitle')
              : isAnn
                ? st('announcementsTitle')
                : names[other] || st('unknownUser');
            const li = c.listingId ? listings[c.listingId] : undefined;
            const unreadNum = Number((c.unread && c.unread[uid]) || 0) || 0;
            const when = timeAgo(
              tsMs(c.updatedAt || c.createdAt)
                ? new Date(tsMs(c.updatedAt || c.createdAt))
                : undefined,
              lang
            );
            return (
              <div
                key={c.id}
                className="flex items-center gap-1 rounded-xl bg-white shadow-sm p-3"
              >
                <a
                  href={`/chat/${encodeURIComponent(c.id)}`}
                  className="flex items-center gap-3 flex-1 min-w-0 no-underline"
                >
                  <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center text-2xl shrink-0 overflow-hidden relative">
                    {isSupport ? (
                      '🎧'
                    ) : isAnn ? (
                      '📢'
                    ) : li && li.photo ? (
                      <Image
                        src={li.photo}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : (
                      '💬'
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-zinc-900 truncate">
                        {name}
                      </span>
                      <span className="text-xs text-zinc-400 shrink-0">
                        {when}
                      </span>
                    </div>
                    {li && li.title && !isSupport && !isAnn && (
                      <div className="text-xs text-zinc-500 truncate">
                        {li.title}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-500 truncate">
                        {previewText(c, uid, lang)}
                      </span>
                      {unreadNum > 0 && (
                        <span className="shrink-0 min-w-5 h-5 px-1 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">
                          {unreadNum}
                        </span>
                      )}
                    </div>
                  </div>
                </a>
                {!isSellerHere && (
                  <button
                    className="shrink-0 w-8 h-8 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                    title={st('hideChat')}
                    aria-label={st('hideChat')}
                    onClick={() => hideConversation(c.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}

          {convs.length === 0 && !error && (
            <div className="rounded-xl bg-white shadow-sm p-8 text-center">
              <div className="text-5xl mb-3">💬</div>
              <h3 className="font-bold text-zinc-900 mb-1">
                {st('noConversations')}
              </h3>
              <p className="text-sm text-zinc-500">{st('noConversationsHint')}</p>
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-zinc-900 text-white px-5 py-3 shadow-lg">
          <span className="text-sm">{toast}</span>
          {hiddenId && (
            <button
              className="text-sm font-bold text-emerald-300 hover:text-emerald-200"
              onClick={() => undoHide(hiddenId)}
            >
              {st('undo')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
