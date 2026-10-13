'use client';

// Search results grid — result count (js/home.js FIX-WEB-014 parity) +
// "عرض المزيد" load-more (legacy loadMore parity). The server page passes
// the initial SSR payload; further pages re-query /api/search with a
// larger limit (same pattern as the seller grid, Round 69).

import { lazy, Suspense, useState } from 'react';
import { useLang } from '@/lib/i18n';
import {
  resultsCountText,
  SEARCH_PAGE_SIZE,
  type ListingCard,
  type SearchFilters,
} from '@/lib/firestore';
import ListingCardView from '@/components/ListingCardView';
// Round 17 T10: lazy — StoreMatchCards renders null until its background
// fetch resolves, so it never contributes to first paint. React.lazy
// (not next/dynamic: its loadable runtime cost +2.9KB net, measured)
// splits it out of the initial bundle: 595,438 -> 593,768 bytes
// firstLoadUncompressedJsBytes (-1,670, measured via route-bundle-stats).
// The store-matches fetch starts when the chunk evaluates, still
// best-effort/background (js/home.js 0.0.0.1m parity).
const StoreMatchCards = lazy(() => import('./StoreMatchCards'));
import { filtersToQuery } from './filters';

export default function SearchResultsGrid({
  initialListings,
  initialTotal,
  initialHasMore,
  filters,
}: {
  initialListings: ListingCard[];
  initialTotal: number;
  initialHasMore: boolean;
  filters: SearchFilters;
}) {
  const { t, lang } = useLang();
  const [listings, setListings] = useState(initialListings);
  const [total, setTotal] = useState(initialTotal);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  async function handleShowMore() {
    setLoadingMore(true);
    setMoreError(false);
    try {
      const qs = filtersToQuery(filters);
      const r = await fetch(
        `/api/search?${qs}${qs ? '&' : ''}limit=${listings.length + SEARCH_PAGE_SIZE}`
      );
      if (!r.ok) throw new Error(`search-api-${r.status}`);
      const j = await r.json();
      setListings(j.listings);
      setTotal(j.total);
      setHasMore(j.hasMore);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      {/* Legacy #resultsMeta — FIX-WEB-014 verbatim text, announced on change. */}
      <p id="resultsMeta" role="status" className="text-sm text-zinc-500 mb-3">
        {resultsCountText(total, lang)}
      </p>
      {/* js/home.js 0.0.0.1m (Zak): verified-store cards above the results
          when the text query matches a pro store — background fetch, fails
          closed. Mounted once: "عرض المزيد" appends never re-trigger it. */}
      <Suspense fallback={null}>
        <StoreMatchCards q={filters.q || ''} />
      </Suspense>
      {listings.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-zinc-500">
          <p className="text-lg">{t('noResults')}</p>
          <p className="mt-2 text-sm">{t('noResultsHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Round 17 T2-retry (A/B VERIFIED 13 Oct 2026, Slow 3G n=6/arm):
              the first 4 cards sit above the fold at 390px (2-col = 2 rows)
              — load them eagerly (home-page Round 160 parity); React 19
              auto-preloads non-lazy imgs at SSR, so their manual preload
              hints are dropped in page.tsx as redundant. Cards 5+ keep the
              manual preload hints. */}
          {listings.map((l, i) => (
            <ListingCardView key={l.id} l={l} eager={i < 4} />
          ))}
        </div>
      )}
      {hasMore ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleShowMore}
            disabled={loadingMore}
            className="rounded-lg bg-white text-emerald-700 border border-emerald-700 px-6 py-2.5 font-medium hover:bg-emerald-50 disabled:opacity-60"
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
          {moreError ? (
            <p className="mt-2 text-sm text-red-600">
              {t('loadMoreFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
