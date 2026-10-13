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

import { cardImage, type ListingCard } from '@/lib/firestore';
import PreloadLinks, { type PreloadItem } from './PreloadLinks';

const MAX_HINTS = 6;

export default function FeedPreloadHints({ cards }: { cards: ListingCard[] }) {
  const items: PreloadItem[] = [];
  for (const c of cards) {
    const u = cardImage(c);
    if (u && !items.some((it) => it.href === u)) {
      items.push({ href: u, fetchPriority: 'high' });
    }
    if (items.length >= MAX_HINTS) break;
  }
  return <PreloadLinks items={items} />;
}
