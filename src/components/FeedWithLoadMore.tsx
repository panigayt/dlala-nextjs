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

import { useEffect, useRef, useState } from 'react';
import ListingCardView from '@/components/ListingCardView';
import VitrineShowcase from '@/components/VitrineShowcase';
import { interleaveWanted, type ListingCard, type VitrineShowcaseData } from '@/lib/firestore';
import { tasteRankDefault } from '@/lib/taste';
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
      const ranked = tasteRankDefault(regular, { bump: true });
      regularRef.current = ranked;
      setCards(interleaveWanted(ranked, wanted));
    } catch {
      /* taste must never break the feed */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const noRepeat = vitrineNoRepeatLoad();
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
          noRepeat
        );
      } catch {
        /* vitrine must never break the feed */
      }
    })();
  }, []);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/feed?offset=${regularOffset}`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error(`feed-${res.status}`);
      const page: FeedPage = await res.json();
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
      const fullRegular = [...prevRegular, ...page.regular];
      let ranked: ListingCard[];
      try {
        ranked = tasteRankDefault(fullRegular, { append: true });
      } catch {
        ranked = fullRegular;
      }
      regularRef.current = ranked;
      const freshRanked = ranked.slice(prevRegular.length);
      // Interleave the new regular batch with the remaining wanted pool,
      // continuing the rotation from where the previous page left off.
      const newCards = interleaveWanted(freshRanked, wantedPool.slice(wantedOffset));
      const wantedUsed = newCards.filter((c) => c.isWanted).length;
      setCards((prev) => [...prev, ...newCards]);
      setRegularOffset((prev) => prev + PAGE_SIZE);
      setWantedOffset((prev) => prev + wantedUsed);
      setHasMore(page.hasMore && newCards.length > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'feed-error');
    } finally {
      setLoading(false);
    }
  }

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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {renderItems.map((item, idx) =>
          item.type === 'card' ? (
            <ListingCardView key={item.card.id} l={item.card} />
          ) : (
            <div key={`vitrine-${item.showcase.seller.id}-${idx}`} className="col-span-full">
              <VitrineShowcase showcase={item.showcase} />
            </div>
          )
        )}
      </div>
      {error && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-4 text-center text-red-700 text-sm">
          تعذر تحميل المزيد ({error}).{' '}
          <button
            type="button"
            onClick={loadMore}
            className="font-bold underline"
          >
            حاول مرة أخرى
          </button>
        </div>
      )}
      {hasMore && !error && (
        <div className="text-center py-6">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-xl border border-zinc-300 bg-white px-8 py-3 font-bold text-zinc-800 hover:border-emerald-600 disabled:opacity-50"
          >
            {loading ? '…' : 'عرض المزيد'}
          </button>
        </div>
      )}
    </>
  );
}
