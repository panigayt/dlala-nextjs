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
import { interleaveWanted, type ListingCard } from '@/lib/firestore';
import { tasteRankDefault } from '@/lib/taste';

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

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.map((l) => (
          <ListingCardView key={l.id} l={l} />
        ))}
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
