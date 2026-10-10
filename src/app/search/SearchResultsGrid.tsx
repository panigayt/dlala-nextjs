'use client';

// Search results grid — result count (js/home.js FIX-WEB-014 parity) +
// "عرض المزيد" load-more (legacy loadMore parity). The server page passes
// the initial SSR payload; further pages re-query /api/search with a
// larger limit (same pattern as the seller grid, Round 69).

import { useState } from 'react';
import {
  resultsCountText,
  SEARCH_PAGE_SIZE,
  type ListingCard,
  type SearchFilters,
} from '@/lib/firestore';
import ListingCardView from '@/components/ListingCardView';
import StoreMatchCards from './StoreMatchCards';
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
        {resultsCountText(total, 'ar')}
      </p>
      {/* js/home.js 0.0.0.1m (Zak): verified-store cards above the results
          when the text query matches a pro store — background fetch, fails
          closed. Mounted once: "عرض المزيد" appends never re-trigger it. */}
      <StoreMatchCards q={filters.q || ''} />
      {listings.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-zinc-500">
          <p className="text-lg">لا توجد نتائج مطابقة</p>
          <p className="mt-2 text-sm">جرّب كلمات مختلفة أو أزل بعض الفلاتر.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {listings.map((l) => (
            <ListingCardView key={l.id} l={l} />
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
            {loadingMore ? 'جارٍ التحميل...' : 'عرض المزيد'}
          </button>
          {moreError ? (
            <p className="mt-2 text-sm text-red-600">
              تعذّر تحميل المزيد. حاول مجددًا.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
