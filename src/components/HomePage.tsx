'use client';

// Home page client shell — Round 107.
//
// The server (src/app/page.tsx) fetches the feed; this client component
// owns everything language-dependent: text direction, the section heading,
// the error/empty states, and the feed itself. On a language switch every
// mounted useLang() consumer re-renders (Round 106 app-wide store), so the
// whole home page flips AR/FR/EN without a reload — js/i18n.js
// onLangChange() parity.
//
// Round 157 (critical parity fix): production 0.0.0.39 filters the homepage
// feed IN PLACE (apply() → loadFeed(), never navigates). Filter state lives
// here: any filter change refetches /api/search and repaints the feed on /,
// exactly like legacy. When all filters are default, the original
// server-rendered feed (with taste ranking, follow boost, vitrine, wanted
// interleave) is restored.

import { lazy, Suspense, useRef, useState } from 'react';
import HomeHeader from '@/components/HomeHeader';
import TipsTicker from '@/components/TipsTicker';
import FeedWithLoadMore from '@/components/FeedWithLoadMore';
import ListingCardView from '@/components/ListingCardView';
// 11 Oct 2026: withTimeout now in @/lib/timeout — no firebase-compat import.
import { withTimeout } from '@/lib/timeout';
// Round 166 (0.0.0.39 parity, js/home.js 0.0.0.1m): verified-store gold cards
// atop filtered results when the text query matches a storeName/@username.
// Round 17 T9: StoreMatchCards only renders inside the client-only filtered
// grid (after a filter interaction) — never in SSR output. React.lazy
// (zero added runtime: built into React) splits it out of the initial home
// bundle; next/dynamic was measured +2.9KB net (its loadable runtime).
const StoreMatchCards = lazy(() => import('@/app/search/StoreMatchCards'));
import {
  resultsCountText,
  SEARCH_PAGE_SIZE,
  type ListingCard,
  type SearchFilters,
} from '@/lib/firestore';
import { filtersToQuery } from '@/app/search/filters';
import { useLang } from '@/lib/i18n';

export interface HomeFeedData {
  cards: ListingCard[];
  wantedPool: ListingCard[];
  regularOffset: number;
  wantedOffset: number;
  hasMore: boolean;
}

interface FilteredState {
  listings: ListingCard[];
  total: number;
  hasMore: boolean;
  filters: SearchFilters;
}

// True when no filter is active — the default server-rendered feed applies.
function isDefaultFilters(f: SearchFilters): boolean {
  return (
    !f.q &&
    !f.cat &&
    !f.wilaya &&
    !f.min &&
    !f.max &&
    !f.fOs &&
    !f.fBrand &&
    !f.fCarBrand &&
    !f.fFuel &&
    !f.fGear &&
    !f.fYearMin &&
    !f.fYearMax &&
    !f.fMilMin &&
    !f.fMilMax &&
    (!f.sort || f.sort === 'recent')
  );
}

// In-place filtered results grid — mirrors the search page's
// SearchResultsGrid (limit-based "عرض المزيد"), painted inside the home
// page instead of navigating to /search (js/home.js loadFeed parity).
function HomeFilteredGrid({
  state,
  onShowMore,
  loadingMore,
  onReset,
}: {
  state: FilteredState;
  onShowMore: () => void;
  loadingMore: boolean;
  onReset: () => void;
}) {
  const { t, lang } = useLang();
  // FIX-WEB-009 parity (js/home.js:1555-1566): inverted price range gets a
  // specific empty state with a hint and a reset-filters button, never a
  // silent reinterpretation of the user's bounds.
  const f = state.filters;
  const priceRangeInvalid =
    !!f.min && !!f.max && Number(f.min) > Number(f.max);
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="text-[13px] text-zinc-500 px-0.5 py-1.5 min-h-[1.2em]"
      >
        {resultsCountText(state.total, lang)}
      </div>
      {/* Round 166 (0.0.0.39 parity, js/home.js 0.0.0.1m insertStoreCards):
          verified-store gold cards prepended atop the feed when the text
          query matches a storeName/@username. Best-effort background fetch;
          renders nothing when q is empty or no stores match. */}
      <Suspense fallback={null}>
        <StoreMatchCards q={f.q || ''} />
      </Suspense>
      {state.listings.length === 0 ? (
        priceRangeInvalid ? (
          <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
            <div className="text-4xl mb-3" aria-hidden="true">🔍</div>
            <h3 className="text-lg font-bold text-zinc-800">
              {t('noResultsPriceRange')}
            </h3>
            <p className="mt-2 text-sm">{t('priceRangeHint')}</p>
            <button
              type="button"
              onClick={onReset}
              className="mt-4 rounded-xl bg-emerald-700 px-6 py-2.5 font-bold text-white hover:bg-emerald-800"
            >
              {t('resetFilters')}
            </button>
          </div>
        ) : (
          <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
            {t('noResults')}
            <p className="mt-2 text-sm">{t('noResultsHint')}</p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {state.listings.map((l, i) => (
            <ListingCardView key={l.id} l={l} eager={i < 4} priority={i < 4} />
          ))}
        </div>
      )}
      {state.hasMore && (
        <div className="text-center py-6">
          <button
            type="button"
            onClick={onShowMore}
            disabled={loadingMore}
            className="rounded-xl border border-zinc-300 bg-white px-8 py-3 font-bold text-zinc-800 hover:border-emerald-600 disabled:opacity-50"
          >
            {loadingMore ? '…' : t('loadMore')}
          </button>
        </div>
      )}
    </>
  );
}

