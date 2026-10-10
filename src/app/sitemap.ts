import type { MetadataRoute } from 'next';
import { cacheLife } from 'next/cache';
import { fetchFeed } from '@/lib/firestore';
import { GUIDE_SLUGS } from '@/lib/guides';
import { priceGuideSlug, priceGuideYear } from '@/lib/price-guide';

const BASE = 'https://dlala-nextjs.vercel.app';

// Production sitemap (10 Oct 2026 monitor): 1,261 URLs — 1,195 live listing
// URLs + 66 non-listing URLs. The old code capped listings at 100, so ~1,100
// live listings were invisible to crawlers on the Next.js candidate.
// Paginate the live-listings feed (status IN available/negotiating — the
// same "live" definition as production) until a short page.
const PAGE_SIZE = 200;
const MAX_PAGES = 50; // 10,000 listings headroom

async function fetchAllLiveListings() {
  // Production parity (0.0.0.39): the production sitemap is a DYNAMIC Cloud
  // Function with max-age=3600. 'use cache' + cacheLife('hours') is the
  // Next 16 (cacheComponents) replacement for the removed `revalidate`
  // segment config — the sitemap regenerates hourly so new listings appear
  // without a redeploy.
  'use cache';
  cacheLife('hours');
  const all: Awaited<ReturnType<typeof fetchFeed>> = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchFeed(PAGE_SIZE, page * PAGE_SIZE);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break; // short page = exhausted
  }
  return all;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: 'hourly', priority: 1 },
    { url: `${BASE}/search`, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${BASE}/wanted`, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${BASE}/announcements`, changeFrequency: 'daily', priority: 0.5 },
    { url: `${BASE}/auth`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    // Round 129: SEO guides (production parity — the production sitemap
    // lists the guide articles weekly/0.7; the index pages are real crawlable
    // routes served by the production guides function, included here).
    // Round 130: the dynamic live price guide (S-17/S-18/S-25) — the slug
    // rolls with the year; the model/category landing pages are still open.
    { url: `${BASE}/guides`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/fr/guides`, changeFrequency: 'weekly', priority: 0.7 },
    {
      url: `${BASE}/guides/${priceGuideSlug(priceGuideYear())}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    },
    {
      url: `${BASE}/fr/guides/${priceGuideSlug(priceGuideYear())}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    },
    ...GUIDE_SLUGS.map((slug) => ({
      url: `${BASE}/guides/${slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...GUIDE_SLUGS.map((slug) => ({
      url: `${BASE}/fr/guides/${slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];

  try {
    const listings = await fetchAllLiveListings();
    const listingUrls: MetadataRoute.Sitemap = listings.map((l) => ({
      url: `${BASE}/listing/${l.id}`,
      lastModified: l.createdAt || undefined,
      changeFrequency: 'daily' as const,
      priority: 0.9,
    }));
    return [...staticRoutes, ...listingUrls];
  } catch {
    // Firestore unreachable — return static routes only
    return staticRoutes;
  }
}
