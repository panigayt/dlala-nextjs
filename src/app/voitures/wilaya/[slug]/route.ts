// Cars-per-wilaya SEO landing page — /voitures/wilaya/<slug> (Arabic, SEO canonical).
//
// Mirrors /voitures/modeles/<slug>: same thin-content guard (404 when
// < WILAYA_MIN_LISTINGS), same cache policy, canonical always Arabic.

import {
  WILAYA_BY_SLUG,
  WILAYA_MIN_LISTINGS,
  buildWilayaPage,
  notFoundPage,
  fetchAvailableCars,
  filterWilayaItems,
  popularWilayas,
} from '@/lib/wilaya-pages';
import { evictInvisibleIds } from '@/lib/firestore';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  // AF-1 (Round 7, 18 Oct 2026): non-canonical slug aliases 301-redirect
  // to the canonical wilaya slug instead of 404ing.
  const SLUG_ALIASES: Record<string, string> = {
    alger: 'algiers',
  };
  const alias = SLUG_ALIASES[slug];
  if (alias) {
    return Response.redirect(new URL(`/voitures/wilaya/${alias}`, _req.url), 301);
  }
  const wilaya = WILAYA_BY_SLUG[slug];
  if (!wilaya) {
    return new Response(notFoundPage('wilaya'), {
      status: 404,
      headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
    });
  }
  try {
    const listings = await fetchAvailableCars();
    // (Live probe below runs per render — NOT inside the 'use cache'
    // fetch above, whose window would freeze the eviction.)
    // R27-1 REWORK: probe the RENDERED cards for live visibility (the
    // v1 overlay query always 403s — see evictInvisibleIds). The
    // window total is adjusted by the evicted cards found here; flips
    // outside the newest 12 cards still inflate the meta total
    // slightly (stated residual — cards themselves are exact).
    const items0 = filterWilayaItems(listings, wilaya.code);
    const items = await evictInvisibleIds(items0);
    const evictedCards = items0.length - items.length;
    // Total count for the meta description (all live cars in this wilaya).
    let total = 0;
    for (const l of listings) {
      if (l.categoryId !== 'cars') continue;
      if (l.status !== 'available' || l.hidden === true) continue;
      if (Number(l.wilayaCode) === wilaya.code) total++;
    }
    total = Math.max(0, total - evictedCards);
    if (total < WILAYA_MIN_LISTINGS) {
      // Thin-content guard parity with model pages.
      return new Response(notFoundPage('thin'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    const popular = popularWilayas(listings, wilaya.code, 6);
    const html = buildWilayaPage(wilaya, items, total, popular, 'ar');
    return new Response(html, {
      status: 200,
      headers: {
        ...HTML_HEADERS,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (e) {
    console.error('wilaya page failed:', e instanceof Error ? e.message : e);
    return new Response('temporarily unavailable', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
