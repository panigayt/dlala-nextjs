// Shared homepage feed fetcher.
//
// 17 Oct 2026 (SEO audit FIX #7): extracted verbatim from src/app/page.tsx
// so the /fr/ and /en/ homepages render the IDENTICAL feed. Keep in sync
// with getFeed() in src/app/page.tsx — same Firestore REST query, same
// wanted interleave, same card trim, same 60s cache policy.

import { cacheLife } from 'next/cache';
import {
  fetchFeedPage,
  fetchWanted,
  interleaveWanted,
  trimFeedCard,
  encodePageCursor,
  type ListingCard,
} from '@/lib/firestore';
import type { HomeFeedData } from '@/components/HomePage';

// Cached feed fetcher — ISR equivalent: revalidate every 60 seconds.
// (Next.js 16 Cache Components model: 'use cache' + cacheLife.)
// Fetches the regular feed AND the wanted pool, then interleaves them
// server-side with the verbatim interleaveWanted() logic (js/market.js):
// after every 4th regular card, one wanted card. The wanted pool (up to 120,
// card-field projection) is passed to the client for the "load more" pages
// so the rotation continues without refetching.
export async function getHomeFeed(): Promise<HomeFeedData> {
  'use cache';
  cacheLife({ revalidate: 60 });
  const PAGE_SIZE = 24;
  const [page, wantedPool] = await Promise.all([
    // 22 Oct 2026: cursor page (was fetchFeed) — identical docs/order,
    // plus the stream cursor for client load-more (see src/app/page.tsx).
    fetchFeedPage(PAGE_SIZE),
    // Best-effort: a wanted-pool failure must never break the feed.
    fetchWanted(120).catch(() => [] as ListingCard[]),
  ]);
  const docs = page.docs;
  // Legacy splits the fetched docs (js/home.js: regular/wanted filters).
  const regular = docs.filter((d) => !d.isWanted);
  // Round 62: trim the feed payload — resolve the canonical card image
  // server-side once and drop the 3 photo arrays (see trimFeedCard).
  // Applied to BOTH the interleaved cards and the wanted pool (the pool is
  // serialized too and re-interleaved client-side on "load more").
  const cards = interleaveWanted(regular, wantedPool).map(trimFeedCard);
  const wantedOffset = cards.filter((c) => c.isWanted).length;
  return {
    cards,
    wantedPool: wantedPool.map(trimFeedCard),
    feedCursor: encodePageCursor(page.nextCursor),
    wantedOffset,
    hasMore: docs.length >= PAGE_SIZE,
  };
}
