// FeedPreloadHints — Round 14 T11, reworked Round 16 T12.
//
// <link rel="preload" as="image"> hints for the FIRST 6 feed thumbnails so
// the browser fetches them with high priority during initial HTML parse
// (T10's SSR card <img> work makes them discoverable; this makes them
// early).
//
// Round 16 T12: the hints are emitted as RAW HTML (see
// ./preload-links.ts) instead of JSX <link> tags. T10 measured the JSX
// tags landing at ~73KB — AFTER all 24 card <img>s — because React 19
// treats body <link> as a hoistable resource and flushes it late in the
// stream, neutering the preload (the browser dedups it to the
// already-in-flight <img> request). ReactDOM.preload() — the Next 16
// documented mechanism — is a silent no-op under this repo's Turbopack +
// cacheComponents + PPR setup (verified: no tags, no Link: headers in
// served HTML). Raw HTML cannot be reordered: the bytes land exactly
// where this component renders, which is BEFORE the card <img>s.
//
// URLs come from cardImage() — byte-identical to the src the card <img>
// renders (ListingCardView / FeedWithLoadMore both use cardImage) — so the
// preload is a cache hit, never a wasted fetch. Empties are skipped and
// duplicate URLs collapsed. Hard cap of 6: more would contend with
// critical resources on weak networks.
//
// Used by: src/app/page.tsx (home) and src/app/search/page.tsx (search).
//
// Round 20 T11: a SECOND band — cards 6-11 (slice(6, 12)) emitted at
// fetchpriority="low". T6-T10 proved 100% of home card thumbnail dispatches
// are initiator=parser and that preload(high) hints override loading="lazy"
// deferral (cards 4-5 dispatch in the parse-time wave); the dominant cost is
// download duration under contention. The low band pre-warms the
// just-below-fold rows without contending with the 6 critical above-fold
// thumbs (Fizz-auto 0-3 + manual high 4-5). NEVER preload all 24: on weak
// networks that starves the critical band.

import { cardImage, type ListingCard } from '@/lib/firestore';
import PreloadLinks, { type PreloadItem } from './PreloadLinks';

const MAX_HINTS = 6;

export default function FeedPreloadHints({
  cards,
  priority = 'high',
}: {
  cards: ListingCard[];
  priority?: PreloadItem['fetchPriority'];
}) {
  const items: PreloadItem[] = [];
  for (const c of cards) {
    const u = cardImage(c);
    if (u && !items.some((it) => it.href === u)) {
      items.push({ href: u, fetchPriority: priority });
    }
    if (items.length >= MAX_HINTS) break;
  }
  return <PreloadLinks items={items} />;
}
