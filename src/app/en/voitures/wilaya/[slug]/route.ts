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
import {
  fetchSoldFlipsSince,
  newestCreatedAtIso,
  evictSoldIds,
} from '@/lib/firestore';

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
    // R27-1: evict sold-since-compute snapshot docs (live overlay, per
    // render — NOT inside the 'use cache' fetch above).
    const flips = await fetchSoldFlipsSince(newestCreatedAtIso(listings));
    const live = evictSoldIds(listings, flips);
    const items = filterWilayaItems(live, wilaya.code, 'en');
    let total = 0;
    for (const l of live) {
      if (l.categoryId !== 'cars') continue;
      if (l.status !== 'available' || l.hidden === true) continue;
      if (Number(l.wilayaCode) === wilaya.code) total++;
    }
    if (total < WILAYA_MIN_LISTINGS) {
      return new Response(notFoundPage('thin', 'en'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    const popular = popularWilayas(live, wilaya.code, 6);
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
