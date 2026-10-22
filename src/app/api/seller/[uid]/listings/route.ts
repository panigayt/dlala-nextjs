// GET /api/seller/[uid]/listings — paginated seller-grid fetch.
//
// Round 69: "Show more" pagination on the seller grid (js/seller.js R3
// parity — Zak ordered): the grid starts at SELLER_LISTINGS_PAGE_SIZE ads,
// the 'عرض المزيد' button adds +30.
//
// Primary contract (22 Oct 2026, reads-incident root fix):
//   ?cursor=<opaque> — fetch the NEXT page (30 ads) after the cursor and
//   APPEND client-side. Returns { listings, nextCursor, hasMore }.
//   The legacy mode below re-queried with a growing limit and re-read
//   every previously shown ad on each click.
//
// Legacy compat: ?limit=<number> — total ads to return (default 30),
// full-replace semantics, unchanged. No first-party client uses it.
//
// The seller's active listings are public; this mirrors the server-side
// fetch in src/app/seller/[uid]/page.tsx (Firestore REST, zero SDK).

import { NextRequest, NextResponse } from 'next/server';
import { cacheLife } from 'next/cache';
import {
  fetchSellerListings,
  fetchSellerListingsPage,
  encodePageCursor,
  decodePageCursor,
  SELLER_LISTINGS_PAGE_SIZE,
  type ListingCard,
} from '@/lib/firestore';

const MAX_LIMIT = 500;

// Guest shield (22 Oct 2026): seller grids are identical for every
// visitor — cache each page/limit for the same 60s window the response
// Cache-Control header already promises (and the SSR first page uses).
async function getSellerListingsCached(
  uid: string,
  limit: number
): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchSellerListings(uid, limit);
}

async function getSellerListingsPageCached(
  uid: string,
  cursorKey: string
): Promise<{ listings: ListingCard[]; nextCursor: string | null }> {
  'use cache';
  cacheLife({ revalidate: 60 });
  const page = await fetchSellerListingsPage(uid, decodePageCursor(cursorKey));
  return {
    listings: page.listings,
    nextCursor: encodePageCursor(page.nextCursor),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const { uid } = await params;
  if (!uid) {
    return NextResponse.json({ error: 'uid-required' }, { status: 400 });
  }
  const cursorRaw = req.nextUrl.searchParams.get('cursor');
  if (cursorRaw !== null) {
    // Cursor mode (primary). An empty or undecodable cursor is a client
    // bug — the grid only ever sends cursors this route issued.
    if (!cursorRaw || !decodePageCursor(cursorRaw)) {
      return NextResponse.json({ error: 'invalid-cursor' }, { status: 400 });
    }
    try {
      const page = await getSellerListingsPageCached(uid, cursorRaw);
      return NextResponse.json(
        {
          listings: page.listings,
          nextCursor: page.nextCursor,
          hasMore: page.nextCursor !== null,
        },
        { headers: { 'Cache-Control': 'public, max-age=60' } }
      );
    } catch {
      return NextResponse.json(
        { error: 'seller-listings-error' },
        { status: 500 }
      );
    }
  }
  const raw = req.nextUrl.searchParams.get('limit');
  let limit = parseInt(raw || '', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = SELLER_LISTINGS_PAGE_SIZE;
  // Sanity cap: never allow an absurd limit to trigger a huge scan.
  limit = Math.min(limit, MAX_LIMIT);
  try {
    const listings = await getSellerListingsCached(uid, limit);
    return NextResponse.json(
      { listings },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch {
    // Round 26 (BH-4): stable error code — echoing e.message leaked
    // internal identifiers (seller-listings-rest-<status>). Matches
    // feed ('feed-unavailable') / search ('search-failed') convention.
    return NextResponse.json(
      { error: 'seller-listings-error' },
      { status: 500 }
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
