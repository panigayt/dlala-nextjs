// GET /api/search/store-matches?q=<text> → { stores: VerifiedStore[] }
// Backs the verified-store cards atop search results (js/home.js 0.0.0.1m,
// Zak-ordered; match logic js/market.js matchVerifiedStores, max 3).
// Best-effort: fails closed with { stores: [] } — the results grid is
// unaffected. Legacy paints these as a background splice; the client
// component fetches this once on mount (skipped when q is empty, skipped
// on "عرض المزيد" appends — the cards stay above page 1).

import { NextRequest, NextResponse } from 'next/server';
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
  // Round 26 (BH-3): wrap in try/catch — an unwrapped upstream failure
  // returned Next.js's default 500 HTML instead of JSON. Fails closed
  // with { stores: [] } so the results grid is unaffected.
  try {
    const stores = await fetchVerifiedStores();
    const matched = matchVerifiedStores(stores, q, 3);
    return Response.json(
      { stores: matched },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch {
    return Response.json(
      { stores: [] },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  }
}

// Round 6 (18 Oct 2026): 405 with Allow header for wrong methods.
// Next.js auto-405 omits the Allow header; RFC 9110 requires it.
const METHOD_NOT_ALLOWED_GET = () =>
  NextResponse.json({ error: 'method-not-allowed' }, { status: 405, headers: { Allow: 'GET' } });
export async function POST() { return METHOD_NOT_ALLOWED_GET(); }
export async function PUT() { return METHOD_NOT_ALLOWED_GET(); }
export async function DELETE() { return METHOD_NOT_ALLOWED_GET(); }
export async function PATCH() { return METHOD_NOT_ALLOWED_GET(); }
