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
  const offsetRaw = req.nextUrl.searchParams.get('offset');
  const offset = Math.max(0, parseInt(offsetRaw || '0', 10) || 0);
  // Sanity cap: never allow an absurd offset to trigger a huge scan.
  if (offset > 10000) {
    return NextResponse.json({ error: 'offset-too-large' }, { status: 400 });
  }
  try {
    // 11 Oct 2026: server-side timeout (was hanging until platform timeout).
    const docs = await Promise.race([
      fetchFeed(PAGE_SIZE, offset),
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
    return NextResponse.json(
      { regular, hasMore: docs.length >= PAGE_SIZE },
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
