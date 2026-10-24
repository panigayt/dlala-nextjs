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
  FirebaseDocSnap,
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

// R32-3 (24 Oct 2026): first paint loads only the 20 most recent threads;
// older threads page in by 20 (one-time queries) up to the 60-thread cap.
// The 60-thread upfront load (docs + per-thread user/listing meta + a
// photo per thread) was the weight on weak connections for heavy users.
// The live listener still covers the top window, so new messages surface
// immediately; paged rows merge underneath, deduped by id, newest first.
const CONV_PAGE = 20;
const CONV_CAP = 60;

// Merge live top-window docs with older paged docs. On id collision the
// freshest copy wins: live overwrites pages, and a later page overwrites
// an earlier one (a re-fetched page is newer than the rows it overlaps).
// Hidden threads stay filtered; the result is newest-first.
function mergeConvs(live: Conv[], paged: Conv[], uid: string): Conv[] {
  const byId = new Map<string, Conv>();
  for (const c of paged) {
    if (c && c.id) byId.set(c.id, c);
  }
  for (const c of live) {
    if (c && c.id) byId.set(c.id, c);
  }
  const out = [...byId.values()].filter(
    (c) => !(c.hiddenFor || []).includes(uid)
  );
  out.sort((a, b) => tsMs(b.updatedAt) - tsMs(a.updatedAt));
  return out;
}

