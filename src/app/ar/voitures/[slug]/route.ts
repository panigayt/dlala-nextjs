import { NextResponse } from 'next/server';

import { findWilayaByLegacySlug } from '@/lib/wilaya-pages';

// Legacy redirect (AR): Google indexed /ar/voitures/{wilaya-slug}.
// 301 → /voitures/wilaya/{slug} (Arabic is the default locale, no prefix).
// Non-wilaya slugs → 404.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const w = findWilayaByLegacySlug(slug);
  if (!w) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(`https://www.dzdlala.com/voitures/wilaya/${w.slug}`, 301);
}