export default function HomePage({
  feed,
  error,
}: {
  feed: HomeFeedData | null;
  error: string | null;
}) {
  const { t, lang } = useLang();
  const cards = feed?.cards || [];
  const [filters, setFilters] = useState<SearchFilters>({});
  const [filtered, setFiltered] = useState<FilteredState | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Stale-response guard: rapid filter changes must not paint out of order.
  const reqId = useRef(0);
  // Remounts the search input when filters reset externally (reset button).
  const [resetKey, setResetKey] = useState(0);
  const prevDefault = useRef(true);

  async function fetchFiltered(f: SearchFilters, limit: number) {
    const qs = filtersToQuery(f);
    // 11 Oct 2026: timeout — stuck filter on weak connections.
    const res = await withTimeout(
      fetch(`/api/search?${qs}${qs ? '&' : ''}limit=${limit}`, {
        cache: 'no-store',
      }),
      20000
    );
    if (!res.ok) throw new Error(`search-api-${res.status}`);
    return res.json();
  }

  // js/home.js apply() parity: read the filters, reload the feed in place.
  function applyFilters(f: SearchFilters) {
    setFilters(f);
    setFilterError(null);
    const nowDefault = isDefaultFilters(f);
    if (nowDefault && !prevDefault.current) setResetKey((k) => k + 1);
    prevDefault.current = nowDefault;
    if (nowDefault) {
      // Back to the default feed — restore the server-rendered first page.
      reqId.current += 1;
      setFiltered(null);
      setFilterLoading(false);
      return;
    }
    const id = ++reqId.current;
    setFilterLoading(true);
    fetchFiltered(f, SEARCH_PAGE_SIZE)
      .then((j) => {
        if (reqId.current !== id) return; // stale
        setFiltered({
          listings: j.listings || [],
          total: j.total ?? 0,
          hasMore: !!j.hasMore,
          filters: f,
        });
      })
      .catch((e) => {
        if (reqId.current !== id) return;
        setFilterError(e instanceof Error ? e.message : 'feed-error');
      })
      .finally(() => {
        if (reqId.current === id) setFilterLoading(false);
      });
  }

  function showMoreFiltered() {
    if (!filtered || loadingMore) return;
    setLoadingMore(true);
    fetchFiltered(filtered.filters, filtered.listings.length + SEARCH_PAGE_SIZE)
      .then((j) => {
        setFiltered({
          ...filtered,
          listings: j.listings || [],
          total: j.total ?? 0,
          hasMore: !!j.hasMore,
        });
      })
      .catch(() => {
        /* keep current results on failure */
      })
      .finally(() => setLoadingMore(false));
  }

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main id="main-content" className="max-w-6xl mx-auto px-4 py-6">
        {/* Round 152: visible tagline above tips — 0.0.0.39 index.html parity. */}
        <h1 className="sr-only">{t('tagline')}</h1>
        <p className="tagline" style={{ color: 'var(--muted, #6b7280)', marginBottom: '12px' }}>
          {t('tagline')}
        </p>
        {/* Round 122: tips ticker above the search bar — legacy index.html order. */}
        <TipsTicker />
        <HomeHeader filters={filters} onFiltersChange={applyFilters} resetKey={resetKey} />
        <h2 className="text-lg font-semibold text-zinc-800 mb-4">{t('latestAds')}</h2>

        {error && !filtered ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
            {/* 11 Oct 2026: no raw error leak — technical details stay in console. */}
            ⚠️ {t('errorGeneric')}{' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-bold underline"
            >
              {t('retry')}
            </button>
          </div>
        ) : filterLoading && !filtered ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-white shadow-sm overflow-hidden">
                <div className="aspect-[4/3] bg-zinc-200 animate-pulse" />
                <div className="p-3">
                  <div className="h-5 bg-zinc-200 rounded animate-pulse w-1/2" />
                  <div className="mt-2 h-4 bg-zinc-200 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filterError && !filtered ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
            ⚠️ {t('errorGeneric')} ({filterError}){' '}
            <button
              type="button"
              onClick={() => applyFilters(filters)}
              className="font-bold underline"
            >
              {t('retry')}
            </button>
          </div>
        ) : filtered ? (
          <div className="relative">
            {filterLoading && (
              <div className="absolute inset-0 bg-zinc-50/60 z-10 flex items-start justify-center pt-10">
                <div className="rounded-xl bg-white shadow px-6 py-3 text-sm text-zinc-600">
                  …
                </div>
              </div>
            )}
            <HomeFilteredGrid
              state={filtered}
              onShowMore={showMoreFiltered}
              loadingMore={loadingMore}
              onReset={() => applyFilters({})}
            />
          </div>
        ) : cards.length === 0 ? (
          <>
            {/* FIX-WEB-014 parity: legacy still paints resultsMeta with
                the zero-count above the empty state. */}
            <div
              role="status"
              aria-live="polite"
              className="text-[13px] text-zinc-500 px-0.5 py-1.5 min-h-[1.2em]"
            >
              {resultsCountText(0, lang)}
            </div>
            <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
              {t('feedEmpty')}
            </div>
          </>
        ) : (
          feed && (
            <FeedWithLoadMore
              initialCards={cards}
              wantedPool={feed.wantedPool}
              initialRegularOffset={feed.regularOffset}
              initialWantedOffset={feed.wantedOffset}
              initialHasMore={feed.hasMore}
            />
          )
        )}

        <p className="mt-8 text-center text-xs text-zinc-400">
        </p>
      </main>
    </div>
  );
}
