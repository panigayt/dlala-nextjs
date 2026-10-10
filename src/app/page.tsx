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
import { fetchFeed, cardTitle, cardImage, formatPrice, type ListingCard } from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES, catName } from '@/lib/categories';
import { dzPriceWords } from '@/lib/dz-price';
import TimeAgo from '@/components/TimeAgo';

// Cached feed fetcher — ISR equivalent: revalidate every 60 seconds.
// (Next.js 16 Cache Components model: 'use cache' + cacheLife.)
async function getFeed(): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchFeed(24);
}

function wilayaName(code: number | undefined): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string }[]).find((x) => x.code === Number(code));
  return w ? `${w.code} - ${w.ar}` : '';
}

function ListingCardView({ l }: { l: ListingCard }) {
  const img = cardImage(l);
  const reduced = l.priceReduced && (l.previousPrice || 0) > 0;
  const jobType = (l.answers && typeof l.answers.jobType === 'string' && l.answers.jobType) || '';
  const isSeeker = jobType === 'jobSeeker';
  const isOffer = jobType === 'jobOffer';
  const words = dzPriceWords(l.price || 0);
  const favCount = Number(l.favoriteCount) || 0;
  const cond =
    l.condition === 'new' ? 'جديد' : l.condition === 'good' ? 'جيد' : l.condition === 'used' ? 'مستعمل' : '';
  const cat = catName(l.categoryId || '');
  const metaBits = [cond, cat, wilayaName(l.wilayaCode)].filter(Boolean).join(' · ');
  return (
    <a
      href={`/listing/${l.id}`}
      data-sid={l.sellerId || ''}
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
        {(l.status === 'sold' || l.isWholesale || reduced || isSeeker || isOffer) && (
          <div className="absolute top-2 right-2 flex flex-col items-start gap-1">
            {l.status === 'sold' && (
              <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">مباع</span>
            )}
            {l.isWholesale && (
              <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">الجملة</span>
            )}
            {reduced && (
              <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white">
                ▼ انخفض السعر
              </span>
            )}
            {isSeeker && (
              <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white">
                باحث عن عمل
              </span>
            )}
            {isOffer && (
              <span className="rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-bold text-white">
                عرض عمل
              </span>
            )}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2">
          {/* fav pill — Zak 21 Sep option B: white pill with ♡ + count next to
              the price, pill first (right in RTL). Display-only on this SSR
              home page: the interactive toggle needs a client component with
              auth (follow-up parity block). */}
          {l.status !== 'sold' && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-600 shadow-sm"
              aria-label={`المفضلة: ${favCount}`}
            >
              <span aria-hidden="true">♡</span>
              <span>{favCount}</span>
            </span>
          )}
          <p className="font-bold text-emerald-700 text-lg">
            <span dir="ltr">{formatPrice(l.price || 0)}</span>
            {words && <small className="ms-1 font-normal text-zinc-500">({words})</small>}
          </p>
        </div>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">{cardTitle(l)}</h3>
        {metaBits && <p className="mt-1 text-xs text-zinc-600">{metaBits}</p>}
        <p className="mt-1 text-xs text-zinc-500">
          {l.createdAt ? <TimeAgo iso={l.createdAt.toISOString()} /> : ''}
        </p>
      </div>
    </a>
  );
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
  let listings: ListingCard[] = [];
  let error: string | null = null;
  try {
    listings = await getFeed();
  } catch (e) {
    error = e instanceof Error ? e.message : 'feed-error';
  }

  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <header className="sticky top-0 z-10 bg-emerald-700 text-white shadow">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold">دلالة</h1>
          <nav className="text-sm">سوق الجزائر للإعلانات المبوبة</nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <SearchBar />
        <CategoryChips />
        <HomeFilters />
        <h2 className="text-lg font-semibold text-zinc-800 mb-4">أحدث الإعلانات</h2>

        {error ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
            تعذر تحميل الإعلانات ({error}). حاول مرة أخرى.
          </div>
        ) : listings.length === 0 ? (
          <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
            لا توجد إعلانات حاليا.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {listings.map((l) => (
              <ListingCardView key={l.id} l={l} />
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-zinc-400">
        </p>
      </main>
    </div>
  );
}
