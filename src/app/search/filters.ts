// Shared search-filter parsing for /search (page) and /api/search (route).
// Extracted so both parse the identical param set — one definition, no drift.

import type { SearchFilters } from '@/lib/firestore';

// Round 18 BK-obs1: cap the text query length. 5000-char queries were
// accepted and fully re-echoed in the page heading — no matching or
// indexing benefit past a short query, and the echo bloats the HTML.
// The server clamps here (both /search and /api/search parse through this
// function); clients truncate before submit.
export const SEARCH_Q_MAX = 200;

// Server-side clamp for the text query (Round 18 BK-obs1). Slice (not
// trim-then-slice — trimming would change matching semantics for queries
// with meaningful leading/trailing spaces; length is the only concern).
export function clampQ(q: string): string {
  return q.length > SEARCH_Q_MAX ? q.slice(0, SEARCH_Q_MAX) : q;
}

export function parseSearchFilters(
  sp: Record<string, string | string[] | undefined>
): SearchFilters {
  const get = (k: string): string => {
    const v = sp[k];
    return typeof v === 'string' ? v : '';
  };
  // 14 Oct 2026 audit R16: accept common param aliases.
  const sortRaw = get('sort');
  // 16 Oct 2026 audit R247 (N39): match aliases case-insensitively; keep
  // the original casing for all other values (server sorts are case-sensitive).
  const sortLower = sortRaw.toLowerCase();
  const sort =
    sortLower === 'price-asc' ? 'priceAsc' : sortLower === 'price-desc' ? 'priceDesc' : sortRaw || undefined;
  return {
    q: clampQ(get('q')) || undefined,
    cat: get('cat') || get('category') || undefined,
    wilaya: get('wilaya') || undefined,
    min: get('min') || get('priceMin') || undefined,
    max: get('max') || get('priceMax') || undefined,
    sort,
    fOs: get('fOs') || undefined,
    fBrand: get('fBrand') || undefined,
    fCarBrand: get('fCarBrand') || undefined,
    fFuel: get('fFuel') || undefined,
    fGear: get('fGear') || undefined,
    fYearMin: get('fYearMin') || undefined,
    fYearMax: get('fYearMax') || undefined,
    fMilMin: get('fMilMin') || undefined,
    fMilMax: get('fMilMax') || undefined,
  };
}

// Serialize filters back to a query string (load-more re-query).
export function filtersToQuery(f: SearchFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v) p.set(k, v);
  }
  return p.toString();
}
