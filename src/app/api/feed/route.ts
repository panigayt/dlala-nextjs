// GET /api/feed — paginated home feed (regular listings only).
//
// Primary contract (22 Oct 2026, reads-incident root fix):
//   ?cursor=<opaque> — stream position after the last page's raw window
//   (absent = first page). Returns { regular, hasMore, nextCursor }.
//   Cursor pages bill ONLY the documents returned; the legacy OFFSET
//   paging billed offset+limit per page (Firestore charges for skipped
//   documents), which is the cost bomb this fix removes.
//
// Legacy compat: ?offset=<number> / ?page=<number> still page the old
// way (existing contract from R12/AU-D1). No first-party client uses
// them anymore — FeedWithLoadMore speaks cursors. Returns the same
// { regular, hasMore } shape (plus nextCursor, ignored by old clients).
//
// The client interleaves wanted ads (from the server-rendered pool) using
// the verbatim interleaveWanted() logic. This route only pages the regular
// feed: status IN [available, negotiating], orderBy createdAt DESC.
//
// Round 39: "load more" pagination for the home page (legacy loadFeedPage
// append path, adapted to the Next.js ISR architecture).

import { NextRequest, NextResponse } from 'next/server';
import { cacheLife } from 'next/cache';
import {
  fetchFeed,
  fetchFeedPage,
  encodePageCursor,
  decodePageCursor,
  type ListingCard,
  type PageCursor,
} from '@/lib/firestore';
import { variantUrlFor } from '@/lib/image-variants';

const PAGE_SIZE = 24;

// Guest shield (22 Oct 2026): a cursor page is identical for every
// visitor, so cache it for the same 60s window the home SSR and the
// response Cache-Control header already promise. Repeat scrolls by any
// number of guests inside the window cost ONE Firestore page execution.
// Keyed on (limit, opaque cursor string) — '' is the first page.
async function getFeedPageCached(
  limit: number,
  cursorKey: string
): Promise<{ docs: ListingCard[]; nextCursor: PageCursor | null }> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchFeedPage(limit, decodePageCursor(cursorKey || null));
}

// Round 4 (18 Oct 2026, audit R-5): the feed payload carried full-size
// photoUrls (~10x the bytes needed). Clients render cards with thumbnails,
// so rewrite to w320 variants here — saves ~30KB+ per 24-item page on weak
// connections. Falls back to the original URL when no variant is derivable
// (old listings without photoVariants).
function withW320Thumbs<T extends { photoUrls?: unknown; photoVariants?: boolean; photo_thumbs?: unknown }>(
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
  // 18 Oct 2026 (Zak): set img field for load-more cards — the card uses
  // l.img || cardImage(l), and without img the fallback can fail on fast scroll.
  const d = doc as { photo_thumbs?: string[] };
  const thumbs = d.photo_thumbs;
  const img = (Array.isArray(thumbs) && thumbs[0]) || w320[0] || '';
  // 19 Oct 2026: infer photoVariants when w320 thumbnails exist — old
  // listings published before the AT-3 fix lack the flag, but their
  // photo_thumbs prove variants exist. This restores the LQIP blur-up
  // fade (BlurUpImage gates on photoVariants).
  const hasW320Thumbs =
    Array.isArray(thumbs) &&
    thumbs.some((t) => typeof t === 'string' && t.includes('/w320_'));
  const out = { ...doc, photoUrls: w320, img };
  if (hasW320Thumbs && !(doc as { photoVariants?: boolean }).photoVariants) {
    (out as { photoVariants?: boolean }).photoVariants = true;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  // AU-D1 (R12, 18 Oct 2026): honor ?page= and ?limit= (were silently
  // ignored — ?page=1 and ?page=2 returned byte-identical lists).
  // ?offset= takes precedence when both are given (existing clients).
  const limitRaw = params.get('limit');
  const pageRaw = params.get('page');
  const offsetRaw = params.get('offset');
  const cursorRaw = params.get('cursor');
  let limit = PAGE_SIZE;
  if (limitRaw !== null) {
    const l = parseInt(limitRaw, 10);
    if (!Number.isFinite(l) || l < 1 || l > 100) {
      return NextResponse.json({ error: 'invalid-limit' }, { status: 400 });
    }
    limit = l;
  }
  // 22 Oct 2026: cursor mode is the default and the only mode the
  // first-party client uses. ?offset=/?page= select the legacy branch
  // (kept for contract compat — see the file header).
  const legacyMode = offsetRaw !== null || pageRaw !== null;
  let offset = 0;
  if (legacyMode) {
    if (offsetRaw !== null) {
      offset = Math.max(0, parseInt(offsetRaw, 10) || 0);
    } else if (pageRaw !== null) {
      const p = parseInt(pageRaw, 10);
      if (!Number.isFinite(p) || p < 1) {
        return NextResponse.json({ error: 'invalid-page' }, { status: 400 });
      }
      offset = (p - 1) * limit;
    }
    // Sanity cap: never allow an absurd offset to trigger a huge scan.
    if (offset > 10000) {
      return NextResponse.json({ error: 'offset-too-large' }, { status: 400 });
    }
  } else if (cursorRaw !== null && cursorRaw !== '' && !decodePageCursor(cursorRaw)) {
    return NextResponse.json({ error: 'invalid-cursor' }, { status: 400 });
  }
  try {
    // 11 Oct 2026: server-side timeout (was hanging until platform timeout).
    const page = await Promise.race([
      legacyMode
        ? fetchFeed(limit, offset).then((docs) => ({ docs, nextCursor: null }))
        : getFeedPageCached(limit, cursorRaw || ''),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('feed-timeout')), 15000)
      ),
    ]);
    const docs = page.docs;
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
      {
        regular,
        hasMore: regular.length >= limit,
        nextCursor: encodePageCursor(page.nextCursor),
      },
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
