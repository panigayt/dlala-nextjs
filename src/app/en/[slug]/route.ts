import {
  findCategoryBySlug,
  filterCategoryItems,
  buildCategoryPage,
  notFoundPage,
  fetchListings,
  CATEGORY_MIN_LISTINGS,
} from '@/lib/category-pages';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

// Category SEO landing page (EN) — /en/{fr-slug}.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const cat = findCategoryBySlug(slug);
  if (!cat) {
    return new Response(notFoundPage('category', 'en'), {
      status: 404,
      headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
    });
  }
  try {
    const listings = await fetchListings();
    const items = filterCategoryItems(listings, cat.id, 'en');
    let total = 0;
    for (const l of listings) {
      const f = l as unknown as Record<string, unknown>;
      if (String(f.categoryId) !== cat.id) continue;
      if (f.status !== 'available' || f.hidden === true) continue;
      total++;
    }
    if (total < CATEGORY_MIN_LISTINGS) {
      return new Response(notFoundPage('thin', 'en'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    const html = buildCategoryPage(cat, items, total, 'en');
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
