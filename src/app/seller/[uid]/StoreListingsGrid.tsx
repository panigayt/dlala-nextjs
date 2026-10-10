'use client';

// Pro-store search box + category tabs — js/seller.js parity:
// - renderStoreTab (Zak 16 Sep 2026): the boutique search input is pro-only.
//   Ordinary sellers get the plain grid — no search box.
// - renderCategoryTabs: category tabs render when 2+ distinct categories
//   exist (all sellers, not just pro).
// - storeSearchHaystack (QA 16 Sep 2026 #2): title/description are localized
//   objects — search across every language variant, never String(obj).
// - renderStoreAdsGrid: client-side filter by category + search text.
// - R3 "Show more" (Zak ordered): the grid starts at SELLER_LISTINGS_PAGE_SIZE
//   ads; the button adds +30 and re-queries the server with the new limit.

import { useEffect, useMemo, useState } from 'react';
import {
  cardTitle,
  cardImage,
  formatPrice,
  type ListingCard,
} from '@/lib/firestore';
import { catName } from '@/lib/categories';
import { WILAYAS } from '@/lib/wilayas';
import TimeAgo from '@/components/TimeAgo';
import BlurUpImage from '@/components/BlurUpImage';

function wilayaName(code: number | undefined): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string }[]).find(
    (x) => x.code === Number(code)
  );
  return w ? `${w.code} - ${w.ar}` : '';
}

function ListingCardView({ l }: { l: ListingCard }) {
  const img = cardImage(l);
  const createdIso =
    l.createdAt instanceof Date
      ? l.createdAt.toISOString()
      : typeof l.createdAt === 'string'
        ? l.createdAt
        : '';
  return (
    <a
      href={`/listing/${l.id}`}
      className="block rounded-xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      dir="rtl"
    >
      <div className="relative aspect-[4/3] bg-zinc-100">
        {img ? (
          <BlurUpImage
            listing={l}
            img={img}
            alt={cardTitle(l)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">
            📷
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="font-bold text-emerald-700 text-lg">
          {formatPrice(l.price || 0)}
        </p>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">
          {cardTitle(l)}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          {wilayaName(l.wilayaCode)}
          {createdIso ? (
            <>
              {' · '}
              <TimeAgo iso={createdIso} />
            </>
          ) : (
            ''
          )}
        </p>
      </div>
    </a>
  );
}

// js/seller.js storeSearchHaystack parity.
function haystack(l: ListingCard): string {
  return [l.title, l.description]
    .flatMap((v) => (v && typeof v === 'object' ? Object.values(v) : [v]))
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
}

// Legacy R3 verbatim: the 'Show more' button adds 30 to the limit.
const SHOW_MORE_STEP = 30;

export default function StoreListingsGrid({
  uid,
  initialListings,
  initialLimit,
  isPro,
  onCountChange,
}: {
  uid: string;
  initialListings: ListingCard[];
  initialLimit: number;
  isPro: boolean;
  onCountChange?: (count: number) => void;
}) {
  const [listings, setListings] = useState(initialListings);
  const [limit, setLimit] = useState(initialLimit);
  const [searchText, setSearchText] = useState('');
  const [activeCat, setActiveCat] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  useEffect(() => {
    onCountChange?.(listings.length);
  }, [listings.length, onCountChange]);

  const cats = useMemo(() => {
    const set = new Set<string>();
    for (const l of listings) if (l.categoryId) set.add(l.categoryId);
    return [...set];
  }, [listings]);

  const filtered = useMemo(() => {
    let docs = activeCat
      ? listings.filter((l) => l.categoryId === activeCat)
      : listings;
    const q = searchText.trim().toLowerCase();
    if (q) docs = docs.filter((l) => haystack(l).includes(q));
    return docs;
  }, [listings, activeCat, searchText]);

  // js/seller.js R3 verbatim: the button renders when the server returned a
  // full page (listings.length >= limit, so more may exist) AND the filtered
  // grid is non-empty.
  const showMore = listings.length >= limit && filtered.length > 0;

  async function handleShowMore() {
    if (loadingMore) return;
    const nextLimit = limit + SHOW_MORE_STEP;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const res = await fetch(
        `/api/seller/${encodeURIComponent(uid)}/listings?limit=${nextLimit}`
      );
      if (!res.ok) throw new Error('seller-listings-' + res.status);
      const data = await res.json();
      if (!Array.isArray(data.listings))
        throw new Error('seller-listings-bad-shape');
      // Legacy re-queries with the full new limit (newest-first), so a full
      // replace — not an append — is the correct client behavior.
      setListings(data.listings);
      setLimit(nextLimit);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const tabCls = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
      active
        ? 'bg-emerald-700 text-white'
        : 'bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-100'
    }`;

  return (
    <div>
      {isPro && (
        <div className="mb-3">
          <input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="ابحث في المتجر..."
            aria-label="ابحث في المتجر"
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none"
          />
        </div>
      )}
      {cats.length >= 2 && (
        <div
          className="mb-3 flex flex-wrap gap-2"
          role="group"
          aria-label="فئات المتجر"
        >
          <button
            type="button"
            onClick={() => setActiveCat('')}
            aria-pressed={activeCat === ''}
            className={tabCls(activeCat === '')}
          >
            الكل
          </button>
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setActiveCat(c)}
              aria-pressed={activeCat === c}
              className={tabCls(activeCat === c)}
            >
              {catName(c)}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
          {listings.length === 0
            ? 'لا توجد إعلانات متاحة حاليا.'
            : 'لا توجد نتائج مطابقة.'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((l) => (
            <ListingCardView key={l.id} l={l} />
          ))}
        </div>
      )}
      {showMore && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleShowMore}
            disabled={loadingMore}
            className="rounded-lg bg-white text-emerald-700 border border-emerald-700 px-6 py-2.5 font-medium hover:bg-emerald-50 disabled:opacity-60"
          >
            {loadingMore ? 'جارٍ التحميل...' : 'عرض المزيد'}
          </button>
          {moreError && (
            <p className="mt-2 text-sm text-red-600">
              تعذّر تحميل المزيد. حاول مجددًا.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
