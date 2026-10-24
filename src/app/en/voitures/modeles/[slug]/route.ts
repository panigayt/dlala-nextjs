// Car-model SEO landing page — English version (/en/voitures/modeles/<slug>).
//
// Production parity: same treatment as the French route
// (src/app/fr/voitures/modeles/[slug]/route.ts) — English content with a
// self-referencing English canonical URL (14 Oct 2026 audit R5), full
// bidirectional hreflang cluster ar/fr/en/x-default (17 Oct 2026 SEO audit
// FIX #8, wilaya-pages.ts pattern). Cached briefly so a stale EN render
// can't linger (verbatim CF cache policy).

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
    return new Response(notFoundPage('cat', 'en'), {
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
    const items = filterModelItems(live, model, 'en');
    if (items.length < MIN_LISTINGS) {
      return new Response(notFoundPage('thin', 'en'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    const html = buildModelPage(model, items, 'en');
    return new Response(html, {
      status: 200,
      headers: {
        ...HTML_HEADERS,
        // CF parity: English is cached separately but briefly.
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