// Snapshot subset for one thread (same shape the instant-paint snapshot
// has always stored).
function snapshotConvShape(c: Conv) {
  return {
    id: c.id,
    participants: c.participants || [],
    lastMessage: c.lastMessage || null,
    unread: c.unread || {},
    listingId: c.listingId || '',
    hiddenFor: c.hiddenFor || [],
    updatedAt: snapMs(c.updatedAt),
    createdAt: snapMs(c.createdAt),
  };
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
  // R32-3: the rendered list merges the live top window (listener) with
  // older pages (one-time queries). Refs mirror the two sets so the
  // snapshot handler and load-more merge without stale closures.
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const liveRef = useRef<Conv[]>([]);
  const pagedRef = useRef<Conv[]>([]);
  const cursorRef = useRef<FirebaseDocSnap | null>(null);
  const pageEndRef = useRef(false);
  const subEpochRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [listings, setListings] = useState<
    Record<string, { title: string; photo: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  // R30-1 (24 Oct 2026): has a SERVER snapshot confirmed the initial
  // load? A Firestore listener never errors on connectivity loss — it
  // delivers cache snapshots (or stays silent) — so an outage used to
  // render the "no conversations" empty state for accounts that HAVE
  // conversations. The empty state is gated on this flag; before it, a
  // spinner shows, and a watchdog (see subscribe) raises the error
  // banner if the server never confirms.
  const [serverLoaded, setServerLoaded] = useState(false);
  const clientRef = useRef<FirebaseClient | null>(null);
  const userRef = useRef<CompatUser | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const serverLoadedRef = useRef(false);
  const watchdogRef = useRef<number | null>(null);
  const langRef = useRef<Lang>('ar');
  // D10 (R12, 18 Oct 2026): cache resolved peer names + listing meta
  // across snapshots — loadMeta was re-fetching every doc on every live
  // update (N+1 read amplification). Only uncached IDs are fetched now.
  // Cache is keyed by language (names/titles are localized).
  const metaCacheRef = useRef<{
    lang: string;
    names: Record<string, string>;
    listings: Record<string, { title: string; photo: string }>;
  }>({ lang: '', names: {}, listings: {} });
  // Round 73 pattern (chat page): language switch re-renders = legacy
  // onLangChange() parity.
  const { lang, t } = useLang();
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
      const cache = metaCacheRef.current;
      // D10: invalidate the cache on language switch (strings localized).
      if (cache.lang !== lang) {
        cache.lang = lang;
        cache.names = {};
        cache.listings = {};
      }
      const otherUids = [
        ...new Set(
          items
            .map((c) => (c.participants || []).find((p) => p !== uid) || '')
            .filter(Boolean)
            // D10: skip already-cached peers.
            .filter((id) => !(id in cache.names))
        ),
      ];
      const listingIds = [
        ...new Set(
          items
            .map((c) => c.listingId || '')
            .filter(
              (id) => id && id !== 'support' && id !== 'announcements'
            )
            // D10: skip already-cached listings.
            .filter((id) => !(id in cache.listings))
        ),
      ];
      // Names
      const nameEntries = await Promise.all(
        otherUids.map(async (id) => {
          try {
            const d = await fsMod.getDoc(fsMod.doc(db, `users/${id}`));
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
      // D10: populate the cross-snapshot cache with freshly resolved entries.
      for (const [id, name] of nameEntries) metaCacheRef.current.names[id] = name;
      for (const [id, info] of listingEntries)
        metaCacheRef.current.listings[id] = info;
      // Return fresh maps for snapshot writing (0.0.0.22).
      return {
        names: Object.fromEntries(nameEntries),
        listings: Object.fromEntries(listingEntries),
      };
    },
    []
  );

  // R32-3: write the instant-paint snapshot from the MERGED list (live +
  // loaded pages) with the ACCUMULATED meta maps (metaCacheRef, not just
  // the fresh entries of the latest fetch — otherwise a repaint after a
  // cached-meta update would lose names/titles the user already sees).
  const writeConvsSnapshot = useCallback((uid: string) => {
    try {
      snapshotWrite('convs', uid, {
        convs: mergeConvs(liveRef.current, pagedRef.current, uid).map(
          snapshotConvShape
        ),
        names: { ...metaCacheRef.current.names },
        listings: { ...metaCacheRef.current.listings },
      });
    } catch {
      /* best-effort */
    }
  }, []);

  const subscribe = useCallback(
    (client: FirebaseClient, user: CompatUser, lang: Lang) => {
      const uid = user.uid;
      const { db, fsMod } = client;
      // R32-3: a fresh subscription restarts pagination — pages and their
      // cursor belong to the previous subscription epoch, so stale pages
      // must not mix with the new top window. loadMore ignores results
      // from an older epoch (subEpochRef) for the same reason. Note this
      // also means a returning tab (visibility re-subscribe) drops loaded
      // older pages back to the top window + load-more — correctness over
      // keeping them across a cursor-invalidating resubscribe.
      pagedRef.current = [];
      cursorRef.current = null;
      pageEndRef.current = false;
      subEpochRef.current += 1;
      setHasMore(false);
      if (unsubRef.current) {
        try {
          unsubRef.current();
        } catch {
          /* noop */
        }
        unsubRef.current = null;
      }
      langRef.current = lang;
      const onSnap = (snap: CompatQuerySnap) => {
        // R30-1: only a server snapshot (metadata.fromCache === false)
        // confirms the load — it clears any error and unlocks the
        // empty state. Cache snapshots still render their docs (real
        // local data, e.g. a warm re-subscribe); they just don't
        // confirm, so an offline empty cache can no longer masquerade
        // as "you have no conversations".
        if (!snap.metadata.fromCache) {
          serverLoadedRef.current = true;
          setServerLoaded(true);
          if (watchdogRef.current) {
            window.clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
          }
          setError(null);
        }
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...((d.data() || {}) as object) }) as Conv)
          .filter((c) => !(c.hiddenFor || []).includes(uid))
          .sort((a, b) => tsMs(b.updatedAt) - tsMs(a.updatedAt));
        // R32-3: the live window replaces the top of the list; older
        // pages stay merged underneath. The cursor for the first older
        // page is the query's last document (not the last visible one —
        // hidden docs still occupy a slot in query order); it is only
        // (re)set while unset, so a live update never breaks the page
        // chain a loadMore is walking. hasMore uses the RAW query size
        // (snap.docs), not the hidden-filtered count — a full window of
        // hidden threads must not end the chain.
        liveRef.current = docs;
        const merged = mergeConvs(docs, pagedRef.current, uid);
        setConvs(merged);
        if (cursorRef.current === null) {
          const qdocs = snap.docs;
          cursorRef.current = qdocs.length ? qdocs[qdocs.length - 1] : null;
        }
        if (pagedRef.current.length === 0) {
          setHasMore(
            snap.docs.length === CONV_PAGE && merged.length < CONV_CAP
          );
        } else {
          setHasMore(!pageEndRef.current && merged.length < CONV_CAP);
        }
        // 0.0.0.22 (Zak): save the fresh render for instant paint on next
        // boot. Best-effort; the live subscription is the source of truth.
        loadMeta(docs, uid, client, lang).then(() => {
          writeConvsSnapshot(uid);
        }).catch(() => {
          /* meta load failed — skip snapshot */
        });
      };
      const onErr = () => {
        setError(convSt(lang, 'errorGeneric'));
      };
      // FIX-ROUND-37 H1 (18 Oct 2026): restored server-side
      // orderBy('updatedAt', 'desc'). Without it, the top window would be
      // an arbitrary slice and users with many conversations could lose
      // recent threads. Requires the composite index
      // conversations: participants [CONTAINS] + updatedAt [DESCENDING]
      // (declared in dlala-app/firebase/firestore.indexes.json).
      // R32-3: the listener covers only the first CONV_PAGE threads;
      // older threads page in via loadMore (same where + orderBy +
      // startAfter cursor), up to the CONV_CAP total.
      unsubRef.current = fsMod.onSnapshot(
        fsMod.query(
          fsMod.collection(db, 'conversations'),
          fsMod.where('participants', 'array-contains', uid),
          fsMod.orderBy('updatedAt', 'desc'),
          fsMod.limit(CONV_PAGE)
        ),
        onSnap,
        onErr
      );
      // R30-1 watchdog: if no server snapshot confirms the load within
      // the window, surface the error banner (its retry re-subscribes
      // and re-arms). 15s matches the withTimeout idiom used across
      // the app and stays patient on the weak connections Dlala is
      // designed for; a late server snapshot clears the banner again
      // (onSnap above). Painted/cached conversations stay visible
      // beneath the banner — only the false EMPTY claim is suppressed.
      if (!serverLoadedRef.current) {
        if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
        watchdogRef.current = window.setTimeout(() => {
          watchdogRef.current = null;
          if (!serverLoadedRef.current) {
            setError(convSt(langRef.current, 'errorGeneric'));
          }
        }, 15000);
      }
    },
    // lang is passed as an argument (not closed over); the effect lists it
    // in deps so a language switch re-subscribes with the new lang
    // (legacy onLangChange() re-render parity).
    [loadMeta, writeConvsSnapshot]
  );

  // R32-3: fetch the next CONV_PAGE older threads (one-time query, not a
  // listener) and merge them into the rendered list. The chain stops at
  // a short page (server exhausted) or at the CONV_CAP total.
  async function loadMore() {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user || loadingMoreRef.current) return;
    const cursor = cursorRef.current;
    if (!cursor) return;
    const uid = user.uid;
    const lang = langRef.current;
    const epoch = subEpochRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const { db, fsMod } = client;
      const snap = await fsMod.getDocs(
        fsMod.query(
          fsMod.collection(db, 'conversations'),
          fsMod.where('participants', 'array-contains', uid),
          fsMod.orderBy('updatedAt', 'desc'),
          fsMod.startAfter(cursor),
          fsMod.limit(CONV_PAGE)
        )
      );
      // A resubscribe in the meantime restarts pagination — discard
      // this stale page rather than mixing epochs.
      if (epoch !== subEpochRef.current) return;
      const rawDocs = snap.docs;
      const pageDocs = rawDocs
        .map((d) => ({ id: d.id, ...((d.data() || {}) as object) }) as Conv)
        .filter((c) => !(c.hiddenFor || []).includes(uid));
      pagedRef.current = [...pagedRef.current, ...pageDocs];
      if (rawDocs.length) cursorRef.current = rawDocs[rawDocs.length - 1];
      pageEndRef.current = rawDocs.length < CONV_PAGE;
      const merged = mergeConvs(liveRef.current, pagedRef.current, uid);
      setConvs(merged);
      setHasMore(!pageEndRef.current && merged.length < CONV_CAP);
      // Resolve meta for the new page only (D10 cache skips the rest),
      // then refresh the instant-paint snapshot with the merged list.
      loadMeta(pageDocs, uid, client, lang).then(() => {
        if (epoch === subEpochRef.current) writeConvsSnapshot(uid);
      }).catch(() => {
        /* meta load failed — skip snapshot */
      });
    } catch {
      showToast(t('loadMoreFailed'));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

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
      if (watchdogRef.current) {
        window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
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
      // R32-3: drop the thread from both sets, then re-merge.
      liveRef.current = liveRef.current.filter((c) => c.id !== id);
      pagedRef.current = pagedRef.current.filter((c) => c.id !== id);
      setConvs(mergeConvs(liveRef.current, pagedRef.current, user.uid));
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

          {/* R32-3: older threads page in by 20, up to the 60-thread cap. */}
          {hasMore && (
            <div className="text-center pt-2">
              <button
                className="rounded-lg bg-emerald-700 px-6 py-2.5 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? '…' : t('loadMore')}
              </button>
            </div>
          )}

          {convs.length === 0 && !error && !serverLoaded && (
            <div className="text-center py-10">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-700" />
              <p className="mt-3 text-zinc-600">{st('loading')}</p>
            </div>
          )}

          {/* R30-1: the empty state renders ONLY after a server snapshot
              confirmed the load — never from a silent/cache-only load. */}
          {convs.length === 0 && !error && serverLoaded && (
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
