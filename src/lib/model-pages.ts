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

export function fmtPrice(p: unknown): string {
  const n = Number(p);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US') + ' دج';
}

const WILAYA_BY_CODE: Record<number, { ar: string; fr: string }> =
  Object.fromEntries(WILAYAS.map((w) => [w.code, { ar: w.ar, fr: w.fr }]));

export function wilayaName(code: number, lang: string): string {
  const w = WILAYA_BY_CODE[code];
  if (!w) return '';
  return lang === 'fr' ? w.fr : w.ar;
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
}

// S-03 (0.0.0.21): card links use the canonical /listing/<id> form.
export function cardHtml(item: ModelCardItem, pos: number, lang: string): string {
  void pos;
  const img = item.photo
    ? `<img src="${escHtml(item.photo)}" alt="${escHtml(item.title)}" loading="lazy" width="300" height="300">`
    : `<div class="noimg">دلالة</div>`;
  const href = `${SITE}/listing/${escHtml(item.id)}`;
  return `<article class="card">
  <a href="${href}">${img}</a>
  <div class="cbody">
    <h3><a href="${href}">${escHtml(item.title)}</a></h3>
    <div class="price" dir="ltr">${escHtml(item.price)}</div>
    <div class="wilaya">${escHtml(wilayaName(item.wilayaCode, lang))}</div>
  </div>
</article>`;
}

// Unified CTA card (Zak-approved 28 Sep 2026): same design + copy as the
// guides function. Shown top AND bottom on every SEO landing page.
export function ctaTopHtml(lang: string): string {
  const isFr = lang === 'fr';
  const head = isFr ? 'Découvrez toutes les annonces sur Dlala' : 'تصفح موقع دلالة و اكتشف كل الاعلانات';
  const btn = isFr ? 'Cliquez ici' : 'اضغط هنا';
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
  const title = isFr
    ? `${modelInfo.brand} ${modelInfo.model} d'occasion | DLALA`
    : `${modelInfo.ar} مستعملة | دلالة`;
  const description = isFr
    ? `Annonces ${modelInfo.brand} ${modelInfo.model} d'occasion en Algérie : ${items.length} annonces avec prix et photos. Contact direct avec les vendeurs.`
    : `إعلانات ${modelInfo.ar} مستعملة في الجزائر: ${items.length} إعلان بالأسعار والصور. تواصل مباشر مع البائعين.`;
  const url = modelUrl(modelInfo.slug);
  const cards = items.map((it, i) => cardHtml(it, i + 1, lang)).join('\n');
  const listItems = items.map((it, i) => ({
    '@type': 'ListItem', position: i + 1,
    url: `${SITE}/listing/${encodeURIComponent(it.id)}`, name: it.title,
  }));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'ItemList', name: title, url, numberOfItems: items.length, itemListElement: listItems },
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
<html dir="${isFr ? 'ltr' : 'rtl'}" lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(description)}">
<link rel="canonical" href="${escHtml(url)}">
<style>
body{font-family:system-ui,'Segoe UI',Tahoma,Arial,sans-serif;margin:0;padding:16px;background:#f7f7f7;color:#1a1a1a}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cta-top{text-align:center;margin:18px 0;background:#eef7f1;border:1px solid rgba(13,122,79,.25);border-radius:14px;padding:18px 16px;box-shadow:0 2px 8px rgba(13,122,79,.08)}
.cta-top .h{display:block;font-weight:800;font-size:16px;margin-bottom:12px;color:#0a3d28;white-space:nowrap}
.cta-top .b{display:inline-block;background:#0d7a4f;color:#fff!important;font-weight:700;font-size:15.5px;padding:12px 34px;border-radius:999px;text-decoration:none;box-shadow:0 4px 14px rgba(13,122,79,.35)}
html[lang="fr"] .cta-top .h{font-size:15px}
</style>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
<nav aria-label="breadcrumb"><a href="${SITE}/">${isFr ? 'Accueil' : 'الرئيسية'}</a> ‹ <a href="${isFr ? `${SITE}/fr/voitures` : carsCategoryUrl()}">${isFr ? 'Voitures' : 'سيارات'}</a> ‹ ${escHtml(isFr ? `${modelInfo.brand} ${modelInfo.model}` : modelInfo.ar)}</nav>
<div style="text-align:${isFr ? 'right' : 'left'};margin:8px 0"><a href="${isFr ? modelUrl(modelInfo.slug) : `${SITE}/fr/voitures/modeles/${modelInfo.slug}`}">${isFr ? 'العربية' : 'Français'}</a></div>
<h1>${escHtml(title.replace(' | دلالة', '').replace(' | DLALA', ''))}</h1>
<p>${escHtml(description)}</p>
${ctaTopHtml(lang)}
<div class="grid">${cards}</div>
${ctaTopHtml(lang)}
</body>
</html>`;
}

export function notFoundPage(reason: string): string {
  const msg = reason === 'wilaya' ? 'الولاية المطلوبة غير موجودة.' : 'الصفحة المطلوبة غير موجودة.';
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>غير موجود | دلالة</title><meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,Tahoma;text-align:center;padding:60px">
<h1>404</h1><p>${escHtml(msg)}</p><p><a href="${SITE}">العودة إلى دلالة</a></p>
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
  modelInfo: CarModel
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
    if (!b.includes(wantB) && !m.includes(wantM)) {
      // Fallback: check title
      const t = String(titleOf(f.title) || '').toLowerCase();
      if (!t.includes(wantB) || !t.includes(wantM)) continue;
    }
    const photo = cardPhoto(f);
    items.push({
      id: String(f.id || ''),
      title: titleOf(f.title) || String(f.id || ''),
      price: fmtPrice(f.price),
      wilayaCode: Number(f.wilayaCode) || 0,
      photo,
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
  'title', 'price', 'wilayaCode',
  'photo_thumbs', 'thumbUrls', 'photoUrls', 'photos',
  'answers', 'categoryId', 'status', 'hidden', 'createdAt',
];

export async function fetchAvailableCars(): Promise<ModelListingSummary[]> {
  'use cache';
  cacheLife('hours');
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
