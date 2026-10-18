// Category SEO landing pages —
//   /{fr-slug}        (Arabic, SEO canonical — the URL Google indexed)
//   /fr/{fr-slug}     (French)
//   /en/{fr-slug}     (English)
//
// Same template and design as /voitures/wilaya/<slug> (Zak 16 Oct 2026):
// raw-HTML route handlers, zero client JS, title + CTA + cards,
// thin-content guard (404 when < MIN_LISTINGS), JSON-LD ItemList.
// Titles are Leboncoin-style clean — NO price in <title>.

import { cacheLife } from 'next/cache';
import { SITE } from './seo';
import { CATEGORIES, type Category } from './categories';
import { FIREBASE_API_KEY, FIRESTORE_REST_BASE } from './firestore';
import {
  escHtml,
  titleOf,
  fmtPrice,
  cardPhoto,
  cardHtml,
  ctaTopHtml,
  notFoundPage,
  wilayaName,
  type ModelCardItem,
  type ModelListingSummary,
} from './model-pages';

export { notFoundPage };

// ---------------------------------------------------------------------------
// Category registry — URL slug is the French name slugified
// (telephones, voitures, immobilier...) = what Google indexed.
// ---------------------------------------------------------------------------

export function catSlugFr(c: Category): string {
  return c.fr
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const CAT_BY_SLUG: Record<string, Category> = Object.fromEntries(
  CATEGORIES.flatMap((c) => [
    [catSlugFr(c), c],
    [c.id, c], // raw id also works
  ]),
);

export function findCategoryBySlug(raw: string): Category | undefined {
  return CAT_BY_SLUG[String(raw || '').toLowerCase()];
}

export function categoryUrl(c: Category, lang: string): string {
  const slug = catSlugFr(c);
  return lang === 'ar' ? `${SITE}/${slug}` : `${SITE}/${lang}/${slug}`;
}

export function catDisplayName(c: Category, lang: string): string {
  if (lang === 'fr') return c.fr;
  if (lang === 'en') return c.en;
  return c.ar;
}

export const CATEGORY_MIN_LISTINGS = 3;
export const CATEGORY_MAX_CARDS = 12;

// ---------------------------------------------------------------------------
// Serving filter: available listings in one category, newest first
// ---------------------------------------------------------------------------

export interface CategoryCardItem extends ModelCardItem {
  rawPrice: number;
}

export function filterCategoryItems(
  listings: ModelListingSummary[],
  categoryId: string,
  lang: string = 'ar',
): CategoryCardItem[] {
  const items: CategoryCardItem[] = [];
  for (const f0 of listings) {
    if (items.length >= CATEGORY_MAX_CARDS) break;
    const f = f0 as unknown as Record<string, unknown>;
    if (f.hidden === true) continue;
    if (String(f.categoryId) !== categoryId) continue;
    const photo = cardPhoto(f);
    const rawPrice = Number(f.price);
    items.push({
      id: String(f.id || ''),
      title: titleOf(f.title) || String(f.id || ''),
      price: fmtPrice(f.price, lang),
      wilayaCode: Number(f.wilayaCode) || 0,
      photo,
      rawPrice: Number.isFinite(rawPrice) ? rawPrice : 0,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Trilingual copy
// ---------------------------------------------------------------------------

type Lang = 'ar' | 'fr' | 'en';

function pageTitle(c: Category, lang: Lang): string {
  const name = catDisplayName(c, lang);
  if (lang === 'fr') return `${name} à vendre en Algérie - DLALA`;
  if (lang === 'en') return `${name} for sale in Algeria - DLALA`;
  return `${name} للبيع في الجزائر - دلالة`;
}

function pageDescription(c: Category, items: CategoryCardItem[], total: number, lang: Lang): string {
  const name = catDisplayName(c, lang);
  const samples = items
    .slice(0, 3)
    .map((it) => (it.rawPrice > 1 ? `${it.title} (${it.price})` : it.title))
    .join(lang === 'ar' ? '، ' : ', ');
  if (lang === 'fr')
    return `${total} ${name.toLowerCase()} à vendre en Algérie : ${samples}. Contact direct avec les vendeurs sur DLALA.`;
  if (lang === 'en')
    return `${total} ${name.toLowerCase()} for sale in Algeria: ${samples}. Contact sellers directly on DLALA.`;
  return `${total} ${name} للبيع في الجزائر: ${samples}. تواصل مباشر مع البائعين على دلالة.`;
}

// ---------------------------------------------------------------------------
// Page builder — same template as buildWilayaPage
// ---------------------------------------------------------------------------

export function buildCategoryPage(
  c: Category,
  items: CategoryCardItem[],
  total: number,
  lang: Lang,
): string {
  const isAr = lang === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const name = catDisplayName(c, lang);
  const title = pageTitle(c, lang);
  const description = pageDescription(c, items, total, lang);
  const canonicalUrl = categoryUrl(c, lang);

  const cards = items.map((it, i) => cardHtml(it, i + 1, lang)).join('\n');

  // R8-7 (18 Oct 2026): schema-type consistency — vehicle categories use
  // Car (matching wilaya pages), all others use Product. Was Product for
  // every category, so the same car listing emitted as Car on wilaya pages
  // but Product on category pages.
  const VEHICLE_CATS = new Set(['cars', 'moto', 'velos', 'trottinettes']);
  const itemType = VEHICLE_CATS.has(c.id) ? 'Car' : 'Product';

  const listItems = items.map((it, i) => {
    const item: Record<string, unknown> = {
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': itemType,
        name: it.title,
        url: `${SITE}/listing/${encodeURIComponent(it.id)}`,
      },
    };
    // 16 Oct 2026: 1 DZD = negotiable convention, never emit as real price.
    if (it.rawPrice > 1) {
      (item.item as Record<string, unknown>).offers = {
        '@type': 'Offer',
        price: it.rawPrice,
        priceCurrency: 'DZD',
        availability: 'https://schema.org/InStock',
      };
    }
    return item;
  });
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ItemList',
        name: title,
        url: canonicalUrl,
        numberOfItems: listItems.length,
        itemListElement: listItems,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: isAr ? 'دلالة' : 'DLALA', item: SITE },
          { '@type': 'ListItem', position: 2, name, item: canonicalUrl },
        ],
      },
    ],
  };

  const viewAllBtn = (l: Lang): string =>
    l === 'fr' ? 'Voir toutes les annonces' : l === 'en' ? 'View all listings' : 'عرض كل الإعلانات';

  const homeLabel = lang === 'fr' ? 'Accueil' : lang === 'en' ? 'Home' : 'الرئيسية';
  const h1 = isAr
    ? `${name} للبيع في الجزائر`
    : lang === 'fr'
      ? `${name} à vendre en Algérie`
      : `${name} for sale in Algeria`;
  const intro =
    lang === 'fr'
      ? `Parcourez les dernières annonces de ${name.toLowerCase()} en Algérie sur DLALA.`
      : lang === 'en'
        ? `Browse the latest ${name.toLowerCase()} listings in Algeria on DLALA.`
        : `تصفح أحدث إعلانات ${name} في الجزائر على دلالة.`;

  const langSwitch =
    lang === 'ar'
      ? `<a href="${SITE}/fr/${catSlugFr(c)}">Français</a> · <a href="${SITE}/en/${catSlugFr(c)}">English</a>`
      : lang === 'fr'
        ? `<a href="${SITE}/${catSlugFr(c)}">العربية</a> · <a href="${SITE}/en/${catSlugFr(c)}">English</a>`
        : `<a href="${SITE}/${catSlugFr(c)}">العربية</a> · <a href="${SITE}/fr/${catSlugFr(c)}">Français</a>`;

  const slug = catSlugFr(c);
  const hreflangs = `<link rel="alternate" hreflang="ar" href="${escHtml(`${SITE}/${slug}`)}">\n<link rel="alternate" hreflang="fr" href="${escHtml(`${SITE}/fr/${slug}`)}">\n<link rel="alternate" hreflang="en" href="${escHtml(`${SITE}/en/${slug}`)}">\n<link rel="alternate" hreflang="x-default" href="${escHtml(`${SITE}/${slug}`)}">`;

  // 17 Oct 2026 (SEO audit FIX #3): full OG + Twitter cards, mirroring the
  // listing-page pattern. og:image = first card photo (absolute URL),
  // site icon as fallback.
  const ogImageRaw = items.find((it) => it.photo)?.photo || `${SITE}/icon-512.png`;
  const ogImage = ogImageRaw.startsWith('http')
    ? ogImageRaw
    : `${SITE}${ogImageRaw.startsWith('/') ? '' : '/'}${ogImageRaw}`;
  const ogTags = `<meta property="og:type" content="website">\n<meta property="og:site_name" content="DLALA">\n<meta property="og:title" content="${escHtml(title)}">\n<meta property="og:description" content="${escHtml(description)}">\n<meta property="og:url" content="${escHtml(canonicalUrl)}">\n<meta property="og:image" content="${escHtml(ogImage)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${escHtml(title)}">\n<meta name="twitter:description" content="${escHtml(description)}">\n<meta name="twitter:image" content="${escHtml(ogImage)}">`;

  return `<!DOCTYPE html>
<html dir="${dir}" lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://pub-bf326f03c4774a4287a473be0a7de582.r2.dev" crossorigin>
<link rel="preconnect" href="https://firebasestorage.googleapis.com" crossorigin>
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(description)}">
<link rel="canonical" href="${escHtml(canonicalUrl)}">
${ogTags}
${hreflangs}
<style>
body{font-family:system-ui,'Segoe UI',Tahoma,Arial,sans-serif;margin:0;padding:16px;background:#f7f7f7;color:#1a1a1a;max-width:1100px;margin-inline:auto}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden}
.card img{width:100%;height:160px;object-fit:cover;display:block;background:#eee}
.card .cbody{padding:10px}
.card h3{font-size:14px;margin:0 0 6px;line-height:1.35}
.card h3 a{color:#1a1a1a;text-decoration:none}
.card .price{font-weight:800;color:#0d7a4f}
.card .wilaya{font-size:12px;color:#666;margin-top:4px}
.noimg{height:160px;display:flex;align-items:center;justify-content:center;background:#0d7a4f;color:#fff;font-weight:800}
.cta-top{text-align:center;margin:18px 0;background:#eef7f1;border:1px solid rgba(13,122,79,.25);border-radius:14px;padding:18px 16px;box-shadow:0 2px 8px rgba(13,122,79,.08)}
.cta-top .h{display:block;font-weight:800;font-size:16px;margin-bottom:12px;color:#0a3d28;white-space:nowrap}
.cta-top .b{display:inline-block;background:#0d7a4f;color:#fff!important;font-weight:700;font-size:15.5px;padding:12px 34px;border-radius:999px;text-decoration:none;box-shadow:0 4px 14px rgba(13,122,79,.35)}
.cta{display:inline-block;background:#0d7a4f;color:#fff!important;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;margin:16px 0;font-size:16px}
nav.breadcrumb{font-size:13px;color:#666;margin-bottom:8px}
nav.breadcrumb a{color:#0d7a4f}
</style>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
<nav class="breadcrumb" aria-label="breadcrumb"><a href="${SITE}/">${homeLabel}</a> ‹ ${escHtml(name)}</nav>
<div style="margin:8px 0;font-size:13px">${langSwitch}</div>
<h1>${escHtml(h1)}</h1>
<p>${intro}</p>
${ctaTopHtml(lang)}
<div class="grid">${cards}</div>
<p style="text-align:center"><a class="cta" href="${SITE}/">${escHtml(viewAllBtn(lang))}</a></p>
</body>
</html>`;
}

