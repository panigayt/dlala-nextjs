// Car-model SEO landing pages — verbatim port of the production
// seoCategories Cloud Function (dlala-app/functions/seoCategories/index.js,
// 2nd gen nodejs22 europe-west3) model-page workstream (workstream 2):
//   /voitures/modeles/<slug>  (22 popular models in Algeria)
//
// The Next.js app had ZERO of these pages — production's sitemap advertises
// them (FIX-FN-018, 0.0.0.31) and they are live indexed URLs. This module is
// a byte-faithful TS port of the CF's pure functions; the serving filter
// and the sitemap qualifying rule are BOTH ported verbatim (they differ:
// serving = NAND-style filter with title fallback, sitemap = AND-style
// include rule — do not "unify" them).
//
// Data fetch reuses the Round 130 pattern (Firestore REST, 'use cache' +
// cacheLife('hours') — the Next 16 replacement for the removed `revalidate`
// segment config under cacheComponents).

import { cacheLife } from 'next/cache';
import { SITE } from './seo';
import { WILAYAS } from './wilayas';
import { FIREBASE_API_KEY, FIRESTORE_REST_BASE } from './firestore';
import { claimStatsScan, readStatsArrayDetailed } from './site-stats';

// ---------------------------------------------------------------------------
// seoCategories/index.js — helpers (verbatim logic, typed)
// ---------------------------------------------------------------------------

export function escHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function titleOf(t: unknown): string {
  // t: plain Firestore map {ar, fr, en}.
  if (!t || typeof t !== 'object') return '';
  const m = t as Record<string, unknown>;
  return String(m.ar || m.fr || m.en || '');
}

export function fmtPrice(p: unknown, lang: string = 'ar'): string {
  const n = Number(p);
  if (!Number.isFinite(n)) return '';
  // Zak 18 Oct 2026 (correction): ALWAYS show the literal price, even 1 DZD.
  // The negotiable badge is rendered separately by the UI components.
  // R8-1 (18 Oct 2026): locale-correct currency label — was hardcoded ' دج'
  // for every locale, so /fr|/en category cards showed Arabic دج.
  const label = lang === 'fr' || lang === 'en' ? 'DZD' : 'دج';
  return n.toLocaleString('en-US') + ' ' + label;
}

const WILAYA_BY_CODE: Record<number, { ar: string; fr: string; en: string }> =
  Object.fromEntries(WILAYAS.map((w) => [w.code, { ar: w.ar, fr: w.fr, en: w.en }]));

export function wilayaName(code: number, lang: string): string {
  const w = WILAYA_BY_CODE[code];
  if (!w) return '';
  if (lang === 'fr') return w.fr;
  if (lang === 'en') return w.en;
  return w.ar;
}

// ---------------------------------------------------------------------------
// seoCategories/index.js — car model registry (verbatim, 22 entries)
// ---------------------------------------------------------------------------

export interface CarModel {
  slug: string;
  brand: string;
  model: string;
  ar: string;
}

