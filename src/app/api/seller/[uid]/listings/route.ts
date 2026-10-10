// GET /api/seller/[uid]/listings?limit=<n> — paginated seller-grid fetch.
//
// Round 69: "Show more" pagination on the seller grid (js/seller.js R3
// parity — Zak ordered): the grid starts at SELLER_LISTINGS_PAGE_SIZE ads,
// the 'عرض المزيد' button adds +30 and the client re-queries the server
// with the new limit (newest-first, so a full replace is correct).
//
// Query: ?limit=<number> — total ads to return (default 30).
// Returns: { listings: ListingCard[] }
//
// The seller's active listings are public; this mirrors the server-side
// fetch in src/app/seller/[uid]/page.tsx (Firestore REST, zero SDK).

import { NextRequest, NextResponse } from 'next/server';
import { fetchSellerListings, SELLER_LISTINGS_PAGE_SIZE } from '@/lib/firestore';

const MAX_LIMIT = 500;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const { uid } = await params;
  if (!uid) {
    return NextResponse.json({ error: 'uid-required' }, { status: 400 });
  }
  const raw = req.nextUrl.searchParams.get('limit');
  let limit = parseInt(raw || '', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = SELLER_LISTINGS_PAGE_SIZE;
  // Sanity cap: never allow an absurd limit to trigger a huge scan.
  limit = Math.min(limit, MAX_LIMIT);
  try {
    const listings = await fetchSellerListings(uid, limit);
    return NextResponse.json(
      { listings },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'seller-listings-error' },
      { status: 500 }
    );
  }
}
