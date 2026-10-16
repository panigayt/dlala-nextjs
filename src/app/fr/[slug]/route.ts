import { NextResponse } from 'next/server';

import { findCategoryByLegacySlug } from '@/lib/legacy-categories';

// Legacy redirect (FR): Google indexed /fr/{category-slug}.
// 301 → /fr/search?cat={id}. Only known category slugs; else 404.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const catId = findCategoryByLegacySlug(slug);
  if (!catId) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(`https://www.dzdlala.com/fr/search?cat=${catId}`, 301);
}
