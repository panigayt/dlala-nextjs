// Cars-per-wilaya SEO landing page — French version (/fr/voitures/wilaya/<slug>).
//
// Production parity (model pages): French content with the SAME Arabic
// canonical URL. Cached briefly so a stale FR render can't linger.

import {
  WILAYA_BY_SLUG,
  WILAYA_MIN_LISTINGS,
  buildWilayaPage,
  notFoundPage,
  fetchAvailableCars,
  filterWilayaItems,
  popularWilayas,
} from '@/lib/wilaya-pages';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const wilaya = WILAYA_BY_SLUG[slug];
  if (!wilaya) {
    return new Response(notFoundPage('wilaya', 'fr'), {
      status: 404,
      headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
    });
  }
  try {
    const listings = await fetchAvailableCars();
    const items = filterWilayaItems(listings, wilaya.code, 'fr');
    let total = 0;
    for (const l of listings) {
      if (l.categoryId !== 'cars') continue;
      if (l.status !== 'available' || l.hidden === true) continue;
      if (Number(l.wilayaCode) === wilaya.code) total++;
    }
    if (total < WILAYA_MIN_LISTINGS) {
      return new Response(notFoundPage('thin', 'fr'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    const popular = popularWilayas(listings, wilaya.code, 6);
    const html = buildWilayaPage(wilaya, items, total, popular, 'fr');
    return new Response(html, {
      status: 200,
      headers: {
        ...HTML_HEADERS,
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (e) {
    console.error('wilaya page (fr) failed:', e instanceof Error ? e.message : e);
    return new Response('temporarily unavailable', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
