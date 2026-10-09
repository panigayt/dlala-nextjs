// Dlala search — Server-Side Rendered.
//
// Query params: q (text), cat (category), wilaya, min/max (price).
// Structured filters run in Firestore; text query is normalized
// client-side-matching on the server (mirrors js/home.js R-9).

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
  };
  const hasFilter = filters.q || filters.cat || filters.wilaya || filters.min || filters.max;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <h2 className="text-lg font-semibold text-zinc-800 mb-4">
        {filters.q ? `نتائج البحث: "${filters.q}"` : 'البحث'}
      </h2>
      {hasFilter ? (
        <Results filters={filters} />
      ) : (
        <div className="rounded-xl bg-white p-8 text-center text-zinc-500">
          <p>اكتب كلمة للبحث في الإعلانات.</p>
        </div>
      )}
      <p className="mt-8 text-center text-xs text-zinc-400">SSR + ISR (60s) · Next.js · $0/month</p>
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
