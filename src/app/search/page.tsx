// Dlala search — Server-Side Rendered.
//
// Query params: q (text), cat (category), wilaya, min/max (price), sort
// (recent | priceAsc | priceDesc). Structured filters run in Firestore;
// text query is normalized client-side-matching on the server
// (mirrors js/home.js R-9).

import { Suspense } from 'react';
import Link from 'next/link';
import { cacheLife } from 'next/cache';
import {
  searchListings,
  cardTitle,
  cardImage,
  formatPrice,
  type ListingCard,
  type SearchFilters,
} from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES } from '@/lib/categories';
import TimeAgo from '@/components/TimeAgo';

async function getResults(f: SearchFilters): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return searchListings(f);
}

function wilayaName(code: number | undefined): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string }[]).find((x) => x.code === Number(code));
  return w ? `${w.code} - ${w.ar}` : '';
}

// Filter bar — GET form mirroring the home page HomeFilters block
// (~/workspace/dlala-040/index.html .filters). Backend already supports
// cat/wilaya/min/max/sort via URL params; this is the UI for them.
// Current values are pre-selected via defaultValue; the text query q
// is preserved in a hidden input.
function FilterBar({ filters }: { filters: SearchFilters }) {
  const ctl =
    'rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900';
  const q = filters.q || '';
  return (
    <form action="/search" method="get" className="flex flex-wrap items-center gap-2 mb-4">
      {q ? <input type="hidden" name="q" value={q} /> : null}
      <label htmlFor="search-cat" className="sr-only">
        الفئة
      </label>
      <select id="search-cat" name="cat" className={ctl} defaultValue={filters.cat || ''}>
        <option value="">كل الفئات</option>
        {CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.ar}
          </option>
        ))}
      </select>
      <label htmlFor="search-wilaya" className="sr-only">
        الولاية
      </label>
      <select id="search-wilaya" name="wilaya" className={ctl} defaultValue={filters.wilaya || ''}>
        <option value="">كل الولايات</option>
        {(WILAYAS as { code: number; ar: string }[]).map((w) => (
          <option key={w.code} value={w.code}>
            {w.code} - {w.ar}
          </option>
        ))}
      </select>
      <label htmlFor="search-min" className="sr-only">
        السعر الأدنى
      </label>
      <input
        id="search-min"
        type="number"
        name="min"
        min="0"
        inputMode="numeric"
        placeholder="السعر الأدنى"
        defaultValue={filters.min || ''}
        className={`${ctl} w-32`}
      />
      <label htmlFor="search-max" className="sr-only">
        السعر الأقصى
      </label>
      <input
        id="search-max"
        type="number"
        name="max"
        min="0"
        inputMode="numeric"
        placeholder="السعر الأقصى"
        defaultValue={filters.max || ''}
        className={`${ctl} w-32`}
      />
      <label htmlFor="search-sort" className="sr-only">
        ترتيب
      </label>
      <select id="search-sort" name="sort" className={ctl} defaultValue={filters.sort || 'recent'}>
        <option value="recent">الأحدث</option>
        <option value="priceAsc">السعر: من الأقل</option>
        <option value="priceDesc">السعر: من الأعلى</option>
      </select>
      <button
        type="submit"
        className="rounded-xl bg-emerald-700 px-5 py-2.5 text-base font-bold text-white hover:bg-emerald-800"
      >
        تطبيق
      </button>
      <Link
        href={q ? `/search?q=${encodeURIComponent(q)}` : '/search'}
        className="rounded-xl border border-zinc-300 bg-white px-5 py-2.5 text-base text-zinc-700 hover:border-emerald-600"
      >
        مسح
      </Link>
    </form>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 bg-emerald-700 text-white shadow">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold">دلالة</Link>
        <form action="/search" method="get" className="flex gap-2">
          <input
            type="search"
            name="q"
            placeholder="ابحث..."
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-900 w-40 sm:w-64"
          />
          <button type="submit" className="rounded-lg bg-emerald-900 px-4 py-1.5 text-sm font-medium">
            بحث
          </button>
        </form>
      </div>
    </header>
  );
}

function ResultsSkeleton() {
  return (
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
  );
}

async function Results({ filters }: { filters: SearchFilters }) {
  let listings: ListingCard[] = [];
  let error: string | null = null;
  try {
    listings = await getResults(filters);
  } catch (e) {
    error = e instanceof Error ? e.message : 'search-error';
  }

  if (error) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
        تعذر البحث ({error}).
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="rounded-xl bg-white p-8 text-center text-zinc-500">
        <p className="text-lg">لا توجد نتائج مطابقة</p>
        <p className="mt-2 text-sm">جرّب كلمات مختلفة أو أزل بعض الفلاتر.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {listings.map((l) => {
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
      })}
    </div>
  );
}

async function SearchContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const get = (k: string): string => {
    const v = sp[k];
    return typeof v === 'string' ? v : '';
  };
  const filters: SearchFilters = {
    q: get('q') || undefined,
    cat: get('cat') || undefined,
    wilaya: get('wilaya') || undefined,
    min: get('min') || undefined,
    max: get('max') || undefined,
    sort: get('sort') || undefined,
  };
  const hasFilter = filters.q || filters.cat || filters.wilaya || filters.min || filters.max || filters.sort;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <h2 className="text-lg font-semibold text-zinc-800 mb-4">
        {filters.q ? `نتائج البحث: "${filters.q}"` : 'البحث'}
      </h2>
      <FilterBar filters={filters} />
      {hasFilter ? (
        <Results filters={filters} />
      ) : (
        <div className="rounded-xl bg-white p-8 text-center text-zinc-500">
          <p>اكتب كلمة للبحث في الإعلانات.</p>
        </div>
      )}
    </main>
  );
}

export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <Header />
      <Suspense fallback={<ResultsSkeleton />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
