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

const PAGE_SIZE = 24;

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
    const regular = docs.filter((d) => !d.isWanted);
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
