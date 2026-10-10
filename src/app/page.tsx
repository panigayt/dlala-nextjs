// Dlala home — Server-Side Rendered feed.
//
// Architecture (per ~/workspace/dlala-nextjs-zero-budget-plan.md):
//   - Server Component: fetches the feed from Firestore REST at request time.
//   - ISR: revalidate every 60s — the CDN serves a pre-rendered page,
//     Firestore is hit at most once per minute, not per visitor.
//   - Zero Firebase SDK on the server path: plain fetch() to the REST API.
//
// This mirrors the guest home feed of the production SPA
// (js/home.js buildFeedRestQuery default branch) exactly:
//   status IN [available, negotiating], orderBy createdAt DESC, limit 24,
//   card-field projection.

import { cacheLife } from 'next/cache';
import Link from 'next/link';
import { fetchFeed, fetchWanted, interleaveWanted, resultsCountText, type ListingCard } from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES } from '@/lib/categories';
import FeedWithLoadMore from '@/components/FeedWithLoadMore';

// Cached feed fetcher — ISR equivalent: revalidate every 60 seconds.
// (Next.js 16 Cache Components model: 'use cache' + cacheLife.)
// Round 39: fetches the regular feed AND the wanted pool, then interleaves
// them server-side with the verbatim interleaveWanted() logic (js/market.js):
// after every 4th regular card, one wanted card. The wanted pool (up to 120,
// card-field projection) is passed to the client for the "load more" pages
// so the rotation continues without refetching.
async function getFeed(): Promise<{
  cards: ListingCard[];
  wantedPool: ListingCard[];
  regularOffset: number;
  wantedOffset: number;
  hasMore: boolean;
}> {
  'use cache';
  cacheLife({ revalidate: 60 });
  const PAGE_SIZE = 24;
  const [docs, wantedPool] = await Promise.all([
    fetchFeed(PAGE_SIZE),
    // Best-effort: a wanted-pool failure must never break the feed.
    fetchWanted(120).catch(() => [] as ListingCard[]),
  ]);
  // Legacy splits the fetched docs (js/home.js: regular/wanted filters).
  const regular = docs.filter((d) => !d.isWanted);
  const cards = interleaveWanted(regular, wantedPool);
  const wantedOffset = cards.filter((c) => c.isWanted).length;
  return {
    cards,
    wantedPool,
    regularOffset: PAGE_SIZE,
    wantedOffset,
    hasMore: docs.length >= PAGE_SIZE,
  };
}

// Search bar — mirrors ~/workspace/dlala-040/index.html .search-bar.
// GET form: submits to /search?q=... (Enter submits natively, like legacy).
// text-base (16px) honors the iOS no-zoom rule (Zak, 20 Sep 2026).
function SearchBar() {
  return (
    <form action="/search" method="get" role="search" className="flex gap-2 mb-4">
      <label htmlFor="home-q" className="sr-only">
        ابحث...
      </label>
      <input
        id="home-q"
        type="search"
        name="q"
        placeholder="ابحث..."
        autoComplete="off"
        className="flex-1 min-w-0 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900"
      />
      <button
        type="submit"
        className="rounded-xl bg-emerald-700 px-6 py-3 font-bold text-white hover:bg-emerald-800"
      >
        بحث
      </button>
    </form>
  );
}

// Category chips — mirrors renderChips() in ~/workspace/dlala-040/js/home.js:
// الكل (active: home is the default unfiltered view) + 22 categories +
// 🔎 مطلوب toggle. Chips link to /search?cat=<id>; مطلوب links to /wanted
// (the dedicated wanted page, equivalent of the legacy wantedOnly filter).
function CategoryChips() {
  return (
    <nav aria-label="الفئات" className="flex gap-2 overflow-x-auto pb-3 mb-2">
      <Link
        href="/search"
        aria-current="page"
        className="whitespace-nowrap rounded-full border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
      >
        الكل
      </Link>
      {CATEGORIES.map((c) => (
        <Link
          key={c.id}
          href={`/search?cat=${c.id}`}
          className="whitespace-nowrap rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:border-emerald-600"
        >
          {c.ar}
        </Link>
      ))}
      <Link
        href="/wanted"
        className="whitespace-nowrap rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:border-emerald-600"
      >
        🔎 مطلوب
      </Link>
    </nav>
  );
}

