// Cars-per-wilaya SEO landing pages —
//   /voitures/wilaya/<slug>      (Arabic, SEO canonical)
//   /fr/voitures/wilaya/<slug>   (French)
//   /en/voitures/wilaya/<slug>   (English)
//
// Mirrors the /voitures/modeles/<slug> pattern (src/lib/model-pages.ts):
// raw-HTML route handlers, zero client JS, Firestore REST fetch with
// 'use cache' + cacheLife('hours') shared with the model pages.
// Thin-content guard: 404 when < MIN_LISTINGS (same as model pages).
// Titles are Leboncoin-style clean — NO price in <title>; the meta
// description carries count + sample prices (the click-motivator).

import { cacheLife } from 'next/cache';
import { SITE } from './seo';
import { WILAYAS } from './wilayas';
import {
  escHtml,
  titleOf,
  fmtPrice,
  cardPhoto,
  cardHtml,
  ctaTopHtml,
  notFoundPage,
  fetchAvailableCars,
  type ModelCardItem,
  type ModelListingSummary,
} from './model-pages';

export { notFoundPage, fetchAvailableCars };

// ---------------------------------------------------------------------------
// Wilaya registry + slugs
// ---------------------------------------------------------------------------

export interface WilayaInfo {
  code: number;
  ar: string;
  fr: string;
  en: string;
  slug: string;
}

function toSlug(en: string): string {
  return en
    .replace(/'/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const WILAYAS_INFO: WilayaInfo[] = WILAYAS.map((w) => ({
  code: w.code,
  ar: w.ar,
  fr: w.fr,
  en: w.en,
  slug: toSlug(w.en),
}));

export const WILAYA_BY_SLUG: Record<string, WilayaInfo> = Object.fromEntries(
  WILAYAS_INFO.map((w) => [w.slug, w]),
);

// 15 Oct 2026: legacy Google-indexed URLs use different slug conventions
// (e.g. /voitures/m-sila vs our /voitures/wilaya/msila). Tolerant lookup:
// exact match first, then hyphen-stripped (verified zero collisions across
// all 69 wilayas), so old variants 301 to the canonical page.
const WILAYA_BY_STRIPPED_SLUG: Record<string, WilayaInfo> = Object.fromEntries(
  WILAYAS_INFO.map((w) => [w.slug.replace(/-/g, ''), w]),
);

export function findWilayaByLegacySlug(raw: string): WilayaInfo | undefined {
  let s = String(raw || '').toLowerCase();
  // 14 Oct 2026 audit R27: legacy French-name alias (Alger → algiers).
  if (s === 'alger') s = 'algiers';
  return WILAYA_BY_SLUG[s] || WILAYA_BY_STRIPPED_SLUG[s.replace(/-/g, '')];
}

export function wilayaUrl(slug: string): string {
  return `${SITE}/voitures/wilaya/${slug}`;
}

export function wilayaDisplayName(w: WilayaInfo, lang: string): string {
  if (lang === 'fr') return w.fr;
  if (lang === 'en') return w.en;
  return w.ar;
}

export const WILAYA_MIN_LISTINGS = 3; // thin-content guard (model-pages parity)
export const WILAYA_MAX_CARDS = 12;

// ---------------------------------------------------------------------------
// Serving filter: cars in one wilaya, newest first (fetchAvailableCars is
// already orderBy createdAt DESC)
// ---------------------------------------------------------------------------

export interface WilayaCardItem extends ModelCardItem {
  rawPrice: number;
}

export function filterWilayaItems(
  listings: ModelListingSummary[],
  code: number,
  lang: string = 'ar',
): WilayaCardItem[] {
  const items: WilayaCardItem[] = [];
  for (const f0 of listings) {
    if (items.length >= WILAYA_MAX_CARDS) break;
    const f = f0 as unknown as Record<string, unknown>;
    if (f.hidden === true) continue;
    if (Number(f.wilayaCode) !== code) continue;
    const photo = cardPhoto(f);
    const rawPrice = Number(f.price);
    items.push({
      id: String(f.id || ''),
      title: titleOf(f.title) || String(f.id || ''),
      price: fmtPrice(f.price, lang),
      wilayaCode: code,
      photo,
      rawPrice: Number.isFinite(rawPrice) ? rawPrice : 0,
      negotiable: f.negotiable === true, // R71 (18 Oct 2026): Zak's FINAL rule
    });
  }
  return items;
}

