import { NextResponse } from 'next/server';

import { findWilayaByLegacySlug } from '@/lib/wilaya-pages';
import { localized404Html } from '@/proxy-404';

// Legacy redirect: Google indexed /voitures/{wilaya-slug} (old structure).
// 301 → /voitures/wilaya/{slug} (Zak 14 Oct 2026 — clicking Google results
// must not 404). Only wilaya slugs redirect; anything else → branded 404.
// R15b BC-2: was bare text/plain "Not found" — now the trilingual page.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const w = findWilayaByLegacySlug(slug);
  if (!w)
    return new NextResponse(localized404Html('ar'), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  return NextResponse.redirect(`https://www.dzdlala.com/voitures/wilaya/${w.slug}`, 301);
}
