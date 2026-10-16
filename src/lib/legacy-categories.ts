// Legacy category URL redirects — Google indexed old category landing pages
// like /telephones, /fr/telephones, /en/voitures, /ar/telephones.
// 301 → /search?cat={id} (locale-prefixed for fr/en).
// Only known category slugs redirect; anything else → 404.

import { CATEGORIES } from '@/lib/categories';

function frSlug(fr: string): string {
  return fr
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Map old French slugs AND raw category IDs → category ID.
const CAT_BY_SLUG: Record<string, string> = {};
for (const c of CATEGORIES) {
  CAT_BY_SLUG[frSlug(c.fr)] = c.id;
  CAT_BY_SLUG[c.id] = c.id;
}

export function findCategoryByLegacySlug(raw: string): string | undefined {
  return CAT_BY_SLUG[String(raw || '').toLowerCase()];
}