// Sitemap qualifying rule: wilayas with >= minCount live cars.
export function qualifyingWilayaUrls(
  listings: ModelListingSummary[],
  minCount: number,
): string[] {
  const counts: Record<number, number> = Object.create(null);
  for (const l of listings) {
    if (l.categoryId !== 'cars') continue;
    if (l.status !== 'available' || l.hidden === true) continue;
    const code = Number(l.wilayaCode) || 0;
    if (code > 0) counts[code] = (counts[code] || 0) + 1;
  }
  const byCode: Record<number, WilayaInfo> = Object.fromEntries(
    WILAYAS_INFO.map((w) => [w.code, w]),
  );
  return Object.keys(counts)
    .map(Number)
    .filter((code) => counts[code] >= minCount && byCode[code])
    .sort((a, b) => a - b)
    .map((code) => `/voitures/wilaya/${byCode[code].slug}`);
}

// Top wilayas by live car count (for internal "popular wilayas" links).
export function popularWilayas(
  listings: ModelListingSummary[],
  excludeCode: number,
  limit: number,
): WilayaInfo[] {
  const counts: Record<number, number> = Object.create(null);
  for (const l of listings) {
    if (l.categoryId !== 'cars') continue;
    if (l.status !== 'available' || l.hidden === true) continue;
    const code = Number(l.wilayaCode) || 0;
    if (code > 0 && code !== excludeCode) counts[code] = (counts[code] || 0) + 1;
  }
  const byCode: Record<number, WilayaInfo> = Object.fromEntries(
    WILAYAS_INFO.map((w) => [w.code, w]),
  );
  return Object.keys(counts)
    .map(Number)
    .filter((code) => byCode[code])
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, limit)
    .map((code) => byCode[code]);
}

// ---------------------------------------------------------------------------
// Trilingual copy
// ---------------------------------------------------------------------------

type Lang = 'ar' | 'fr' | 'en';

function fmtPriceFr(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  // Zak 18 Oct 2026 (correction): ALWAYS show the literal price, even 1 DZD.
  return n.toLocaleString('fr-FR').replace(/\u202f/g, ' ') + ' DZD';
}

function fmtPriceEn(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  // Zak 18 Oct 2026 (correction): ALWAYS show the literal price, even 1 DZD.
  return n.toLocaleString('en-US') + ' DZD';
}

function sampleLine(it: WilayaCardItem, lang: Lang): string {
  const price =
    lang === 'fr' ? fmtPriceFr(it.rawPrice) : lang === 'en' ? fmtPriceEn(it.rawPrice) : it.price;
  return price ? `${it.title} (${price})` : it.title;
}

// 18 Oct 2026 (audit R41 WD-1): wilaya 16's Arabic registry name (الجزائر)
// equals the country's name, so the AR title template rendered byte-identical
// to the national /voitures page title. Disambiguate Algiers in all 3
// locales — other wilayas keep their Zak-approved indexed titles unchanged.
function wilayaTitleName(w: WilayaInfo, lang: Lang): string {
  if (w.code === 16) {
    if (lang === 'fr') return "la wilaya d'Alger";
    if (lang === 'en') return 'Algiers Province';
    return 'ولاية الجزائر';
  }
  return wilayaDisplayName(w, lang);
}

function pageTitle(w: WilayaInfo, lang: Lang): string {
  const name = wilayaTitleName(w, lang);
  if (lang === 'fr') return `Voitures à vendre à ${name} - DLALA`;
  if (lang === 'en') return `Cars for sale in ${name} - DLALA`;
  return `سيارات للبيع في ${name} - دلالة`;
}

