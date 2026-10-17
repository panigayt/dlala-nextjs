import type { MetadataRoute } from 'next';
import { cacheLife } from 'next/cache';
import { fetchFeed } from '@/lib/firestore';
import { GUIDE_SLUGS } from '@/lib/guides';
import { priceGuideSlug, priceGuideYear } from '@/lib/price-guide';
import {
  fetchAvailableCars,
  qualifyingModelUrls,
  MIN_LISTINGS,
} from '@/lib/model-pages';
import { qualifyingWilayaUrls, WILAYA_MIN_LISTINGS } from '@/lib/wilaya-pages';

const BASE = 'https://www.dzdlala.com';

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
    // 17 Oct 2026 (SEO audit FIX #4): localized homepage variants
    // (/fr/ and /en/ homepages exist — Arabic default is unprefixed).
    { url: `${BASE}/fr`, changeFrequency: 'hourly', priority: 1 },
    { url: `${BASE}/en`, changeFrequency: 'hourly', priority: 1 },
    // 11 Oct 2026: /search removed — blocked in robots.txt (was Search Console warning).
    { url: `${BASE}/wanted`, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${BASE}/announcements`, changeFrequency: 'daily', priority: 0.5 },
    // 11 Oct 2026: /auth removed — auth-gated utility (production parity).
    { url: `${BASE}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    // Round 129: SEO guides (production parity — the production sitemap
    // lists the guide articles weekly/0.7; the index pages are real crawlable
    // routes served by the production guides function, included here).
    // Round 130: the dynamic live price guide (S-17/S-18/S-25) — the slug
    // rolls with the year; the model/category landing pages are still open.
    { url: `${BASE}/guides`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/fr/guides`, changeFrequency: 'weekly', priority: 0.7 },
    // 12 Oct 2026: English guides (Round 8) — same weekly/0.7 as AR/FR.
    { url: `${BASE}/en/guides`, changeFrequency: 'weekly', priority: 0.7 },
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
    {
      url: `${BASE}/en/guides/${priceGuideSlug(priceGuideYear())}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    },
    // Round 5: dedupe — GUIDE_SLUGS also contains the literal price-guide
    // slug (for the /guides index); skip it here when it matches the dynamic
    // slug so each URL is emitted exactly once per language.
    ...GUIDE_SLUGS.filter((slug) => slug !== priceGuideSlug(priceGuideYear())).map((slug) => ({
      url: `${BASE}/guides/${slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...GUIDE_SLUGS.filter((slug) => slug !== priceGuideSlug(priceGuideYear())).map((slug) => ({
      url: `${BASE}/fr/guides/${slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    // 12 Oct 2026: English guides (Round 8).
    ...GUIDE_SLUGS.filter((slug) => slug !== priceGuideSlug(priceGuideYear())).map((slug) => ({
      url: `${BASE}/en/guides/${slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];

  try {
    const listings = await fetchAllLiveListings();
    // 17 Oct 2026 (SEO audit FIX #4): language variants — Arabic is the
    // default at unprefixed URLs (no /ar/ variant); /fr/ and /en/ variants
    // listed for every live listing.
    const listingUrls: MetadataRoute.Sitemap = listings.flatMap((l) => {
      const entry = (url: string): MetadataRoute.Sitemap[number] => ({
        url,
        lastModified: l.createdAt || undefined,
        changeFrequency: 'daily' as const,
        priority: 0.9,
      });
      return [
        entry(`${BASE}/listing/${l.id}`),
        entry(`${BASE}/fr/listing/${l.id}`),
        entry(`${BASE}/en/listing/${l.id}`),
      ];
    });
    // Round 132: car-model SEO landing pages (production sitemap parity —
    // FIX-FN-018: /voitures/modeles/<slug> with >= MIN_LISTINGS live cars,
    // emitted weekly/0.7 like the production buildSitemapXml landing URLs).
    // Only the Arabic canonical path is advertised (production parity).
    // Round 132: car-model SEO landing pages (production sitemap parity —
    // FIX-FN-018: /voitures/modeles/<slug> with >= MIN_LISTINGS live cars,
    // emitted weekly/0.7 like the production buildSitemapXml landing URLs).
    // 17 Oct 2026 (SEO audit FIX #4): fr/en variants advertised alongside
    // the Arabic canonical (Arabic default stays unprefixed — no /ar/).
    // 14 Oct 2026: cars-per-wilaya SEO landing pages (/voitures/wilaya/<slug>,
    // trilingual ar/fr/en, Arabic canonical). Same weekly/0.7 as the model
    // pages; only wilayas with >= WILAYA_MIN_LISTINGS live cars qualify
    // (thin-content guard parity). 17 Oct 2026 (SEO audit FIX #4): fr/en
    // variants advertised alongside the Arabic canonical.
    // NOTE: fetchAvailableCars is 'use cache' + cacheLife('hours'), so the
    // single fetch below serves both computations.
    let modelUrls: MetadataRoute.Sitemap = [];
    let wilayaUrls: MetadataRoute.Sitemap = [];
    try {
      const cars = await fetchAvailableCars();
      // 17 Oct 2026 (SEO audit FIX #4): /fr/ and /en/ variants for the
      // /voitures landing pages (Arabic default stays unprefixed).
      modelUrls = qualifyingModelUrls(cars, MIN_LISTINGS).flatMap((path) => [
        { url: `${BASE}${path}`, changeFrequency: 'weekly' as const, priority: 0.7 },
        { url: `${BASE}/fr${path}`, changeFrequency: 'weekly' as const, priority: 0.7 },
        { url: `${BASE}/en${path}`, changeFrequency: 'weekly' as const, priority: 0.7 },
      ]);
      wilayaUrls = qualifyingWilayaUrls(cars, WILAYA_MIN_LISTINGS).flatMap((path) => [
        { url: `${BASE}${path}`, changeFrequency: 'weekly' as const, priority: 0.7 },
        { url: `${BASE}/fr${path}`, changeFrequency: 'weekly' as const, priority: 0.7 },
        { url: `${BASE}/en${path}`, changeFrequency: 'weekly' as const, priority: 0.7 },
      ]);
    } catch {
      // Firestore unreachable for the counts — skip both
    }
    return [...staticRoutes, ...listingUrls, ...modelUrls, ...wilayaUrls];
  } catch {
    // Firestore unreachable — return static routes only
    return staticRoutes;
  }
}
