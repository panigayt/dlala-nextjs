import {
  findCategoryBySlug,
  filterCategoryItems,
  buildCategoryPage,
  notFoundPage,
  fetchAvailableListings,
  CATEGORY_MIN_LISTINGS,
  categoryCounts,
  categorySubLinks,
} from '@/lib/category-pages';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

// Category SEO landing page (FR) — /fr/{fr-slug}.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const cat = findCategoryBySlug(slug);
  if (!cat) {
    return new Response(notFoundPage('category', 'fr'), {
      status: 404,
      headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
    });
  }
  try {
    const listings = await fetchAvailableListings(cat.id);
    const items = filterCategoryItems(listings, cat.id, 'fr');
    let total = 0;
    for (const l of listings) {
      const f = l as unknown as Record<string, unknown>;
      if (String(f.categoryId) !== cat.id) continue;
      if (f.status !== 'available' || f.hidden === true) continue;
      total++;
    }
    if (total < CATEGORY_MIN_LISTINGS) {
      return new Response(notFoundPage('thin', 'fr'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    // R53 Team B (18 Oct 2026): the 500-doc fetch window capped the count
    // shown in title/description (live "500" vs 1,287 real cars). Use the
    // server-side aggregation for the displayed total; the thin-content
    // guard keeps using the visible window count.
    const counts = await categoryCounts().catch(() => null);
    const displayTotal = counts && counts[cat.id] > 0 ? counts[cat.id] : total;
    // R53 Team B (18 Oct 2026): internal-link fix — the category hub
    // now cross-links its model/wilaya sub-landing pages (cars only).
    const sub = categorySubLinks(listings, 'fr');
    const html = buildCategoryPage(cat, items, displayTotal, 'fr', sub);
    return new Response(html, {
      status: 200,
      headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
    });
  } catch (e) {
    console.error('category page failed:', e instanceof Error ? e.message : e);
    return new Response('temporarily unavailable', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