export const CAR_MODELS: CarModel[] = [
  // Renault
  { slug: 'renault-clio-4', brand: 'Renault', model: 'Clio 4', ar: 'رونو كليو 4' },
  { slug: 'renault-clio-5', brand: 'Renault', model: 'Clio 5', ar: 'رونو كليو 5' },
  { slug: 'renault-symbol', brand: 'Renault', model: 'Symbol', ar: 'رونو سامبول' },
  { slug: 'renault-logan', brand: 'Renault', model: 'Logan', ar: 'رونو لوقان' },
  { slug: 'renault-duster', brand: 'Renault', model: 'Duster', ar: 'رونو داستر' },
  { slug: 'renault-captur', brand: 'Renault', model: 'Captur', ar: 'رونو كابتير' },
  // Peugeot
  { slug: 'peugeot-208', brand: 'Peugeot', model: '208', ar: 'بيجو 208' },
  { slug: 'peugeot-301', brand: 'Peugeot', model: '301', ar: 'بيجو 301' },
  { slug: 'peugeot-308', brand: 'Peugeot', model: '308', ar: 'بيجو 308' },
  { slug: 'peugeot-2008', brand: 'Peugeot', model: '2008', ar: 'بيجو 2008' },
  // Hyundai
  { slug: 'hyundai-accent', brand: 'Hyundai', model: 'Accent', ar: 'هيونداي أكسنت' },
  { slug: 'hyundai-tucson', brand: 'Hyundai', model: 'Tucson', ar: 'هيونداي توكسون' },
  { slug: 'hyundai-i10', brand: 'Hyundai', model: 'i10', ar: 'هيونداي i10' },
  // Dacia
  { slug: 'dacia-logan', brand: 'Dacia', model: 'Logan', ar: 'داسيا لوقان' },
  { slug: 'dacia-sandero', brand: 'Dacia', model: 'Sandero', ar: 'داسيا سانديرو' },
  { slug: 'dacia-duster', brand: 'Dacia', model: 'Duster', ar: 'داسيا داستر' },
  // Toyota
  { slug: 'toyota-corolla', brand: 'Toyota', model: 'Corolla', ar: 'تويوتا كورولا' },
  { slug: 'toyota-yaris', brand: 'Toyota', model: 'Yaris', ar: 'تويوتا ياريس' },
  { slug: 'toyota-hilux', brand: 'Toyota', model: 'Hilux', ar: 'تويوتا هيلوكس' },
  // Kia
  { slug: 'kia-picanto', brand: 'Kia', model: 'Picanto', ar: 'كيا بيكانتو' },
  { slug: 'kia-rio', brand: 'Kia', model: 'Rio', ar: 'كيا ريو' },
  { slug: 'kia-sportage', brand: 'Kia', model: 'Sportage', ar: 'كيا سبورتاج' },
];

export const MODEL_BY_SLUG: Record<string, CarModel> =
  Object.fromEntries(CAR_MODELS.map((m) => [m.slug, m]));

export function modelUrl(slug: string): string {
  return `${SITE}/voitures/modeles/${slug}`;
}

export const MIN_LISTINGS = 3; // thin-content guard (verbatim)
export const MAX_CARDS = 40;   // verbatim
export const FETCH_LIMIT = 5000; // verbatim (27 Sep 2026)

// ---------------------------------------------------------------------------
// seoCategories/index.js — card renderers (verbatim)
// ---------------------------------------------------------------------------

type RawDoc = Record<string, unknown>;

function firstString(arr: unknown): string {
  return Array.isArray(arr)
    ? String(arr.find((x) => typeof x === 'string' && x !== '') || '')
    : '';
}

// FIX-FN-007 (0.0.0.31): server thumbnail first, then legacy thumbUrls,
// then the full-size photo. Serving the original cost ~877KB/page vs
// ~159KB with thumbs (R2 H-R2-9).
export function cardPhoto(f: RawDoc): string {
  return (
    firstString(f && f.photo_thumbs) ||
    firstString(f && f.thumbUrls) ||
    firstString(f && f.photoUrls) ||
    firstString(f && f.photos) ||
    ''
  );
}

export interface ModelCardItem {
  id: string;
  title: string;
  price: string;
  wilayaCode: number;
  photo: string;
  negotiable?: boolean; // R71 (18 Oct 2026): Zak's FINAL rule — 1-DZD shown WITH badge
}

// S-03 (0.0.0.21): card links use the canonical /listing/<id> form.
export function cardHtml(item: ModelCardItem, pos: number, lang: string): string {
  // 14 Oct 2026 audit R24: first 4 cards eager + high priority (above fold).
  const eager = pos <= 4;
  const img = item.photo
    ? `<img src="${escHtml(item.photo)}" alt="${escHtml(item.title)}" loading="${eager ? 'eager' : 'lazy'}"${eager ? ' fetchpriority="high"' : ''} width="300" height="300">`
    // R8-2 (18 Oct 2026): was hardcoded Arabic دلالة on fr/en pages.
    : `<div class="noimg">${lang === 'fr' || lang === 'en' ? 'Dlala' : 'دلالة'}</div>`;
  const href = `${SITE}/listing/${escHtml(item.id)}`;
  // R71 (18 Oct 2026): Zak's FINAL rule — 1-DZD always shown WITH the badge.
  const badgeText = lang === 'fr' ? 'Négociable' : lang === 'en' ? 'Negotiable' : 'قابل للتفاوض';
  const badge = item.negotiable ? `<span class="negbadge">${badgeText}</span>` : '';
  return `<article class="card">
  <a href="${href}">${img}</a>
  <div class="cbody">
    <h3><a href="${href}">${escHtml(item.title)}</a></h3>
    <div class="price" dir="ltr">${escHtml(item.price)}${badge}</div>
    <div class="wilaya">${escHtml(wilayaName(item.wilayaCode, lang))}</div>
  </div>
</article>`;
}

