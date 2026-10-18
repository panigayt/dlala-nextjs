// GET /api/feed — paginated home feed (regular listings only).
//
// Query: ?offset=<number> — number of regular listings already shown.
// Returns: { regular: ListingCard[], hasMore: boolean }
//
// The client interleaves wanted ads (from the server-rendered pool) using
// the verbatim interleaveWanted() logic. This route only pages the regular
// feed: status IN [available, negotiating], orderBy createdAt DESC.
//
// Round 39: "load more" pagination for the home page (legacy loadFeedPage
// append path, adapted to the Next.js ISR architecture).

import { NextRequest, NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/firestore';
import { variantUrlFor } from '@/lib/image-variants';

const PAGE_SIZE = 24;

// Round 4 (18 Oct 2026, audit R-5): the feed payload carried full-size
// photoUrls (~10x the bytes needed). Clients render cards with thumbnails,
// so rewrite to w320 variants here — saves ~30KB+ per 24-item page on weak
// connections. Falls back to the original URL when no variant is derivable
// (old listings without photoVariants).
function withW320Thumbs<T extends { photoUrls?: unknown; photoVariants?: boolean }>(
  doc: T
): T {
  const urls = (doc as { photoUrls?: string[] }).photoUrls;
  if (!Array.isArray(urls) || !urls.length) return doc;
  const w320 = urls.map((u) => {
    if (!(doc as { photoVariants?: boolean }).photoVariants) return u;
    try {
      return variantUrlFor(String(u), 320) || u;
    } catch {
      return u;
    }
  });
  return { ...doc, photoUrls: w320 };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  // AU-D1 (R12, 18 Oct 2026): honor ?page= and ?limit= (were silently
  // ignored — ?page=1 and ?page=2 returned byte-identical lists).
  // ?offset= takes precedence when both are given (existing clients).
  const limitRaw = params.get('limit');
  const pageRaw = params.get('page');
  const offsetRaw = params.get('offset');
  let limit = PAGE_SIZE;
  if (limitRaw !== null) {
    const l = parseInt(limitRaw, 10);
    if (!Number.isFinite(l) || l < 1 || l > 100) {
      return NextResponse.json({ error: 'invalid-limit' }, { status: 400 });
    }
    limit = l;
  }
  let offset: number;
  if (offsetRaw !== null) {
    offset = Math.max(0, parseInt(offsetRaw, 10) || 0);
  } else if (pageRaw !== null) {
    const p = parseInt(pageRaw, 10);
    if (!Number.isFinite(p) || p < 1) {
      return NextResponse.json({ error: 'invalid-page' }, { status: 400 });
    }
    offset = (p - 1) * limit;
  } else {
    offset = 0;
  }
  // Sanity cap: never allow an absurd offset to trigger a huge scan.
  if (offset > 10000) {
    return NextResponse.json({ error: 'offset-too-large' }, { status: 400 });
  }
  try {
    // 11 Oct 2026: server-side timeout (was hanging until platform timeout).
    const docs = await Promise.race([
      fetchFeed(limit, offset),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('feed-timeout')), 15000)
      ),
    ]);
    // The feed query can return wanted docs mixed in (legacy splits them
    // client-side); the regular pool for pagination excludes them.
    // Round 4 (18 Oct 2026): rewrite photoUrls to w320 thumbnails —
    // the client renders cards, never full-size images.
    const regular = docs
      .filter((d) => !d.isWanted)
      .map(withW320Thumbs);
    // BH-obs1 (R17): compute hasMore on the wanted-FILTERED array — the
    // client only ever consumes `regular`, so pre-filter `docs.length` could
    // claim more pages while the filtered list was exhausted (e.g. a page
    // that happened to be all-wanted).
    return NextResponse.json(
      { regular, hasMore: regular.length >= limit },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch {
    // 11 Oct 2026: stable error code — was leaking internal messages.
    return NextResponse.json(
      { error: 'feed-unavailable' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
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
