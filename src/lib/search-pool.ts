// Cached search pool (22 Oct 2026, reads-incident root fix).
//
// Server-only module (imported by the /search page and /api/search —
// never by client components). The matched pool for a filter set is
// computed ONCE per 60s window ('use cache', the same revalidate the
// /search SSR wrapper already used) and every page of that filter set —
// SSR first paint, home filtered grid, search "show more" — is a slice
// of the cached pool. Before this module, each "show more" click
// re-executed the whole pipeline at a growing limit (25 → 49 → 73 →
// 97 → 121 reads, plus a fresh seller-boost :batchGet per click), and
// every visitor repeated the full cost independently.
//
// Behavior contract (identical outputs to the legacy shaping):
// - deep-pool mode (text query, price range, or facet filters): every
//   matched doc is painted, total = matched count, hasMore = false.
// - structured mode: listings = matched prefix of `limit`,
//   total = painted count (legacy setResultsCount(shown.length)),
//   hasMore = more matched docs exist beyond the prefix.
// The one deliberate refinement: the boost partition is computed over
// the full bounded pool (SEARCH_DEEP_POOL) instead of over each
// request's limit+1 window. The legacy windows were not self-consistent
// (the partition changed as the limit grew, reshuffling page 1 on every
// "show more"); the full matched SET is unchanged, and paging is now a
// stable stream — zero duplicates, zero gaps.

import { cacheLife } from 'next/cache';
import {
  fetchSearchPool,
  hasFacetFilter,
  SEARCH_PAGE_SIZE,
  type ListingCard,
  type SearchFilters,
  type SearchResult,
} from './firestore';

// Canonical cache key for a filter set. The cached function below takes
// ONLY this string — measured on the fixed build (22 Oct 2026): keying
// 'use cache' on the filters OBJECT produced separate entries for the
// /search page render and the /api/search route (the two call sites
// build the object through different parse paths), so the pool still
// re-executed across the SSR → "show more" boundary. A canonical string
// (defined, non-empty fields only, fixed field order) is identical for
// identical filter sets in every context — and it is exactly invertible
// (all SearchFilters fields are flat strings).
const SEARCH_FILTER_FIELDS = [
  'q', 'cat', 'wilaya', 'min', 'max', 'sort',
  'fOs', 'fBrand', 'fCarBrand', 'fFuel', 'fGear',
  'fYearMin', 'fYearMax', 'fMilMin', 'fMilMax',
] as const;

function canonicalSearchKey(f: SearchFilters): string {
  const pairs: [string, string][] = [];
  for (const k of SEARCH_FILTER_FIELDS) {
    const v = f[k];
    if (v !== undefined && v !== '') pairs.push([k, v]);
  }
  return JSON.stringify(pairs);
}

async function fetchSearchPoolCached(key: string): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  const f: SearchFilters = Object.fromEntries(JSON.parse(key));
  return fetchSearchPool(f);
}

// Server-side search: structured Firestore filters + client-side text
// match (mirrors js/home.js renderFeed text-query branch).
export async function searchListingsWithCount(
  f: SearchFilters,
  limit = SEARCH_PAGE_SIZE
): Promise<SearchResult> {
  // js/home.js feedShape(): deep-fetch the pool when the client refines
  // it itself — price range, text query, or facet refinements.
  const usePriceRange =
    (f.min !== undefined && f.min !== '') || (f.max !== undefined && f.max !== '');
  const deepPool = usePriceRange || !!f.q?.trim() || hasFacetFilter(f);
  const matched = await fetchSearchPoolCached(canonicalSearchKey(f));
  if (deepPool) {
    // Legacy deepPool mode paints every matched doc — no load-more.
    return { listings: matched, total: matched.length, hasMore: false };
  }
  const listings = matched.slice(0, limit);
  // total = painted cards (legacy setResultsCount(shown.length)).
  return { listings, total: listings.length, hasMore: matched.length > limit };
}

// Backward-compatible wrapper — the painted cards only.
export async function searchListings(
  f: SearchFilters,
  limit = SEARCH_PAGE_SIZE
): Promise<ListingCard[]> {
  return (await searchListingsWithCount(f, limit)).listings;
}