// Unified CTA card (Zak-approved 28 Sep 2026): same design + copy as the
// guides function. Shown top AND bottom on every SEO landing page.
export function ctaTopHtml(lang: string): string {
  const isFr = lang === 'fr';
  const isEn = lang === 'en';
  const head = isFr
    ? 'Découvrez toutes les annonces sur Dlala'
    : isEn
      ? 'Browse all listings on Dlala'
      : 'تصفح موقع دلالة و اكتشف كل الاعلانات';
  const btn = isFr ? 'Cliquez ici' : isEn ? 'Click here' : 'اضغط هنا';
  return `<div class="cta-top"><span class="h">${escHtml(head)}</span><a class="b" href="${SITE}/">${escHtml(btn)}</a></div>`;
}

// pageUrl('cars', 0) in the CF = `${SITE}/voitures` (fr-slug of Voitures).
// Category landing pages are the next parity round; the breadcrumb link
// stays byte-identical to production until then.
export function carsCategoryUrl(): string {
  return `${SITE}/voitures`;
}

export function buildModelPage(modelInfo: CarModel, items: ModelCardItem[], lang: string): string {
  const isFr = lang === 'fr';
  const isEn = lang === 'en';
  const latinName = `${modelInfo.brand} ${modelInfo.model}`;
  const title = isFr
    ? `${latinName} d'occasion | DLALA`
    : isEn
      ? `${latinName} used cars | DLALA`
      : `${modelInfo.ar} مستعملة | دلالة`;
  const description = isFr
    ? `Annonces ${latinName} d'occasion en Algérie : ${items.length} annonces avec prix et photos. Contact direct avec les vendeurs.`
    : isEn
      ? `Used ${latinName} listings in Algeria: ${items.length} ads with prices and photos. Contact sellers directly.`
      : `إعلانات ${modelInfo.ar} مستعملة في الجزائر: ${items.length} إعلان بالأسعار والصور. تواصل مباشر مع البائعين.`;
  const url = modelUrl(modelInfo.slug);
  // Self-referencing canonical per language (14 Oct 2026 audit R5).
  const canonicalUrl = isFr
    ? `${SITE}/fr/voitures/modeles/${modelInfo.slug}`
    : isEn
      ? `${SITE}/en/voitures/modeles/${modelInfo.slug}`
      : url;
  // 17 Oct 2026 (SEO audit FIX #8): full bidirectional hreflang cluster
  // (ar default unprefixed + fr + en + x-default) — wilaya-pages.ts pattern.
  const hreflangs = `<link rel="alternate" hreflang="ar" href="${escHtml(url)}">\n<link rel="alternate" hreflang="fr" href="${escHtml(`${SITE}/fr/voitures/modeles/${modelInfo.slug}`)}">\n<link rel="alternate" hreflang="en" href="${escHtml(`${SITE}/en/voitures/modeles/${modelInfo.slug}`)}">\n<link rel="alternate" hreflang="x-default" href="${escHtml(url)}">`;
  // D2/D5 (SEO audit 18 Oct 2026): full OG + Twitter cards — wilaya-pages.ts
  // pattern. og:image = first card photo (absolute URL), site icon as
  // fallback. Model pages previously shipped zero OG tags.
  const ogImageRaw = items.find((it) => it.photo)?.photo || `${SITE}/icon-512.png`;
  const ogImage = ogImageRaw.startsWith('http')
    ? ogImageRaw
    : `${SITE}${ogImageRaw.startsWith('/') ? '' : '/'}${ogImageRaw}`;
  const ogTags = `<meta property="og:type" content="website">\n<meta property="og:site_name" content="DLALA">\n<meta property="og:title" content="${escHtml(title)}">\n<meta property="og:description" content="${escHtml(description)}">\n<meta property="og:url" content="${escHtml(canonicalUrl)}">\n<meta property="og:image" content="${escHtml(ogImage)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${escHtml(title)}">\n<meta name="twitter:description" content="${escHtml(description)}">\n<meta name="twitter:image" content="${escHtml(ogImage)}">`;
  const switchAr = `<a href="${escHtml(url)}">العربية</a>`;
  const switchFr = `<a href="${escHtml(`${SITE}/fr/voitures/modeles/${modelInfo.slug}`)}">Français</a>`;
  const switchEn = `<a href="${escHtml(`${SITE}/en/voitures/modeles/${modelInfo.slug}`)}">English</a>`;
  const langSwitch = isFr
    ? `${switchAr} · ${switchEn}`
    : isEn
      ? `${switchAr} · ${switchFr}`
      : `${switchFr} · ${switchEn}`;
  const homeLabel = isFr ? 'Accueil' : isEn ? 'Home' : 'الرئيسية';
  const carsLabel = isFr ? 'Voitures' : isEn ? 'Cars' : 'سيارات';
  const modelLabel = isFr || isEn ? latinName : modelInfo.ar;
  const dir = isFr || isEn ? 'ltr' : 'rtl';
  const textAlign = isFr || isEn ? 'right' : 'left';
  const cards = items.map((it, i) => cardHtml(it, i + 1, lang)).join('\n');
  const listItems = items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      // R13 AX-F2 (18 Oct 2026): 'Car' — matches the R8 wilaya/category
      // standardization (wilaya-pages.ts); model pages emitted 'Product'.
      '@type': 'Car',
      name: it.title,
      url: `${SITE}/listing/${encodeURIComponent(it.id)}`,
    },
  }));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'ItemList', name: title, url: canonicalUrl, numberOfItems: items.length, itemListElement: listItems },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'دلالة', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'سيارات', item: carsCategoryUrl() },
          { '@type': 'ListItem', position: 3, name: modelInfo.ar, item: url },
        ],
      },
    ],
  };
  return `<!DOCTYPE html>
<html dir="${dir}" lang="${isEn ? 'en' : lang}">
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
body{font-family:system-ui,'Segoe UI',Tahoma,Arial,sans-serif;margin:0;padding:16px;background:#f7f7f7;color:#1a1a1a}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cta-top{text-align:center;margin:18px 0;background:#eef7f1;border:1px solid rgba(13,122,79,.25);border-radius:14px;padding:18px 16px;box-shadow:0 2px 8px rgba(13,122,79,.08)}
.cta-top .h{display:block;font-weight:800;font-size:16px;margin-bottom:12px;color:#0a3d28;white-space:nowrap}
.cta-top .b{display:inline-block;background:#0d7a4f;color:#fff!important;font-weight:700;font-size:15.5px;padding:12px 34px;border-radius:999px;text-decoration:none;box-shadow:0 4px 14px rgba(13,122,79,.35)}
html[lang="fr"] .cta-top .h,html[lang="en"] .cta-top .h{font-size:15px}
.negbadge{display:inline-block;font-size:11px;font-weight:400;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:999px;padding:2px 8px;margin-inline-start:6px;white-space:nowrap;vertical-align:middle}
</style>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
<nav aria-label="breadcrumb"><a href="${SITE}/">${homeLabel}</a> ‹ <a href="${isFr ? `${SITE}/fr/voitures` : isEn ? `${SITE}/en/voitures` : carsCategoryUrl()}">${carsLabel}</a> ‹ ${escHtml(modelLabel)}</nav>
<div style="text-align:${textAlign};margin:8px 0">${langSwitch}</div>
<h1>${escHtml(title.replace(' | دلالة', '').replace(' | DLALA', ''))}</h1>
<p>${escHtml(description)}</p>
${ctaTopHtml(lang)}
<div class="grid">${cards}</div>
${ctaTopHtml(lang)}
</body>
</html>`;
}

