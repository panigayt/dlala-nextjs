'use client';

// Home feed grid with "load more" pagination (Round 39).
//
// The server renders the first page (24 regular + interleaved wanted ads).
// This client component appends further pages: it fetches regular listings
// from /api/feed?offset=N and interleaves the server-provided wanted pool
// using the verbatim interleaveWanted() logic (js/market.js).
//
// Legacy parity notes (js/home.js):
// - "عرض المزيد" button (t('loadMore')) appears when moreAvailable.
// - Wanted rotation continues across pages (wantedOffset tracks consumption).

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import ListingCardView from '@/components/ListingCardView';
// Round 4 (18 Oct 2026, audit R-1): VitrineShowcase is below-fold and
// conditional — lazy-load it to reduce home first-load JS.
const VitrineShowcase = lazy(() => import('@/components/VitrineShowcase'));
import { interleaveWanted, resultsCountText, cardImage, type ListingCard, type VitrineShowcaseData } from '@/lib/firestore';
import { tasteRankDefault } from '@/lib/taste';
// Round 12: this file is a firebase-compat user → bundled path. Type-only
// imports are erased at compile time (zero bundle cost); the loader module
// itself is fetched lazily inside the hook below, so the SDK stays off the
// initial home chunk (weak-network critical path).
import { useAuthState } from '@/lib/firebase';
import { useLang } from '@/lib/i18n';
// 11 Oct 2026: withTimeout now in @/lib/timeout — no firebase-compat import.
import { withTimeout } from '@/lib/timeout';
import {
  applyFollowBoost,
  newFromFollows,
  loadFollowedCache,
  saveFollowedCache,
  setsEqual,
} from '@/lib/followBoost';
import {
  selectVitrineShowcases,
  recordVitrineShown,
  vitrineNoRepeatLoad,
  vitrineSlotIndices,
  VITRINE_MAX,
  type VitrineShowcase as Showcase,
  type VitrineSeller,
} from '@/lib/vitrine';

const PAGE_SIZE = 24;

interface FeedPage {
  regular: ListingCard[];
  hasMore: boolean;
}

