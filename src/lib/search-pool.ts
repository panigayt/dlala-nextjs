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
// 23 Oct 2026 (reads-reduction 3): the pool computation itself moved
// onto the siteStats precompute seam — see fetchSearchPoolRouted below.
// The live Firestore pipeline (fetchSearchPool) remains as the
// circuit-broken fallback for a genuinely missing index dataset.
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
  runSearchPipelineFromIndexWithSliver,
  hasFacetFilter,
  SEARCH_PAGE_SIZE,
  type ListingCard,
  type SearchBoostVerdicts,
  type SearchFilters,
  type SearchIndexEntry,
  type SearchResult,
} from './firestore';
import {
  claimStatsScan,
  readStatsDocDetailed,
  readStatsSearchIndexDetailed,
} from './site-stats';

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

// Search index routing (23 Oct 2026, reads-reduction 3 — the root fix
// for slow filtering). The pool is computed from the precomputed
// siteStats/search dataset (every live listing as a compact entry +
// seller boost verdict inputs, refreshed by the CF every 12h) by
// runSearchPipelineFromIndex — no 120-doc live pool fetch, no
// per-search seller :batchGet for indexed docs. Freshness is the
// feed's hybrid model: the dataset is ≤12h old, the index payload
// itself is cached for 1h per instance below (a dataset cache, not a
// result cache — per-filter results keep the 60s pool cache above),
// and post-watermark arrivals are merged live by
// runSearchPipelineFromIndexWithSliver (firestore.ts): ONE bounded
// sliver query (≤24 docs) + ONE verdict :batchGet (≤24 sellers) per
// pool execution — ≤48 added reads worst case, typical 1–6 — so a
// just-published listing is findable immediately, exactly as on the
// home feed. Sliver failure degrades to the pure index pool.
//
// Fallback policy (package-2 discipline, claimStatsScan): the head doc
// is probed on every pool execution (1 read) so the classification is
// always fresh even though the payload is cached.
//   head ok      → serve the index; if the payload read then fails
//                  (chunk corruption / transient), serve [] — a
//                  malformed index is never a scan licence.
//   head missing → the live pipeline may run ONCE per process per
//                  cooldown (breaker); beyond that, serve [].
//   head error   → transient: serve [], never scan.
interface SearchIndexData {
  entries: SearchIndexEntry[];
  boost: SearchBoostVerdicts;
}

async function fetchSearchIndexCached(): Promise<SearchIndexData | null> {
  'use cache';
  cacheLife({ revalidate: 3600 });
  const r = await readStatsSearchIndexDetailed().catch(() => null);
  if (!r || r.kind !== 'ok') return null;
  return {
    entries: r.value.entries as unknown as SearchIndexEntry[],
    boost: r.value.boost,
  };
}

async function fetchSearchPoolRouted(f: SearchFilters): Promise<ListingCard[]> {
  const head = await readStatsDocDetailed('search').catch(
    () => ({ kind: 'error' }) as const
  );
  if (head.kind === 'ok') {
    const idx = await fetchSearchIndexCached();
    if (idx) return runSearchPipelineFromIndexWithSliver(idx.entries, idx.boost, f);
    return [];
  }
  if (head.kind === 'missing') {
    if (claimStatsScan('search')) return fetchSearchPool(f);
    return [];
  }
  return [];
}

async function fetchSearchPoolCached(key: string): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  const f: SearchFilters = Object.fromEntries(JSON.parse(key));
  return fetchSearchPoolRouted(f);
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
