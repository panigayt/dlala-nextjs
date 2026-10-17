// Dlala home — Server-Side Rendered feed.
//
// Architecture (per ~/workspace/dlala-nextjs-zero-budget-plan.md):
//   - Server Component: fetches the feed from Firestore REST at request time.
//   - ISR: revalidate every 60s — the CDN serves a pre-rendered page,
//     Firestore is hit at most once per minute, not per visitor.
//   - Zero Firebase SDK on the server path: plain fetch() to the REST API.
//
// This mirrors the guest home feed of the production SPA
// (js/home.js buildFeedRestQuery default branch) exactly:
//   status IN [available, negotiating], orderBy createdAt DESC, limit 24,
//   card-field projection.
//
// Round 107: all language-dependent rendering moved to the client
// <HomePage> shell (search bar, chips, filters, heading, states, feed)
// so the whole page follows the UI language via useLang()
// (js/i18n.js onLangChange parity). The server only fetches data.

import type { Metadata } from 'next';
import { cacheLife } from 'next/cache';
import { fetchFeed, fetchWanted, interleaveWanted, trimFeedCard, type ListingCard } from '@/lib/firestore';
import { t } from '@/lib/i18n-strings';
import HomePage, { type HomeFeedData } from '@/components/HomePage';
import FeedPreloadHints from '@/components/FeedPreloadHints';

// 17 Oct 2026 (audit H2 — root-cause fix): generateMetadata is STATIC —
// no dlala_lang cookie read. Awaiting cookies() here deferred the metadata
// segment past the initial <head> flush, so Next streamed <title>, <meta>,
// canonical and OG tags into <body> (verified in production HTML:
// </head> at byte 2220, <title> at byte 85646). Static metadata resolves
// before the head flush — crawlers get the Arabic fallback (site default,
// same as the root layout and the /search precedent, Round 11 Team 2).
// The <title> still follows the reader's language: lib/i18n's client-side
// updateDocTitle re-localizes the tab on hydration (titleKeyForPath '/'
// → 'title_home') and on every language switch.
export function generateMetadata(): Metadata {
  const title = t('title_home', 'ar');
  const desc = t('meta_home_desc', 'ar');
  return {
    title,
    description: desc,
    // 12 Oct 2026: canonical for SEO (was missing).
    // 17 Oct 2026 (SEO audit FIX #15): no trailing slash — matches the
    // sitemap homepage URL (https://www.dzdlala.com) and the convention of
    // every other page (listing/model/wilaya URLs have no trailing slash).
    alternates: { canonical: 'https://www.dzdlala.com' },
    openGraph: {
      title,
      description: desc,
      type: 'website',
      url: 'https://www.dzdlala.com',
      images: [{ url: 'https://www.dzdlala.com/icon-512.png' }],
    },
    twitter: {
      card: 'summary',
      title,
      description: desc,
    },
  };
}

// Cached feed fetcher — ISR equivalent: revalidate every 60 seconds.
// (Next.js 16 Cache Components model: 'use cache' + cacheLife.)
// Round 39: fetches the regular feed AND the wanted pool, then interleaves
// them server-side with the verbatim interleaveWanted() logic (js/market.js):
// after every 4th regular card, one wanted card. The wanted pool (up to 120,
// card-field projection) is passed to the client for the "load more" pages
// so the rotation continues without refetching.
async function getFeed(): Promise<HomeFeedData> {
  'use cache';
  cacheLife({ revalidate: 60 });
  const PAGE_SIZE = 24;
  const [docs, wantedPool] = await Promise.all([
    fetchFeed(PAGE_SIZE),
    // Best-effort: a wanted-pool failure must never break the feed.
    fetchWanted(120).catch(() => [] as ListingCard[]),
  ]);
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
    regularOffset: PAGE_SIZE,
    wantedOffset,
    hasMore: docs.length >= PAGE_SIZE,
  };
}

export default async function Home() {
  let feed: HomeFeedData | null = null;
  let error: string | null = null;
  try {
    feed = await getFeed();
  } catch (e) {
    error = e instanceof Error ? e.message : 'feed-error';
  }

  // WebSite + Organization structured data (schema.org).
  // Same injection pattern as the listing page (dangerouslySetInnerHTML,
  // < escaped as \u003c so content can never break out of the script).
  const homeJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'Dlala',
        url: 'https://www.dzdlala.com',
        inLanguage: ['ar', 'fr', 'en'],
      },
      {
        '@type': 'Organization',
        name: 'Dlala',
        url: 'https://www.dzdlala.com',
        logo: 'https://www.dzdlala.com/icon-512.png',
      },
    ],
  }).replace(/</g, '\\u003c');

  // Round 14 T11: preload hints for the first 6 feed thumbnails. VERIFIED
  // 12 Oct 2026 via prod-build curl: React 19 does NOT hoist these into
  // <head> in Next.js 16 (same for the listing page's Round 149/159 tags)
  // and the Metadata API cannot emit <link> tags ('other' renders <meta>
  // only — see Next source lib/metadata/metadata-elements.js). The tags
  // render early in <body> (~14KB into the document), where the browser's
  // preload scanner still discovers them during initial parse, well before
  // the card <img>s. Same card order the grid renders.
  return (
    <>
      {/* Round 20 T4: hint only cards 5-6. The first 4 cards render
          loading="eager" (HomePage) so React 19's Fizz renderer already
          auto-emits <link rel="preload" as="image"> for them — manual hints
          over the full list produced 4 byte-duplicate preload pairs
          (Round 19). Same treatment the search page got (slice(4, 6),
          Round 17 T2-retry). Cards 1-4 keep their Fizz auto-preloads, so
          all 6 first thumbnails remain hinted. */}
      <FeedPreloadHints cards={feed ? feed.cards.slice(4, 6) : []} />
      {/* Round 20 T11: SECOND band — cards 7-12 (slice(6, 12)) at
          fetchpriority="low". Pre-warms the just-below-fold rows without
          contending with the critical band (Fizz-auto 0-3 + high 4-5)
          on weak networks. NOT all 24 — the critical band keeps priority. */}
      <FeedPreloadHints cards={feed ? feed.cards.slice(6, 12) : []} priority="low" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: homeJsonLd }}
      />
      <HomePage feed={feed} error={error} />
    </>
  );
}
