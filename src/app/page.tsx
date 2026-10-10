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
import { fetchFeed, fetchWanted, interleaveWanted, type ListingCard } from '@/lib/firestore';
import { t } from '@/lib/i18n-strings';
import { getServerLang } from '@/lib/server-lang';
import HomePage, { type HomeFeedData } from '@/components/HomePage';

// Round 133: <title> follows the reader's language (dlala_lang cookie;
// localStorage is client-only). The meta description is inherited from the
// root layout's static metadata (title-only scope).
export async function generateMetadata(): Promise<Metadata> {
  return { title: t('title_home', await getServerLang()) };
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
  const cards = interleaveWanted(regular, wantedPool);
  const wantedOffset = cards.filter((c) => c.isWanted).length;
  return {
    cards,
    wantedPool,
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

  return <HomePage feed={feed} error={error} />;
}
