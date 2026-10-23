import { notFoundPage } from '@/lib/category-pages';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

// R23-2 fix (24 Oct 2026): this route used to render the full category
// landing page under /ar/{fr-slug} (200, duplicate of the unprefixed
// canonical) for the four category slugs — while every other /ar/*
// route answers 404 (Arabic is the default locale at UNPREFIXED
// canonicals; /ar/* is never linked or indexed). The route now mirrors
// the established /ar discipline exactly: the same 404 page this route
// already served for non-category slugs, for every slug. The canonical
// category pages live at /{fr-slug} (src/app/[slug]/route.ts) and are
// untouched; the legacy /ar/voitures/{wilaya} 301s live in
// src/app/ar/voitures/[slug]/route.ts and are untouched.
export async function GET() {
  return new Response(notFoundPage('category'), {
    status: 404,
    headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=300' },
  });
}
