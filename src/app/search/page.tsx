// Dlala search — Server-Side Rendered.
//
// Query params: q (text), cat (category), wilaya, min/max (price), sort
// (recent | priceAsc | priceDesc). Structured filters run in Firestore;
// text query is normalized client-side-matching on the server
// (mirrors js/home.js R-9).
//
// Round 109: the server only parses the URL filters and fetches the
// results — all language-dependent rendering moved to the client
// <SearchPage> shell (heading, filter bar + facets, save-search, results
// grid, error/empty states) so the whole page follows the UI language via
// useLang() (js/i18n.js onLangChange parity; same pattern as the home page,
// Round 107).

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { cacheLife } from 'next/cache';
import {
  searchListingsWithCount,
  hasFacetFilter,
  type SearchResult,
  type SearchFilters,
} from '@/lib/firestore';
import { parseSearchFilters, filtersToQuery } from './filters';
import { t } from '@/lib/i18n-strings';
import SearchPage from '@/components/SearchPage';
import FeedPreloadHints from '@/components/FeedPreloadHints';

// Round 133: <title> follows the reader's language (dlala_lang cookie;
// localStorage is client-only). 12 Oct 2026 (Round 8): dedicated
// title_search — the page must not read "Dlala — Home".
// 12 Oct 2026 (Round 11 Team 2): statically analyzable — no request-time
// cookies() read. Mirrors the /{ar,fr,en}/guides pattern (static LANG,
// title key per route): the canonical /search route is the Arabic route,
// so the title uses the static 'ar' string; the client-side updateDocTitle
// (lib/i18n) re-localizes the tab on hydration and on every language
// switch without a reload. Awaiting cookies() here deferred the page's
// metadata segment and, per Round 10 T1, kept the streamed <head> from
// settling on the page title.
export function generateMetadata(): Metadata {
  // 11 Oct 2026: noindex — query-param search URLs are thin content.
  return {
    title: t('title_search', 'ar'),
    robots: { index: false, follow: false },
  };
}

async function getResults(f: SearchFilters): Promise<SearchResult> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return searchListingsWithCount(f);
}

function ResultsSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <main className="max-w-6xl mx-auto px-4 py-6">
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
      </main>
    </div>
  );
}

async function SearchLoader({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseSearchFilters(sp);
  const hasFilter =
    filters.q ||
    filters.cat ||
    filters.wilaya ||
    filters.min ||
    filters.max ||
    filters.sort ||
    hasFacetFilter(filters);

  let data: SearchResult | null = null;
  let error: string | null = null;
  if (hasFilter) {
    try {
      data = await getResults(filters);
    } catch (e) {
      error = e instanceof Error ? e.message : 'search-error';
    }
  }

  // Keyed by the filter query string so the client shell remounts on every
  // filter navigation — select defaultValues are always fresh, exactly like
  // the previous server-rendered version.
  // Round 14 T11: preload hints for the first 6 result thumbnails, in the
  // same order the grid renders. VERIFIED 12 Oct 2026 via prod-build curl:
  // these land early in <body>, NOT in <head> (React 19 hoisting does not
  // apply in Next.js 16's streaming pipeline; Metadata 'other' renders
  // <meta> only). The preload scanner still discovers them during initial
  // parse, before the card <img>s — same pattern as listing page R149/159.
  return (
    <>
      <FeedPreloadHints cards={data ? data.listings : []} />
      <SearchPage
        key={filtersToQuery(filters)}
        filters={filters}
        data={data}
        error={error}
        hasFilter={!!hasFilter}
      />
    </>
  );
}

export default function SearchPageRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<ResultsSkeleton />}>
      <SearchLoader searchParams={searchParams} />
    </Suspense>
  );
}
