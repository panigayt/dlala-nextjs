'use client';

// Search results grid — result count (js/home.js FIX-WEB-014 parity) +
// "عرض المزيد" load-more (legacy loadMore parity). The server page passes
// the initial SSR payload; further pages re-query /api/search with a
// larger limit (same pattern as the seller grid, Round 69).

import { useState } from 'react';
import Link from 'next/link';
import {
  resultsCountText,
  cardTitle,
  cardImage,
  formatPrice,
  SEARCH_PAGE_SIZE,
  type ListingCard,
  type SearchFilters,
} from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import TimeAgo from '@/components/TimeAgo';
import StoreMatchCards from './StoreMatchCards';
import { filtersToQuery } from './filters';

function wilayaName(code: number | undefined): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string }[]).find((x) => x.code === Number(code));
  return w ? `${w.code} - ${w.ar}` : '';
}

function Card({ l }: { l: ListingCard }) {
  const img = cardImage(l);
  return (
    <Link
      key={l.id}
      href={`/listing/${l.id}`}
      className="block rounded-xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      dir="rtl"
    >
      <div className="relative aspect-[4/3] bg-zinc-100">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={cardTitle(l)}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
        )}
      </div>
      <div className="p-3">
        <p className="font-bold text-emerald-700 text-lg">{formatPrice(l.price || 0)}</p>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">{cardTitle(l)}</h3>
        <p className="mt-1 text-xs text-zinc-500">
          {wilayaName(l.wilayaCode)}
          {l.createdAt ? (
            <>
              {' · '}
              <TimeAgo iso={l.createdAt.toISOString()} />
            </>
          ) : null}
        </p>
      </div>
    </Link>
  );
}

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
            <Card key={l.id} l={l} />
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
