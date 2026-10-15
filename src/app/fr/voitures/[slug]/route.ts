import { NextResponse } from 'next/server';

import { findWilayaByLegacySlug } from '@/lib/wilaya-pages';

// Legacy redirect (FR): Google indexed /fr/voitures/{wilaya-slug}.
// 301 → /fr/voitures/wilaya/{slug}. Non-wilaya slugs → 404.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  // 14 Oct 2026 audit R27: legacy French-name alias (Alger → algiers).
  const slugLower = String(slug || '').toLowerCase();
  const aliased = slugLower === 'alger' ? 'algiers' : slugLower;
  const w = findWilayaByLegacySlug(slug);
  if (!w) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(`https://www.dzdlala.com/fr/voitures/wilaya/${w.slug}`, 301);
}
