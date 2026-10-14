import { NextResponse } from 'next/server';

import { WILAYA_BY_SLUG } from '@/lib/wilaya-pages';

// Legacy redirect (EN): Google indexed /en/voitures/{wilaya-slug}.
// 301 → /en/voitures/wilaya/{slug}. Non-wilaya slugs → 404.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const w = WILAYA_BY_SLUG[String(slug || '').toLowerCase()];
  if (!w) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(`https://dzdlala.com/en/voitures/wilaya/${w.slug}`, 301);
}
