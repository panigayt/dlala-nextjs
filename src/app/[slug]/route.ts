import {
  findCategoryBySlug,
  filterCategoryItems,
  buildCategoryPage,
  notFoundPage,
  fetchAvailableListings,
  CATEGORY_MIN_LISTINGS,
  categoryCount,
  categorySubLinks,
} from '@/lib/category-pages';
import {
  fetchSoldFlipsSince,
  newestCreatedAtIso,
  evictSoldIds,
} from '@/lib/firestore';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

// Category SEO landing page — /{fr-slug} (Arabic, SEO canonical).
// Same template as /voitures/wilaya/<slug> (Zak 16 Oct 2026).
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const cat = findCategoryBySlug(slug);
  if (!cat) {
    return new Response(notFoundPage('category'), {
      status: 404,
      headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
    });
  }
  try {
    // CM-1 fix (Round 30): filter by category server-side so the fetch
    // window can't starve non-car categories.
    const listings = await fetchAvailableListings(cat.id);
    // R27-1: evict sold-since-compute snapshot docs (live overlay, per
    // render — NOT inside the 'use cache' fetch above, whose days window
    // would freeze the eviction).
    const flips = await fetchSoldFlipsSince(newestCreatedAtIso(listings));
    const live = evictSoldIds(listings, flips);
    const items = filterCategoryItems(live, cat.id);
    let total = 0;
    for (const l of live) {
      const f = l as unknown as Record<string, unknown>;
      if (String(f.categoryId) !== cat.id) continue;
      if (f.status !== 'available' || f.hidden === true) continue;
      total++;
    }
    if (total < CATEGORY_MIN_LISTINGS) {
      return new Response(notFoundPage('thin'), {
        status: 404,
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
      });
    }
    // R53 Team B (18 Oct 2026): the 500-doc fetch window capped the count
    // shown in title/description (live "500" vs 1,287 real cars). Use a
    // server-side aggregation for the displayed total (single-category
    // helper — independent cache entry from the sitemap batch helper);
    // the thin-content guard keeps using the visible window count.
    const aggTotal = await categoryCount(cat.id).catch(() => 0);
    // The snapshot aggregation counts sold-since-compute docs too; subtract
    // this category's flips (clamped; a create-then-sell inside one cycle
    // can leave ±1 — strictly smaller than today's error of +N sold).
    const soldInCat = flips
      ? [...flips.values()].filter((fl) => fl.categoryId === cat.id).length
      : 0;
    const displayTotal =
      aggTotal > 0 ? Math.max(0, aggTotal - soldInCat) : total;
    // R53 Team B (18 Oct 2026): internal-link fix — the category hub
    // now cross-links its model/wilaya sub-landing pages (cars only).
    const sub = categorySubLinks(live, 'ar');
    const html = buildCategoryPage(cat, items, displayTotal, 'ar', sub);
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
