// Cars-per-wilaya SEO landing page — English version (/en/voitures/wilaya/<slug>).
//
// Same pattern as the French version: English content with the SAME Arabic
// canonical URL. Cached briefly so a stale EN render can't linger.

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
  // AF-1 (Round 7, 18 Oct 2026) + BZ-D1 (Round 23, 18 Oct 2026):
  // non-canonical slug aliases 301-redirect to the canonical wilaya slug
  // instead of 404ing. Locale prefix preserved.
  const SLUG_ALIASES: Record<string, string> = {
    alger: 'algiers',
  };
  const alias = SLUG_ALIASES[slug];
  if (alias) {
    return Response.redirect(new URL(`/en/voitures/wilaya/${alias}`, _req.url), 301);
  }
  const wilaya = WILAYA_BY_SLUG[slug];
  if (!wilaya) {
    return new Response(notFoundPage('wilaya', 'en'), {
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
    const items0 = filterWilayaItems(listings, wilaya.code, 'en');
    const items = await evictInvisibleIds(items0);
    const evictedCards = items0.length - items.length;
    let total = 0;
    for (const l of listings) {
      if (l.categoryId !== 'cars') continue;
      if (l.status !== 'available' || l.hidden === true) continue;
      if (Number(l.wilayaCode) === wilaya.code) total++;
    }
    total = Math.max(0, total - evictedCards);
    if (total < WILAYA_MIN_LISTINGS) {
      return new Response(notFoundPage('thin', 'en'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    const popular = popularWilayas(listings, wilaya.code, 6);
    const html = buildWilayaPage(wilaya, items, total, popular, 'en');
    return new Response(html, {
      status: 200,
      headers: {
        ...HTML_HEADERS,
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (e) {
    console.error('wilaya page (en) failed:', e instanceof Error ? e.message : e);
    return new Response('temporarily unavailable', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
