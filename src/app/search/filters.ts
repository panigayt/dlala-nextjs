// Shared search-filter parsing for /search (page) and /api/search (route).
// Extracted so both parse the identical param set — one definition, no drift.

import type { SearchFilters } from '@/lib/firestore';

export function parseSearchFilters(
  sp: Record<string, string | string[] | undefined>
): SearchFilters {
  const get = (k: string): string => {
    const v = sp[k];
    return typeof v === 'string' ? v : '';
  };
  // 14 Oct 2026 audit R16: accept common param aliases.
  const sortRaw = get('sort');
  const sort =
    sortRaw === 'price-asc' ? 'priceAsc' : sortRaw === 'price-desc' ? 'priceDesc' : sortRaw || undefined;
  return {
    q: get('q') || undefined,
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
