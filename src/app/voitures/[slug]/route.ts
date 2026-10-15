import { NextResponse } from 'next/server';

import { findWilayaByLegacySlug } from '@/lib/wilaya-pages';

// Legacy redirect: Google indexed /voitures/{wilaya-slug} (old structure).
// 301 → /voitures/wilaya/{slug} (Zak 14 Oct 2026 — clicking Google results
// must not 404). Only wilaya slugs redirect; anything else → 404.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const w = findWilayaByLegacySlug(slug);
  if (!w) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(`https://www.dzdlala.com/voitures/wilaya/${w.slug}`, 301);
}
