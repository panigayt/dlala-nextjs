// FeedPreloadHints — Round 14 T11.
//
// <link rel="preload" as="image"> hints for the FIRST 6 feed thumbnails so
// the browser fetches them with high priority during initial HTML parse
// (T10's SSR card <img> work makes them discoverable; this makes them
// early). VERIFIED 12 Oct 2026 via prod-build curl: in Next.js 16 these
// render early in <body>, NOT in <head> — React 19 hoisting does not move
// page-body <link> tags into <head> (also true of the listing page's Round
// 149/159 tags), and the Metadata API cannot emit <link> tags ('other'
// renders <meta> only). The browser's preload scanner still discovers them
// during initial parse, well before the card <img>s.
//
// URLs come from cardImage() — byte-identical to the src the card <img>
// renders (ListingCardView / FeedWithLoadMore both use cardImage) — so the
// preload is a cache hit, never a wasted fetch. Empties are skipped and
// duplicate URLs collapsed. Hard cap of 6: more would contend with
// critical resources on weak networks.
//
// Used by: src/app/page.tsx (home) and src/app/search/page.tsx (search).

import { cardImage, type ListingCard } from '@/lib/firestore';

const MAX_HINTS = 6;

export default function FeedPreloadHints({ cards }: { cards: ListingCard[] }) {
  const hrefs: string[] = [];
  for (const c of cards) {
    const u = cardImage(c);
    if (u && !hrefs.includes(u)) hrefs.push(u);
    if (hrefs.length >= MAX_HINTS) break;
  }
  return (
    <>
      {hrefs.map((href) => (
        <link
          key={href}
          rel="preload"
          as="image"
          href={href}
          fetchPriority="high"
        />
      ))}
    </>
  );
}