export function notFoundPage(reason: string, locale: 'ar' | 'fr' | 'en' = 'ar'): string {
  // Round 6 (18 Oct 2026): trilingual 404 matching TRILINGUAL_404_HTML design.
  // The /fr/ and /en/ route variants pass their locale so the 404 renders
  // in the URL's language (was Arabic-only for all locales).
  const copy = {
    ar: {
      msg: reason === 'wilaya' ? 'الولاية المطلوبة غير موجودة.' : 'الصفحة المطلوبة غير موجودة.',
      home: 'العودة إلى دلالة',
      title: 'غير موجود | دلالة',
      lang: 'ar', dir: 'rtl',
    },
    fr: {
      msg: reason === 'wilaya' ? 'La wilaya demandée n\'existe pas.' : 'La page demandée n\'existe pas.',
      home: 'Retour à Dlala',
      title: 'Introuvable | Dlala',
      lang: 'fr', dir: 'ltr',
    },
    en: {
      msg: reason === 'wilaya' ? 'The requested wilaya does not exist.' : 'The requested page does not exist.',
      home: 'Back to Dlala',
      title: 'Not found | Dlala',
      lang: 'en', dir: 'ltr',
    },
  }[locale];
  return `<!DOCTYPE html>
<html lang="${copy.lang}" dir="${copy.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${copy.title}</title><meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,Tahoma;text-align:center;padding:60px">
<h1>404</h1><p>${escHtml(copy.msg)}</p><p><a href="${SITE}">${copy.home}</a></p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// seoCategories/index.js — serving filter, Pass 2 (verbatim)
// Model filter: match brand+model in answers (case-insensitive); the NAND
// form (!includes && !includes → fallback) and the title fallback's OR form
// (!includes || !includes → exclude) are kept EXACTLY as deployed.
// ---------------------------------------------------------------------------

export interface ModelListingSummary {
  id: string;
  title: unknown; // decoded: {ar,fr,en} map or string
  price: unknown;
  wilayaCode: unknown;
  photo_thumbs?: unknown;
  thumbUrls?: unknown;
  photoUrls?: unknown;
  photos?: unknown;
  answers?: unknown;
  categoryId?: unknown;
  status?: unknown;
  hidden?: unknown;
}

export function filterModelItems(
  listings: ModelListingSummary[],
  modelInfo: CarModel,
  lang: string = 'ar',
): ModelCardItem[] {
  const items: ModelCardItem[] = [];
  for (const f0 of listings) {
    // 27 Sep 2026 FIX: check FIRST — return-in-forEach does not stop the
    // loop, and the old check-after-push let items exceed MAX_CARDS.
    if (items.length >= MAX_CARDS) break;
    const f = f0 as unknown as RawDoc;
    if (f.hidden === true) continue;
    const ans = (f.answers && typeof f.answers === 'object' ? f.answers : {}) as Record<string, unknown>;
    const b = String(ans.brand || '').toLowerCase();
    const m = String(ans.model || '').toLowerCase();
    const wantB = modelInfo.brand.toLowerCase();
    const wantM = modelInfo.model.toLowerCase();
    // 14 Oct 2026 audit R35: was && (brand OR model match) — included wrong
    // models (e.g. Megane on Clio 4 page). Now requires BOTH brand AND model.
    if (!b.includes(wantB) || !m.includes(wantM)) {
      // Fallback: check title
      const t = String(titleOf(f.title) || '').toLowerCase();
      if (!t.includes(wantB) || !t.includes(wantM)) continue;
    }
    const photo = cardPhoto(f);
    items.push({
      id: String(f.id || ''),
      title: titleOf(f.title) || String(f.id || ''),
      price: fmtPrice(f.price, lang),
      wilayaCode: Number(f.wilayaCode) || 0,
      photo,
      negotiable: (f as Record<string, unknown>).negotiable === true, // R71
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// sitemap/index.js — qualifyingModelUrls (verbatim; note the DIFFERENT match
// rule vs the serving filter above: AND-style include here, kept as deployed)
// ---------------------------------------------------------------------------

export function qualifyingModelUrls(listings: ModelListingSummary[], minCount: number): string[] {
  const counts: Record<string, number> = Object.create(null);
  for (const l of listings) {
    if (l.categoryId !== 'cars') continue;
    if (l.status !== 'available' || l.hidden === true) continue;
    const ans = (l.answers && typeof l.answers === 'object' ? l.answers : {}) as Record<string, unknown>;
    const b = String(ans.brand || '').toLowerCase();
    const m = String(ans.model || '').toLowerCase();
    const t = l.title;
    const title = [
      t && typeof t === 'object' ? (t as Record<string, unknown>).ar : null,
      t && typeof t === 'object' ? (t as Record<string, unknown>).fr : null,
      t && typeof t === 'object' ? (t as Record<string, unknown>).en : null,
      typeof t === 'string' ? t : '',
    ].filter((x) => typeof x === 'string').join(' ').toLowerCase();
    for (const cm of CAR_MODELS) {
      const wantB = cm.brand.toLowerCase();
      const wantM = cm.model.toLowerCase();
      const inAnswers = b.includes(wantB) && m.includes(wantM);
      const inTitle = title.includes(wantB) && title.includes(wantM);
      if (inAnswers || inTitle) counts[cm.slug] = (counts[cm.slug] || 0) + 1;
    }
  }
  return Object.keys(counts)
    .filter((slug) => counts[slug] >= minCount)
    .sort()
    .map((slug) => `/voitures/modeles/${slug}`);
}

// ---------------------------------------------------------------------------
// Data fetch — seoCategories serving query (verbatim):
// listings(status == 'available', categoryId == 'cars'), orderBy createdAt
// DESC, limit FETCH_LIMIT (5000). Round 130 REST pattern.
// ---------------------------------------------------------------------------

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

const MODEL_CAR_FIELDS = [
  'title', 'price', 'negotiable', 'wilayaCode',
  'photo_thumbs', 'thumbUrls', 'photoUrls', 'photos',
  'answers', 'categoryId', 'status', 'hidden', 'createdAt',
];

export async function fetchAvailableCars(): Promise<ModelListingSummary[]> {
  'use cache';
  cacheLife('days');
  // siteStats precompute (22 Oct 2026 reads fix): the Cloud Function
  // writes this exact window (same query semantics, same order) to
  // siteStats/cars — read it (a few chunk docs) instead of re-running
  // the 1,356-doc scan on every cache regeneration.
  // 23 Oct 2026 hardening: the scan may run ONLY when the dataset is
  // genuinely missing (head 404) and the circuit breaker grants this
  // process its one bounded scan; malformed data or a transient read
  // failure serves [] — the safe empty the consumers already handle
  // (thin/empty landing behavior for one cache window) — never a
  // repeated full scan.
  const r = await readStatsArrayDetailed('cars');
  if (r.kind === 'ok') return r.value.items as unknown as ModelListingSummary[];
  if (r.kind === 'missing' && claimStatsScan('cars')) {
    console.warn('siteStats/cars missing — one bounded cold-start scan');
    return fetchAvailableCarsScan();
  }
  console.warn(
    r.kind === 'missing'
      ? 'siteStats/cars missing — scan suppressed by circuit breaker'
      : 'siteStats/cars malformed/unreadable — serving [] (no scan)'
  );
  return [];
}

// The original live-scan implementation, kept verbatim as the fallback
// for when the siteStats dataset is genuinely missing (breaker-gated).
async function fetchAvailableCarsScan(): Promise<ModelListingSummary[]> {
  const url = FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const structuredQuery = {
    from: [{ collectionId: 'listings' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'available' } } },
          { fieldFilter: { field: { fieldPath: 'categoryId' }, op: 'EQUAL', value: { stringValue: 'cars' } } },
        ],
      },
    },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    select: { fields: MODEL_CAR_FIELDS.map((f) => ({ fieldPath: f })) },
    limit: FETCH_LIMIT,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`model-cars-rest-${res.status}`);
  const body = await res.json().catch(() => null);
  const docs = (Array.isArray(body) ? body : []).filter((r) => r.document).map((r) => r.document);
  return docs.map((d: { name: string; fields?: Record<string, unknown> }) => {
    const out: Record<string, unknown> = { id: String(d.name).split('/').pop() };
    const fs = d.fields || {};
    for (const k in fs) out[k] = decodeRestValue(fs[k]);
    return out as unknown as ModelListingSummary;
  });
}
