// GET /api/search?q=&cat=&wilaya=&min=&max=&sort=&f*=&limit=<n>
// → { listings, total, hasMore }. Backs the search page "عرض المزيد"
// button (mirrors the /api/seller/[uid]/listings pattern from Round 69).

import { NextRequest } from 'next/server';
import { searchListingsWithCount, SEARCH_PAGE_SIZE } from '@/lib/firestore';
import { parseSearchFilters } from '@/app/search/filters';

// Five legacy pages of 24 — enough for deep browsing, bounded reads.
const MAX_LIMIT = 120;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters = parseSearchFilters(Object.fromEntries(sp.entries()));
  // 11 Oct 2026: absent/empty limit → SEARCH_PAGE_SIZE (was 1).
  const rawStr = sp.get('limit');
  const raw = rawStr === null || rawStr === '' ? NaN : Number(rawStr);
  const limit = Number.isFinite(raw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw)))
    : SEARCH_PAGE_SIZE;
  // 11 Oct 2026: try/catch — upstream failures returned bare 500 HTML.
  try {
    const { listings, total, hasMore } = await searchListingsWithCount(filters, limit);
    return Response.json(
      { listings, total, hasMore },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch {
    return Response.json({ error: 'search-failed' }, { status: 502 });
  }
}