function pageDescription(w: WilayaInfo, items: WilayaCardItem[], total: number, lang: Lang): string {
  const name = wilayaTitleName(w, lang);
  const samples = items.slice(0, 3).map((it) => sampleLine(it, lang)).join(lang === 'ar' ? '، ' : ', ');
  // 17 Oct 2026 (SEO audit FIX #5): keep the template lean — taglines
  // shortened to a single brand word so even 3 samples rarely exceed
  // 160 chars.
  const d =
    lang === 'fr'
      ? `${total} voitures à vendre à ${name} : ${samples} — DLALA.`
      : lang === 'en'
        ? `${total} cars for sale in ${name}: ${samples} — DLALA.`
        : `${total} سيارة للبيع في ${name}: ${samples} — دلالة.`;
  // 17 Oct 2026 (SEO audit FIX #5): hard cap — sample titles are
  // unbounded, so guarantee <160 chars (Google truncates ~155-160).
  if (d.length > 160) return d.slice(0, 157).trimEnd() + '…';
  return d;
}


// ---------------------------------------------------------------------------
// Page builder
// ---------------------------------------------------------------------------

export function buildWilayaPage(
  w: WilayaInfo,
  items: WilayaCardItem[],
  total: number,
  popular: WilayaInfo[],
  lang: Lang,
): string {
  const isAr = lang === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const name = wilayaDisplayName(w, lang);
  const title = pageTitle(w, lang);
  const description = pageDescription(w, items, total, lang);
  const url = wilayaUrl(w.slug);
  // Self-referencing canonical per language (14 Oct 2026 audit R5):
  // FR/EN pages must NOT canonicalize to the AR URL.
  const canonicalUrl =
    lang === 'fr'
      ? `${SITE}/fr/voitures/wilaya/${w.slug}`
      : lang === 'en'
        ? `${SITE}/en/voitures/wilaya/${w.slug}`
        : url;
  const cards = items.map((it, i) => cardHtml(it, i + 1, lang)).join('\n');

  // JSON-LD: ItemList with Offer per item (price rich data), BreadcrumbList.
  const listItems = items.map((it, i) => {
    const item: Record<string, unknown> = {
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Car',
        name: it.title,
        url: `${SITE}/listing/${encodeURIComponent(it.id)}`,
      },
    };
    // 16 Oct 2026: mirror listing-page rule — 1 DZD is the negotiable
    // convention, never emit as a real price (Google rich-snippet flag).
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
          { '@type': 'ListItem', position: 2, name: lang === 'fr' ? 'Voitures' : lang === 'en' ? 'Cars' : 'سيارات', item: `${SITE}/voitures` },
          { '@type': 'ListItem', position: 3, name, item: url },
        ],
      },
    ],
  };

  // "View all listings" button — links to the main site homepage (Zak 14 Oct 2026).
  // No numbers on the button (Zak 14 Oct 2026).
  // NOTE (18 Oct 2026, audit R41 WD-2): wilaya pages intentionally carry NO FAQ
  // section — Zak explicitly ordered its removal on 14 Oct 2026 (final mockup
  // approval). Do NOT re-add without his order.
  const viewAllBtn = (l: Lang): string =>
    l === 'fr' ? 'Voir toutes les annonces' : l === 'en' ? 'View all listings' : 'عرض كل الإعلانات';

  const homeLabel = lang === 'fr' ? 'Accueil' : lang === 'en' ? 'Home' : 'الرئيسية';
  const carsLabel = lang === 'fr' ? 'Voitures' : lang === 'en' ? 'Cars' : 'سيارات';
  const h1 = isAr ? `سيارات للبيع في ${wilayaTitleName(w, lang)}` : lang === 'fr' ? `Voitures à vendre à ${wilayaTitleName(w, lang)}` : `Cars for sale in ${wilayaTitleName(w, lang)}`;
  // Zak 14 Oct 2026: keep ONLY this single intro sentence (no counts, no model lists).
  const intro =
    lang === 'fr'
      ? `Parcourez les dernières annonces de voitures d'occasion et neuves dans la wilaya de ${escHtml(name)} sur DLALA.`
      : lang === 'en'
        ? `Browse the latest used and new car listings in the wilaya of ${escHtml(name)} on DLALA.`
        : `تصفح أحدث إعلانات السيارات المستعملة والجديدة في ولاية ${escHtml(name)} على دلالة.`;  const countLine =
    lang === 'fr'
      ? `<strong>${total}</strong> annonces de voitures à ${escHtml(name)}.`
      : lang === 'en'
        ? `<strong>${total}</strong> car listings in ${escHtml(name)}.`
        : `<strong>${total}</strong> إعلان سيارة في ${escHtml(name)}.`;


  const popHead = lang === 'fr' ? 'Voitures dans d\u2019autres wilayas' : lang === 'en' ? 'Cars in other wilayas' : 'سيارات في ولايات أخرى';
  const popLinks = popular
    .map((p) => `<a href="${lang === 'ar' ? wilayaUrl(p.slug) : `${SITE}/${lang}/voitures/wilaya/${p.slug}`}">${escHtml(wilayaDisplayName(p, lang))}</a>`)
    .join(' · ');

  const langSwitch =
    lang === 'ar'
      ? `<a href="${SITE}/fr/voitures/wilaya/${w.slug}">Français</a> · <a href="${SITE}/en/voitures/wilaya/${w.slug}">English</a>`
      : lang === 'fr'
        ? `<a href="${url}">العربية</a> · <a href="${SITE}/en/voitures/wilaya/${w.slug}">English</a>`
        : `<a href="${url}">العربية</a> · <a href="${SITE}/fr/voitures/wilaya/${w.slug}">Français</a>`;

  const hreflangs = `<link rel="alternate" hreflang="ar" href="${escHtml(url)}">\n<link rel="alternate" hreflang="fr" href="${escHtml(`${SITE}/fr/voitures/wilaya/${w.slug}`)}">\n<link rel="alternate" hreflang="en" href="${escHtml(`${SITE}/en/voitures/wilaya/${w.slug}`)}">\n<link rel="alternate" hreflang="x-default" href="${escHtml(url)}">`;

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
.negbadge{display:inline-block;font-size:11px;font-weight:400;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:999px;padding:2px 8px;margin-inline-start:6px;white-space:nowrap;vertical-align:middle}
.card .wilaya{font-size:12px;color:#666;margin-top:4px}
.noimg{height:160px;display:flex;align-items:center;justify-content:center;background:#0d7a4f;color:#fff;font-weight:800}
.cta-top{text-align:center;margin:18px 0;background:#eef7f1;border:1px solid rgba(13,122,79,.25);border-radius:14px;padding:18px 16px;box-shadow:0 2px 8px rgba(13,122,79,.08)}
.cta-top .h{display:block;font-weight:800;font-size:16px;margin-bottom:12px;color:#0a3d28;white-space:nowrap}
.cta-top .b{display:inline-block;background:#0d7a4f;color:#fff!important;font-weight:700;font-size:15.5px;padding:12px 34px;border-radius:999px;text-decoration:none;box-shadow:0 4px 14px rgba(13,122,79,.35)}
.cta{display:inline-block;background:#0d7a4f;color:#fff!important;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;margin:16px 0;font-size:16px}
.teaser{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:14px 16px;margin:18px 0}
nav.breadcrumb{font-size:13px;color:#666;margin-bottom:8px}
nav.breadcrumb a{color:#0d7a4f}
.pop{margin:18px 0;font-size:14px}
</style>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
<nav class="breadcrumb" aria-label="breadcrumb"><a href="${SITE}/">${homeLabel}</a> ‹ <a href="${SITE}/voitures">${carsLabel}</a> ‹ ${escHtml(name)}</nav>
<div style="margin:8px 0;font-size:13px">${langSwitch}</div>
<h1>${escHtml(h1)}</h1>
<p>${intro}</p>
${ctaTopHtml(lang)}
<div class="grid">${cards}</div>
<p style="text-align:center"><a class="cta" href="${SITE}/">${escHtml(viewAllBtn(lang))}</a></p>
<div class="pop"><strong>${escHtml(popHead)}:</strong> ${popLinks}</div>
</body>
</html>`;
}

// Cached per-wilaya count (for sitemap + meta descriptions).
export async function wilayaCarCounts(): Promise<Record<number, number>> {
  'use cache';
  cacheLife('hours');
  const listings = await fetchAvailableCars();
  const counts: Record<number, number> = Object.create(null);
  for (const l of listings) {
    if (l.categoryId !== 'cars') continue;
    if (l.status !== 'available' || l.hidden === true) continue;
    const code = Number(l.wilayaCode) || 0;
    if (code > 0) counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}
