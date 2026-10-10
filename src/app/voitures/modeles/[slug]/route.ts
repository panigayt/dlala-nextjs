// Car-model SEO landing page — /voitures/modeles/<slug> (Arabic, SEO canonical).
//
// Verbatim parity with the production seoCategories Cloud Function: the same
// serving filter, the same thin-content guard (404 when < MIN_LISTINGS), the
// same rendered HTML document (returned as-is — these pages must be
// byte-faithful to the CF's SSR for indexability). French visitors use
// /fr/voitures/modeles/<slug> (getLang /fr/ prefix parity); the canonical
// link always points at this Arabic URL (verbatim CF behavior).

import {
  MODEL_BY_SLUG,
  MIN_LISTINGS,
  buildModelPage,
  notFoundPage,
  fetchAvailableCars,
  filterModelItems,
} from '@/lib/model-pages';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const model = MODEL_BY_SLUG[slug];
  if (!model) {
    // parsePath 'cat' error parity: unknown model slug → 404.
    return new Response(notFoundPage('cat'), {
      status: 404,
      headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
    });
  }
  try {
    const listings = await fetchAvailableCars();
    const items = filterModelItems(listings, model);
    if (items.length < MIN_LISTINGS) {
      // Thin-content guard parity: Google penalizes thin pages; the CF 404s.
      return new Response(notFoundPage('thin'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    const html = buildModelPage(model, items, 'ar');
    return new Response(html, {
      status: 200,
      headers: {
        ...HTML_HEADERS,
        // CF parity: Arabic (SEO canonical) keeps the long cache.
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (e) {
    // CF parity: on failure the function 500s with a plain-text body.
    console.error('model page failed:', e instanceof Error ? e.message : e);
    return new Response('temporarily unavailable', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
