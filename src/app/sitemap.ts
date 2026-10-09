import type { MetadataRoute } from 'next';
import { fetchFeed } from '@/lib/firestore';

const BASE = 'https://dlala-nextjs.vercel.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: 'hourly', priority: 1 },
    { url: `${BASE}/search`, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${BASE}/wanted`, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${BASE}/announcements`, changeFrequency: 'daily', priority: 0.5 },
    { url: `${BASE}/auth`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ];

  try {
    // Latest listings for the sitemap (keeps build fast)
    const listings = await fetchFeed(100);
    const listingUrls: MetadataRoute.Sitemap = listings.map((l) => ({
      url: `${BASE}/listing/${l.id}`,
      lastModified: l.createdAt || undefined,
      changeFrequency: 'daily' as const,
      priority: 0.9,
    }));
    return [...staticRoutes, ...listingUrls];
  } catch {
    // Firestore unreachable at build time — return static routes only
    return staticRoutes;
  }
}
