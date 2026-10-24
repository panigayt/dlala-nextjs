// Car-model SEO landing page — French version (/fr/voitures/modeles/<slug>).
//
// Production parity: the seoCategories function serves ?lang=fr (and the
// /fr/ prefix) as a human convenience — French content with a self-referencing
// French canonical URL (14 Oct 2026 audit R5 — verified in
// src/lib/model-pages.ts buildModelPage, line ~183). Cached briefly so a
// stale FR render can't linger (verbatim CF cache policy).

import {
  MODEL_BY_SLUG,
  MIN_LISTINGS,
  buildModelPage,
  notFoundPage,
  fetchAvailableCars,
  filterModelItems,
} from '@/lib/model-pages';
import {
  fetchSoldFlipsSince,
  newestCreatedAtIso,
  evictSoldIds,
} from '@/lib/firestore';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const model = MODEL_BY_SLUG[slug];
  if (!model) {
    return new Response(notFoundPage('cat', 'fr'), {
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
    const items = filterModelItems(live, model, 'fr');
    if (items.length < MIN_LISTINGS) {
      return new Response(notFoundPage('thin', 'fr'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    const html = buildModelPage(model, items, 'fr');
    return new Response(html, {
      status: 200,
      headers: {
        ...HTML_HEADERS,
        // CF parity: French is cached separately but briefly.
        'Cache-Control': 'public, max-age=600, s-maxage=600',
      },
    });
  } catch (e) {
    console.error('model page failed:', e instanceof Error ? e.message : e);
    return new Response('temporarily unavailable', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