export default function FeedWithLoadMore({
  initialCards,
  wantedPool,
  initialRegularOffset,
  initialWantedOffset,
  initialHasMore,
}: {
  initialCards: ListingCard[];
  wantedPool: ListingCard[];
  initialRegularOffset: number;
  initialWantedOffset: number;
  initialHasMore: boolean;
}) {
  const [cards, setCards] = useState<ListingCard[]>(initialCards);
  const [regularOffset, setRegularOffset] = useState(initialRegularOffset);
  const [wantedOffset, setWantedOffset] = useState(initialWantedOffset);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Vitrine showcases (R17 no-repeat model, js/home.js insertVitrineCards):
  // fetched client-side after paint, filtered by per-viewer localStorage
  // state, inserted after card 2 then every 8, max 3 per load.
  const [showcases, setShowcases] = useState<Showcase[]>([]);
  const vitrineDone = useRef(false);
  // Tracks the taste-ranked regular cards currently displayed, so "show
  // more" can pass the FULL regular pool to the taste append path
  // (js/taste.js: the append call receives old+new; only fresh docs are
  // ranked and appended — visible order is never reshuffled).
  const regularRef = useRef<ListingCard[] | null>(null);
  // Raw (pre-taste) regular pool — the «جديد من متابَعيك» strip renders
  // from the same default/recent pool the main feed uses (js/home.js
  // renderFollowsSection parity: no extra queries).
  const rawRegularRef = useRef<ListingCard[] | null>(null);
  // First-page wanted cards, kept for the follow-refresh recompute.
  const wantedRef = useRef<ListingCard[] | null>(null);
  // Followed seller set: seeded synchronously from the localStorage
  // cache at first paint, refreshed once auth settles (js/home.js
  // followedSet() pattern). null = not seeded yet.
  const followedRef = useRef<Set<string> | null>(null);
  // «جديد من متابَعيك» strip cards.
  const [stripCards, setStripCards] = useState<ListingCard[]>([]);
  // Round 160: prefetched next page — { offset, page } when the upcoming
  // /api/feed?offset=N JSON (plus its card images) was warmed in the
  // background. loadMore() consumes it instead of fetching, so the new
  // cards paint with their images already in the browser cache.
  const prefetchRef = useRef<{ offset: number; page: FeedPage } | null>(null);
  const prefetchingRef = useRef<number | null>(null); // offset currently warming
  const loadMoreWrapRef = useRef<HTMLDivElement | null>(null);
  // Live copy of regularOffset for the prefetch observer (avoids a stale
  // closure — the observer effect runs once on mount).
  const regularOffsetRef = useRef(initialRegularOffset);
  const { t, lang } = useLang();
  const auth = useAuthState();
  const refreshedUid = useRef<string | null>(null);

  // Taste personalization (js/taste.js, Zak 18 Sep 2026): invisible
  // on-device ranking of the default feed — 25% taste / 75% exploration.
  // Client-only (localStorage/sessionStorage): the SSR paint shows the
  // default order first, then this re-ranks — order change only, no visual
  // change. Composition mirrors js/home.js exactly: taste ranks the
  // REGULAR pool, then the wanted interleave is applied on top.
  /* eslint-disable react-hooks/set-state-in-effect -- client-only re-rank after SSR paint, runs once */
  useEffect(() => {
    try {
      const regular = initialCards.filter((c) => !c.isWanted);
      const wanted = initialCards.filter((c) => c.isWanted);
      rawRegularRef.current = regular;
      wantedRef.current = wanted;
      const ranked = tasteRankDefault(regular, { bump: true });
      regularRef.current = ranked;
      // Follow boost (js/home.js v101, Zak 16 Sep 2026): AFTER the taste
      // ranking — 1 followed slot per 4, recency leads inside each group.
      // The followed set is seeded synchronously from the localStorage
      // cache ('dlala_followed_v1', shared with the legacy SPA) and
      // refreshed below once auth settles (legacy followedSet() pattern).
      const seeded = loadFollowedCache();
      followedRef.current = seeded;
      setCards(interleaveWanted(applyFollowBoost(ranked, seeded), wanted));
    } catch {
      /* taste/follow must never break the feed */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Followed-set refresh once auth settles (legacy refreshFollowedSet).
  // Recomputes the first-page composition and the «جديد من متابَعيك»
  // strip with the server-authoritative set. Guests get an empty set
  // (no boost, no strip — js/home.js renderFollowsSection parity).
  useEffect(() => {
    if (auth.status === 'loading') return;
    if (auth.status === 'signed-out') {
      followedRef.current = new Set();
      setStripCards([]);
      refreshedUid.current = null;
      return;
    }
    const { user, client } = auth;
    if (refreshedUid.current === user.uid) return;
    refreshedUid.current = user.uid;
    (async () => {
      try {
        // Round 12: modular Firestore over the bundled path.
        const { db, fsMod } = client;
        const snap = await withTimeout(
          fsMod.getDocs(
            fsMod.query(
              fsMod.collection(db, 'follows'),
              fsMod.where('followerId', '==', user.uid),
              fsMod.limit(200)
            )
          ),
          20000
        );
        const fresh = new Set<string>();
        for (const d of snap.docs) {
          const sid = d.data().storeId;
          if (sid) fresh.add(String(sid));
        }
        if (setsEqual(followedRef.current, fresh)) return; // no pointless reshuffle
        followedRef.current = fresh;
        saveFollowedCache(fresh);
        // Recompute the visible first-page composition with the fresh set
        // (legacy feed re-render on follow refresh).
        const ranked = regularRef.current;
        const wanted = wantedRef.current;
        if (ranked && wanted) {
          setCards(interleaveWanted(applyFollowBoost(ranked, fresh), wanted));
        }
        const rawRegular = rawRegularRef.current;
        if (rawRegular) {
          setStripCards(newFromFollows(rawRegular, fresh));
        }
      } catch {
        /* follow refresh must never break the feed */
      }
    })();
  }, [auth]);

  // Vitrine showcase insertion (js/home.js insertVitrineCards, R17 model).
  // Async + best-effort: the feed is already painted when this runs.
  // Fetches candidates from /api/vitrine-showcases, applies the per-viewer
  // no-repeat filter (localStorage), selects up to VITRINE_MAX showcases
  // (boosted/pro prioritized), and records them as shown.
  useEffect(() => {
    if (vitrineDone.current) return;
    vitrineDone.current = true;
    (async () => {
      try {
        const res = await fetch('/api/vitrine-showcases', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const raw: VitrineShowcaseData[] = data?.showcases || [];
        if (!raw.length) return;

        // Build the selection inputs (legacy selectVitrineShowcases shape).
        const usersById: Record<string, VitrineSeller> = {};
        const listings: ListingCard[] = [];
        for (const sh of raw) {
          const sid = sh.seller.id;
          usersById[sid] = {
            id: sid,
            name: sh.seller.name,
            storeName: sh.seller.storeName,
            storeTier: sh.seller.storeTier,
            verified: sh.seller.verified,
            emailVerified: sh.seller.emailVerified,
            rating: sh.seller.rating,
            ratingCount: sh.seller.ratingCount,
            followerCount: sh.seller.followerCount,
            vitrineIds: sh.seller.vitrineIds,
            vitrineBoostUntil: sh.seller.vitrineBoostUntil,
          };
          for (const p of sh.products) listings.push(p);
        }
        // Rotation: bump per page view (legacy VITRINE_ROT_KEY, session).
        let rotation = 0;
        try {
          rotation = (Number(sessionStorage.getItem('dlala_vitrine_rot')) || 0) + 1;
          sessionStorage.setItem('dlala_vitrine_rot', String(rotation));
        } catch {
          /* session storage unavailable: rotation stays 0 */
        }
        const noRepeat = vitrineNoRepeatLoad(refreshedUid.current ?? undefined);
        const sel = selectVitrineShowcases({
          listings,
          usersById,
          rotation,
          noRepeat,
          maxShowcases: VITRINE_MAX,
        });
        const chosen = sel.shown.concat(sel.fallback);
        if (!chosen.length) return;
        setShowcases(chosen);
        recordVitrineShown(
          sel.shown,
          sel.fallback.slice(0, Math.max(0, chosen.length - sel.shown.length)),
          noRepeat,
          refreshedUid.current ?? undefined
        );
      } catch {
        /* vitrine must never break the feed */
      }
    })();
  }, []);

  // Round 160: fetch one feed page + revive the createdAt Date contract
  // (Round 139 fix, extracted so both click-load and background prefetch
  // share the exact same shaping).
  async function fetchFeedPage(offset: number): Promise<FeedPage> {
    // 11 Oct 2026: timeout — stuck load-more on weak connections.
    const res = await withTimeout(
      fetch(`/api/feed?offset=${offset}`, { cache: 'no-store' }),
      20000
    );
    if (!res.ok) throw new Error(`feed-${res.status}`);
    const page: FeedPage = await res.json();
    const freshRegular: ListingCard[] = (page.regular || []).map((c) => {
      const ca = (c as { createdAt?: unknown }).createdAt;
      if (ca && !(ca instanceof Date)) {
        const d = new Date(String(ca));
        return { ...c, createdAt: isNaN(d.getTime()) ? undefined : d };
      }
      return c;
    });
    return { regular: freshRegular, hasMore: page.hasMore };
  }

  // Round 160: warm the next page in the background (data + card images)
  // so tapping «عرض المزيد» paints instantly. Only fires when the button
  // is near the viewport (strong tap intent) — no wasted Firestore reads
  // for users who never scroll that far.
  function prefetchNextPage(offset: number) {
    if (prefetchRef.current?.offset === offset) return; // already warm
    if (prefetchingRef.current === offset) return; // warming in flight
    prefetchingRef.current = offset;
    fetchFeedPage(offset)
      .then((page) => {
        prefetchRef.current = { offset, page };
        // Prewarm card images: the thumb URLs land in the browser HTTP
        // cache now, so the appended cards paint their images instantly
        // instead of trickling in one slow TTFB at a time.
        try {
          for (const c of page.regular) {
            const u = cardImage(c);
            if (u) {
              const im = new Image();
              im.decoding = 'async';
              im.src = u;
            }
          }
        } catch {
          /* prewarm is best-effort */
        }
      })
      .catch(() => {
        /* prefetch failure is silent — the click path fetches normally */
      })
      .finally(() => {
        if (prefetchingRef.current === offset) prefetchingRef.current = null;
      });
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      // Round 160: consume the warmed page when it matches this offset.
      let page: FeedPage;
      if (prefetchRef.current && prefetchRef.current.offset === regularOffset) {
        page = prefetchRef.current.page;
        prefetchRef.current = null;
      } else {
        page = await fetchFeedPage(regularOffset);
      }
      const freshRegular: ListingCard[] = page.regular;
      // Taste append path (js/taste.js tasteRankDefault append): the FULL
      // regular pool (displayed + newly fetched) goes in; the frozen
      // arrangement is preserved and only the fresh docs are ranked and
      // appended. "Show more" never reorders what is already visible.
      // (The null-guard covers the ultra-rare case of a click landing
      // between first paint and the mount effect.)
      if (!regularRef.current) {
        try {
          regularRef.current = tasteRankDefault(cards.filter((c) => !c.isWanted), {
            bump: true,
          });
        } catch {
          regularRef.current = cards.filter((c) => !c.isWanted);
        }
      }
      const prevRegular = regularRef.current;
      const fullRegular = [...prevRegular, ...freshRegular];
      let ranked: ListingCard[];
      try {
        ranked = tasteRankDefault(fullRegular, { append: true });
      } catch {
        ranked = fullRegular;
      }
      regularRef.current = ranked;
      const freshRanked = ranked.slice(prevRegular.length);
      // Follow boost on the fresh batch only (js/home.js v101): the
      // visible order is never reshuffled — "show more" appends only.
      const boostedFresh = applyFollowBoost(freshRanked, followedRef.current || new Set());
      // Interleave the new regular batch with the remaining wanted pool,
      // continuing the rotation from where the previous page left off.
      const newCards = interleaveWanted(boostedFresh, wantedPool.slice(wantedOffset));
      const wantedUsed = newCards.filter((c) => c.isWanted).length;
      setCards((prev) => [...prev, ...newCards]);
      const nextOffset = regularOffset + PAGE_SIZE;
      setRegularOffset(nextOffset);
      regularOffsetRef.current = nextOffset;
      setWantedOffset((prev) => prev + wantedUsed);
      const more = page.hasMore && newCards.length > 0;
      setHasMore(more);
      // Round 160: stay one page ahead — warm the following page while the
      // user looks at the fresh cards, so the next tap is instant too.
      if (more) {
        try {
          const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
          if (idle) idle(() => prefetchNextPage(nextOffset));
          else setTimeout(() => prefetchNextPage(nextOffset), 1500);
        } catch {
          /* best-effort */
        }
      }
    } catch (e) {
      // BH-obs2 (R17, 18 Oct 2026): raw tokens stay in the console — the
      // user-visible box shows only the localized message (11 Oct policy).
      console.error('feed loadMore failed:', e);
      setError(e instanceof Error ? e.message : 'feed-error');
    } finally {
      setLoading(false);
    }
  }

  // Round 160: when the «عرض المزيد» button scrolls near the viewport,
  // warm the next page (data + images) — strong tap-intent signal, so the
  // click itself needs no network round trip for data and the images are
  // already cached.
  useEffect(() => {
    const el = loadMoreWrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (done) return;
        for (const en of entries) {
          if (en.isIntersecting) {
            done = true;
            io.disconnect();
            prefetchNextPage(regularOffsetRef.current);
            break;
          }
        }
      },
      { rootMargin: '600px' }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the render list: cards interleaved with vitrine showcases.
  // Slots (legacy): after card 2, then every 8, max VITRINE_MAX.
  // Showcases span the full grid width (col-span-full).
  const slots = vitrineSlotIndices(cards.length, showcases.length);
  const renderItems: ({ type: 'card'; card: ListingCard } | { type: 'showcase'; showcase: Showcase })[] = [];
  {
    let scIdx = 0;
    for (let i = 0; i < cards.length; i++) {
      renderItems.push({ type: 'card', card: cards[i] });
      // Slot k means "after the k-th card" (1-based); i is 0-based.
      if (scIdx < slots.length && slots[scIdx] === i + 1) {
        renderItems.push({ type: 'showcase', showcase: showcases[scIdx] });
        scIdx++;
      }
    }
  }

  return (
    <>
      {/* 0.0.0.31 FIX-WEB-014: results counter — verbatim js/home.js
          setResultsCount(shown.length) parity: counts the painted grid
          cards (regular + interleaved wanted), not the follows strip or
          vitrine showcases. role="status" + aria-live announces the
          count to screen readers after every load-more, like legacy. */}
      <div
        role="status"
        aria-live="polite"
        className="text-[13px] text-zinc-500 px-0.5 py-1.5 min-h-[1.2em]"
      >
        {resultsCountText(cards.length, lang)}
      </div>
      {/* «جديد من متابَعيك» strip (js/home.js renderFollowsSection, Zak
          16 Sep 2026): latest listings from followed users — last 7 days,
          max 3 per user, newest first. Prepended to the default feed. */}
      {stripCards.length > 0 && (
        <section aria-label={t('newFromFollows')} className="mb-6">
          <h2 className="text-lg font-semibold text-zinc-800 mb-3">
            ✦ {t('newFromFollows')}
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {stripCards.map((c) => (
              <div key={c.id} className="w-44 shrink-0">
                <ListingCardView l={c} />
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {(() => {
          // Round 160: the first 4 cards sit above the fold (2-col mobile =
          // 2 rows) — load them eagerly instead of lazy, and give the very
          // first card's upgrade preload high fetch priority.
          let cardOrdinal = 0;
          return renderItems.map((item, idx) =>
            item.type === 'card' ? (
              <ListingCardView
                key={item.card.id}
                l={item.card}
                eager={cardOrdinal < 4}
                priority={cardOrdinal++ === 0}
              />
            ) : (
              <div key={`vitrine-${item.showcase.seller.id}-${idx}`} className="col-span-full">
                <Suspense fallback={null}>
                  <VitrineShowcase showcase={item.showcase} uid={refreshedUid.current ?? undefined} />
                </Suspense>
              </div>
            )
          );
        })()}
      </div>
      {error && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-4 text-center text-red-700 text-sm">
          {t('loadMoreFailed')}{' '}
          <button
            type="button"
            onClick={loadMore}
            className="font-bold underline"
          >
            {t('retry')}
          </button>
        </div>
      )}
      {hasMore && !error && (
        <div ref={loadMoreWrapRef} className="text-center py-6">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-xl border border-zinc-300 bg-white px-8 py-3 font-bold text-zinc-800 hover:border-emerald-600 disabled:opacity-50"
          >
            {loading ? '…' : t('loadMore')}
          </button>
        </div>
      )}
    </>
  );
}