// Cached per-category count (for sitemap).
export async function categoryCounts(): Promise<Record<string, number>> {
  'use cache';
  cacheLife('hours');
  const listings = await fetchAvailableListings();
  const counts: Record<string, number> = Object.create(null);
  for (const l of listings) {
    const f = l as unknown as Record<string, unknown>;
    if (f.status !== 'available' || f.hidden === true) continue;
    const cat = String(f.categoryId || '');
    if (cat) counts[cat] = (counts[cat] || 0) + 1;
  }
  return counts;
}

// CM-1 (18 Oct 2026): was fetchAvailableCars() (hardcoded categoryId ==
// 'cars'), so all non-car category pages 404'd and were missing from the
// sitemap. Now fetches ALL available listings; callers filter by category.
function decodeRestValue(v: unknown): unknown {
  if (v == null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if ('stringValue' in o) return o.stringValue;
  if ('integerValue' in o) return Number(o.integerValue);
  if ('doubleValue' in o) return Number(o.doubleValue);
  if ('booleanValue' in o) return !!o.booleanValue;
  if ('nullValue' in o) return null;
  if ('timestampValue' in o) return new Date(o.timestampValue as string);
  if ('arrayValue' in o) {
    const av = o.arrayValue as { values?: unknown[] };
    return (av.values || []).map(decodeRestValue);
  }
  if ('mapValue' in o) {
    const out: Record<string, unknown> = {};
    const fs = (o.mapValue as { fields?: Record<string, unknown> }).fields || {};
    for (const k in fs) out[k] = decodeRestValue(fs[k]);
    return out;
  }
  return null;
}

export async function fetchAvailableListings(): Promise<ModelListingSummary[]> {
  'use cache';
  cacheLife('hours');
  const url = FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const fields = [
    'title', 'price', 'wilayaCode',
    'photo_thumbs', 'thumbUrls', 'photoUrls', 'photos',
    'answers', 'categoryId', 'status', 'hidden', 'createdAt',
  ];
  const structuredQuery = {
    from: [{ collectionId: 'listings' }],
    where: {
      fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'available' } },
    },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    select: { fields: fields.map((f) => ({ fieldPath: f })) },
    limit: 500,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`category-listings-rest-${res.status}`);
  const body = await res.json().catch(() => null);
  const docs = (Array.isArray(body) ? body : []).filter((r) => r.document).map((r) => r.document);
  return docs.map((d: { name: string; fields?: Record<string, unknown> }) => {
    const out: Record<string, unknown> = { id: String(d.name).split('/').pop() };
    const fs = d.fields || {};
    for (const k in fs) out[k] = decodeRestValue(fs[k]);
    return out as unknown as ModelListingSummary;
  });
}

export async function fetchListings() {
  'use cache';
  cacheLife('hours');
  return fetchAvailableListings();
}
