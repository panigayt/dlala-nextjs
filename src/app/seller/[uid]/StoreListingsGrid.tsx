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
//   ads; the button adds +30 more.
// - 22 Oct 2026 (reads-incident root fix): "show more" now APPENDS the
//   next cursor page instead of re-querying with a growing limit (the
//   legacy pattern re-read every already-shown ad on each click:
//   30 + 60 + 90 + ... reads). Pages are disjoint and ordered, so the
//   rendered grid is identical to the old full-replace behavior.

import { useEffect, useMemo, useState } from 'react';
import { type ListingCard } from '@/lib/firestore';
import { catName } from '@/lib/categories';
import { useLang } from '@/lib/i18n';
import ListingCardView from '@/components/ListingCardView';

// js/seller.js storeSearchHaystack parity.
function haystack(l: ListingCard): string {
  return [l.title, l.description]
    .flatMap((v) => (v && typeof v === 'object' ? Object.values(v) : [v]))
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
}

export default function StoreListingsGrid({
  uid,
  initialListings,
  initialNextCursor,
  isPro,
  onCountChange,
}: {
  uid: string;
  initialListings: ListingCard[];
  initialNextCursor: string | null;
  isPro: boolean;
  onCountChange?: (count: number) => void;
}) {
  const [listings, setListings] = useState(initialListings);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [searchText, setSearchText] = useState('');
  const [activeCat, setActiveCat] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  // Round 111: all strings follow the UI language (js/i18n.js parity).
  const { t, lang } = useLang();

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

  // The button renders when the stream has a next page (the server only
  // hands out a cursor when the previous page came back full — the same
  // condition the legacy listings.length >= limit expressed) AND the
  // filtered grid is non-empty.
  const showMore = nextCursor !== null && filtered.length > 0;

  async function handleShowMore() {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const res = await fetch(
        `/api/seller/${encodeURIComponent(uid)}/listings?cursor=${encodeURIComponent(nextCursor)}`
      );
      if (!res.ok) throw new Error('seller-listings-' + res.status);
      const data = await res.json();
      if (!Array.isArray(data.listings))
        throw new Error('seller-listings-bad-shape');
      // Append the next page (dedupe by id as a belt-and-braces guard —
      // cursor pages are disjoint by construction).
      setListings((prev) => {
        const seen = new Set(prev.map((l) => l.id));
        return [...prev, ...data.listings.filter((l: ListingCard) => !seen.has(l.id))];
      });
      setNextCursor(
        typeof data.nextCursor === 'string' ? data.nextCursor : null
      );
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
            placeholder={t('searchInStore')}
            aria-label={t('searchInStore')}
            className="w-full rounded-lg border border-amber-400 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none"
          />
        </div>
      )}
      {cats.length >= 2 && (
        <div
          className="mb-3 flex flex-wrap gap-2"
          role="group"
          aria-label={t('storeCategories')}
        >
          <button
            type="button"
            onClick={() => setActiveCat('')}
            aria-pressed={activeCat === ''}
            className={tabCls(activeCat === '')}
          >
            {t('all')}
          </button>
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setActiveCat(c)}
              aria-pressed={activeCat === c}
              className={tabCls(activeCat === c)}
            >
              {catName(c, lang)}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
          {listings.length === 0
            ? t('noAdsAvailable')
            : t('noMatchingResults')}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((l) => (
            // 11 Oct 2026: gold is pro-only (legacy parity — ordinary sellers use plain cards).
            <ListingCardView key={l.id} l={l} gold={isPro} />
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
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
          {moreError && (
            <p className="mt-2 text-sm text-red-600">
              {t('sellerLoadMoreFailed')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