// Filters — mirrors the .filters block in ~/workspace/dlala-040/index.html
// (wilaya select, min/max price, sort, تطبيق/مسح). GET form: submits to
// /search?wilaya=..&min=..&max=..&sort=.. — the search backend reads these
// params (legacy applied them to the home feed in-place; here they lead to
// the dedicated search page, which is the Next.js equivalent).
// text-base (16px) honors the iOS no-zoom rule (Zak, 20 Sep 2026).
function HomeFilters() {
  const ctl =
    'rounded-xl border border-zinc-300 bg-white px-3 py-3 text-base text-zinc-900';
  return (
    <form action="/search" method="get" className="flex flex-wrap items-center gap-2 mb-4">
      <label htmlFor="home-wilaya" className="sr-only">
        الولاية
      </label>
      <select id="home-wilaya" name="wilaya" className={ctl} defaultValue="">
        <option value="">كل الولايات</option>
        {(WILAYAS as { code: number; ar: string }[]).map((w) => (
          <option key={w.code} value={w.code}>
            {w.code} - {w.ar}
          </option>
        ))}
      </select>
      <label htmlFor="home-min" className="sr-only">
        السعر الأدنى
      </label>
      <input
        id="home-min"
        type="number"
        name="min"
        min="0"
        inputMode="numeric"
        placeholder="السعر الأدنى"
        className={`${ctl} w-32`}
      />
      <label htmlFor="home-max" className="sr-only">
        السعر الأقصى
      </label>
      <input
        id="home-max"
        type="number"
        name="max"
        min="0"
        inputMode="numeric"
        placeholder="السعر الأقصى"
        className={`${ctl} w-32`}
      />
      <label htmlFor="home-sort" className="sr-only">
        ترتيب
      </label>
      <select id="home-sort" name="sort" className={ctl} defaultValue="recent">
        <option value="recent">الأحدث</option>
        <option value="priceAsc">السعر: من الأقل</option>
        <option value="priceDesc">السعر: من الأعلى</option>
      </select>
      <button
        type="submit"
        className="rounded-xl bg-emerald-700 px-5 py-3 text-base font-bold text-white hover:bg-emerald-800"
      >
        تطبيق
      </button>
      <button
        type="reset"
        className="rounded-xl border border-zinc-300 bg-white px-5 py-3 text-base text-zinc-700 hover:border-emerald-600"
      >
        مسح
      </button>
    </form>
  );
}

export default async function Home() {
  let feed: {
    cards: ListingCard[];
    wantedPool: ListingCard[];
    regularOffset: number;
    wantedOffset: number;
    hasMore: boolean;
  } | null = null;
  let error: string | null = null;
  try {
    feed = await getFeed();
  } catch (e) {
    error = e instanceof Error ? e.message : 'feed-error';
  }
  const cards = feed?.cards || [];

  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <main className="max-w-6xl mx-auto px-4 py-6">
        <SearchBar />
        <CategoryChips />
        <HomeFilters />
        <h2 className="text-lg font-semibold text-zinc-800 mb-4">أحدث الإعلانات</h2>

        {error ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
            تعذر تحميل الإعلانات ({error}). حاول مرة أخرى.
          </div>
        ) : cards.length === 0 ? (
          <>
            {/* FIX-WEB-014 parity: legacy still paints resultsMeta with
                "لا توجد نتائج" above the empty state. */}
            <div
              role="status"
              aria-live="polite"
              className="text-[13px] text-zinc-500 px-0.5 py-1.5 min-h-[1.2em]"
            >
              {resultsCountText(0)}
            </div>
            <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
              لا توجد إعلانات حاليا.
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
