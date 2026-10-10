// GET /api/search/store-matches?q=<text> → { stores: VerifiedStore[] }
// Backs the verified-store cards atop search results (js/home.js 0.0.0.1m,
// Zak-ordered; match logic js/market.js matchVerifiedStores, max 3).
// Best-effort: fails closed with { stores: [] } — the results grid is
// unaffected. Legacy paints these as a background splice; the client
// component fetches this once on mount (skipped when q is empty, skipped
// on "عرض المزيد" appends — the cards stay above page 1).

import { NextRequest } from 'next/server';
import { fetchVerifiedStores } from '@/lib/firestore';
import { matchVerifiedStores } from '@/lib/matching';

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (!q) {
    return Response.json(
      { stores: [] },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  }
  const stores = await fetchVerifiedStores();
  const matched = matchVerifiedStores(stores, q, 3);
  return Response.json(
    { stores: matched },
    { headers: { 'Cache-Control': 'public, max-age=60' } }
  );
}
