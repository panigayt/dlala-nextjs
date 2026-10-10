// Dynamic live price guide — verbatim port of the pure functions from the
// production guides Cloud Function
// (~/workspace/dlala-app/functions/guides/index.js, 2nd gen, nodejs22,
// europe-west3) that serves dzdlala.com/guides/prix-voitures-occasion-<year>.
//
// Zak (27 Sep 2026): «يجب ان يكون تلقائيا» — median + p25–p75 per model are
// computed LIVE from Firestore on every request (cached 1h), placeholder
// prices excluded, ≥5 ads required per model. No manual recompute.
//
// Round 130 scope: pure functions here (differential-tested vs the CF).
// The cached Firestore aggregation lives in ./price-stats.ts ('use cache'
// + next/cache can't be imported in the node differential test).

import fs from 'fs';
import path from 'path';

import { SITE } from './seo';
import {
  escHtml,
  mdToHtml,
  ctaTop,
  guideUrl,
  indexUrl,
  parseFrontmatter,
  type Breadcrumb,
  type GuideLang,
  type Hreflang,
} from './guides';

const PRICE_CONTENT_DIR = path.join(process.cwd(), 'src', 'lib', 'guides-content');

// ---------------------------------------------------------------------------
// VERBATIM from the Cloud Function.
// ---------------------------------------------------------------------------

export interface PriceModel {
  key: string;
  ar: string;
  fr: string;
  brand: string;
  arBrand?: string;
  model: string;
  section: string;
  modelSlug: string | null;
}

// Canonical model keys. `brand`/`model` are the canonical Latin names matched
// against listing answers.brand/answers.model (cb/pb prefixes stripped).
// `modelSlug` is the seoCategories model-page slug for ItemList linking
// (null when no model page exists).
export const PRICE_MODELS: PriceModel[] = [
  { key: 'renault-clio-4',  ar: 'رونو كليو 4',    fr: 'Renault Clio 4',  brand: 'renault', arBrand: 'رونو', model: 'clio 4',   section: 'city',  modelSlug: 'renault-clio-4' },
  { key: 'peugeot-208',     ar: 'بيجو 208',       fr: 'Peugeot 208',     brand: 'peugeot', model: '208',      section: 'city',  modelSlug: 'peugeot-208' },
  { key: 'hyundai-i10',     ar: 'هيونداي i10',    fr: 'Hyundai i10',     brand: 'hyundai', model: 'i10',      section: 'city',  modelSlug: 'hyundai-i10' },
  { key: 'dacia-sandero',   ar: 'داسيا سانديرو',   fr: 'Dacia Sandero',   brand: 'dacia',   model: 'sandero',  section: 'city',  modelSlug: 'dacia-sandero' },
  { key: 'renault-symbol',  ar: 'رونو سامبول',    fr: 'Renault Symbol',  brand: 'renault', arBrand: 'رونو', model: 'symbol',   section: 'sedan', modelSlug: 'renault-symbol' },
  { key: 'peugeot-301',     ar: 'بيجو 301',       fr: 'Peugeot 301',     brand: 'peugeot', model: '301',      section: 'sedan', modelSlug: 'peugeot-301' },
  { key: 'hyundai-accent',  ar: 'هيونداي أكسنت',  fr: 'Hyundai Accent',  brand: 'hyundai', model: 'accent',   section: 'sedan', modelSlug: 'hyundai-accent' },
  { key: 'skoda-rapid',     ar: 'سكودا رابيد',    fr: 'Skoda Rapid',     brand: 'skoda',   model: 'rapid',    section: 'sedan', modelSlug: null },
  { key: 'dacia-duster',    ar: 'داسيا داستر',    fr: 'Dacia Duster',    brand: 'dacia',   model: 'duster',   section: 'suv',   modelSlug: 'dacia-duster' },
  { key: 'hyundai-tucson',  ar: 'هيونداي توسان',  fr: 'Hyundai Tucson',  brand: 'hyundai', model: 'tucson',   section: 'suv',   modelSlug: 'hyundai-tucson' },
  { key: 'kia-sportage',    ar: 'كيا سبورتاج',    fr: 'Kia Sportage',    brand: 'kia',     model: 'sportage', section: 'suv',   modelSlug: 'kia-sportage' },
];

export const PRICE_SECTIONS = [
  { key: 'city',  ar: 'سيارات المدينة الصغيرة',            fr: 'Citadines' },
  { key: 'sedan', ar: 'السيارات العائلية (سيدان)',         fr: 'Berlines familiales' },
  { key: 'suv',   ar: 'سيارات الدفع الرباعي والكروس أوفر', fr: 'SUV et crossovers' },
];

export const MIN_ADS_PER_MODEL = 5; // dynamic-spec rule: ≥5 ads for a model to show

// The guide year rolls over automatically: in 2027 the canonical slug
// becomes prix-voitures-occasion-2027 and old-year slugs 301 to it.
export function priceGuideYear(): number {
  return new Date().getFullYear();
}

export function priceGuideSlug(year: number): string {
  return `prix-voitures-occasion-${year}`;
}

// Matches ^prix-voitures-occasion-(\d{4})$ — returns the year or null.
export function priceGuideSlugYear(slug: string): number | null {
  const m = String(slug || '').match(/^prix-voitures-occasion-(\d{4})$/);
  return m ? Number(m[1]) : null;
}

// Normalize a brand/model token for matching: strip the cb/pb answer
// prefixes (lesson 24 Sep 2026), lowercase, collapse whitespace.
export function normToken(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .replace(/^(cb|pb)/, '')
    .replace(/[^a-z0-9\u0600-\u06ff\u00c0-\u024f]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PriceListing {
  price?: unknown;
  answers?: Record<string, unknown> | null;
  title?: unknown;
}

// Match a listing to one of PRICE_MODELS. Uses answers.brand/answers.model
// first, falls back to the (Arabic or Latin) title. Returns the model key.
export function matchPriceModel(listing: PriceListing): string | null {
  const answers = listing.answers || {};
  const brand = normToken(answers.brand);
  const model = normToken(answers.model);
  const rawTitle = listing.title;
  const titleStr =
    typeof rawTitle === 'string'
      ? rawTitle
      : rawTitle && typeof rawTitle === 'object'
        ? (rawTitle as Record<string, unknown>).ar ||
          (rawTitle as Record<string, unknown>).fr ||
          ''
        : '';
  const title = normToken(titleStr);
  for (const m of PRICE_MODELS) {
    const bHit =
      brand === m.brand ||
      title.split(' ').includes(m.brand) ||
      (m.arBrand != null && title.includes(m.arBrand));
    if (!bHit) continue;
    const mHit =
      model.includes(m.model) || title.includes(m.model) || title.includes(normToken(m.ar));
    if (mHit) return m.key;
  }
  return null;
}

// Linear-interpolation percentile on an ASC-sorted array.
export function percentile(sortedAsc: number[], q: number): number | null {
  const n = sortedAsc.length;
  if (!n) return null;
  if (n === 1) return sortedAsc[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

export interface PriceRow {
  key: string;
  count: number;
  median: number;
  p25: number;
  p75: number;
}

// Aggregate listings → per-model {key, count, median, p25, p75}.
// Placeholder prices excluded (FIX-FN-009, 0.0.0.31 — 1 دج is the deliberate
// "negotiable" convention; the fix excludes placeholders from GUIDE STATS
// only, ads keep showing 1 دج):
//   - non-finite, <= 0, == 1 DZD (the documented no-price sentinel),
//     > 100M (publish cap) — ALWAYS excluded;
//   - price <= 10000 in VEHICLE guides (the documented "call me"
//     convention: 10,000 DZD = "مليون" centimes placeholder) — excluded
//     only when opts.vehiclePlaceholders is true.
//   - models with fewer than MIN_ADS_PER_MODEL ads are dropped.
export function aggregateModelPrices(
  listings: PriceListing[],
  opts: { vehiclePlaceholders?: boolean } = {},
): PriceRow[] {
  const vehiclePlaceholders = opts.vehiclePlaceholders === true;
  const buckets: Record<string, number[]> = {};
  for (const l of listings) {
    const price = Number(l.price);
    if (!Number.isFinite(price) || price <= 0 || price > 100_000_000) continue;
    if (price === 1) continue; // the 1-DZD "negotiable" sentinel
    // FIX-FN-009: vehicle-guide placeholder ceiling (documented, tunable).
    if (vehiclePlaceholders && price <= 10000) continue;
    const key = matchPriceModel(l);
    if (!key) continue;
    (buckets[key] = buckets[key] || []).push(price);
  }
  const out: PriceRow[] = [];
  for (const [key, prices] of Object.entries(buckets)) {
    if (prices.length < MIN_ADS_PER_MODEL) continue;
    const sorted = prices.slice().sort((a, b) => a - b);
    out.push({
      key,
      count: prices.length,
      median: Math.round(percentile(sorted, 0.5) as number),
      p25: Math.round(percentile(sorted, 0.25) as number),
      p75: Math.round(percentile(sorted, 0.75) as number),
    });
  }
  return out;
}

// Format "1 500 000 دج" / "1 500 000 DZD" (Zak's LTR price rule).
export function fmtDzd(n: unknown, lang: GuideLang): string {
  const grouped = String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return lang === 'fr' ? `${grouped} DZD` : `${grouped} دج`;
}

// Build the live HTML table for one section from aggregated rows.
export function priceSectionTable(
  sectionKey: string,
  lang: GuideLang,
  rowsByModel: Record<string, PriceRow>,
): string {
  const isFr = lang === 'fr';
  const models = PRICE_MODELS.filter((m) => m.section === sectionKey);
  const rows = models
    .map((m) => ({ m, r: rowsByModel[m.key] }))
    .filter(({ r }) => r);
  if (!rows.length) return '';
  const head = isFr
    ? `<tr><th>Modèle</th><th>Prix médian</th><th>Fourchette de prix</th><th>Annonces</th></tr>`
    : `<tr><th>الموديل</th><th>السعر المتوسط</th><th>النطاق السعري</th><th>عدد الإعلانات</th></tr>`;
  const body = rows
    .map(({ m, r }) => {
      const name = isFr ? m.fr : m.ar;
      const label = m.modelSlug
        ? `<a href="${SITE}/voitures/modeles/${m.modelSlug}">${escHtml(name)}</a>`
        : escHtml(name);
      return (
        `<tr><td>${label}</td>` +
        `<td dir="ltr"><strong>${escHtml(fmtDzd(r.median, lang))}</strong></td>` +
        `<td dir="ltr">${escHtml(fmtDzd(r.p25, lang))} – ${escHtml(fmtDzd(r.p75, lang))}</td>` +
        `<td>${r.count}</td></tr>`
      );
    })
    .join('\n');
  return `<table>\n<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

export interface Faq {
  q: string;
  a: string;
}

export function priceGuideFaqs(lang: GuideLang): Faq[] {
  return lang === 'fr'
    ? [
        {
          q: "D'où viennent ces prix ?",
          a: 'Ces prix sont tirés des annonces publiées sur le site Dlala. Ils sont mis à jour en continu avec chaque nouvelle annonce.',
        },
        {
          q: "Qu'est-ce que le prix médian ?",
          a: 'C’est le prix du milieu des annonces publiées : la moitié des annonces sont moins chères, l’autre moitié plus chères. Il n’est guère affecté par les prix aberrants.',
        },
        {
          q: 'Pourquoi certains modèles n’apparaissent-ils pas ?',
          a: 'Aucun modèle n’est affiché avec moins de 5 annonces, afin de garantir la fiabilité du prix médian.',
        },
      ]
    : [
        {
          q: 'من أين تأتي هذه الأسعار؟',
          a: 'هذه الأسعار مأخوذة من الإعلانات المنشورة في موقع دلالة، وتُحدَّث باستمرار مع كل إعلان جديد.',
        },
        {
          q: 'ما هو السعر المتوسط؟',
          a: 'هو السعر الأوسط (الوسيط) للإعلانات المنشورة — نصف الإعلانات أرخص منه ونصفها أغلى، ولا يتأثر كثيراً بالأسعار الشاذة.',
        },
        {
          q: 'لماذا لا تظهر بعض الموديلات؟',
          a: 'لا يُعرض أي موديل بأقل من 5 إعلانات لضمان دقة السعر المتوسط.',
        },
      ];
}

// ---------------------------------------------------------------------------
// Page data builder — the Cloud Function returns a full HTML shell; the port
// renders inside the Next.js app shell, so this returns data (title, meta,
// JSON-LD, body HTML, breadcrumbs) and the route components render it.
// Body HTML and JSON-LD are VERBATIM-equivalent to the function output.
// ---------------------------------------------------------------------------

export interface PriceStats {
  ok: boolean;
  rows: PriceRow[];
  totalAds: number;
  fetchedAt: string | null;
}

export interface PriceGuideData {
  title: string;
  description: string;
  canonical: string;
  hreflangs: Hreflang[];
  jsonLd: string;
  bodyHtml: string;
  breadcrumbs: Breadcrumb[];
  meta: Record<string, string>;
  live: boolean;
}

// Render the live price guide. Pure except for the stats argument.
export function renderPriceGuideData({
  lang,
  year,
  meta,
  body,
  stats,
}: {
  lang: GuideLang;
  year: number;
  meta: Record<string, string>;
  body: string;
  stats: PriceStats;
}): PriceGuideData {
  const isFr = lang === 'fr';
  const canonical = guideUrl(priceGuideSlug(year), lang);
  const hreflangs: Hreflang[] = [
    { h: 'ar', href: guideUrl(priceGuideSlug(year), 'ar') },
    { h: 'fr', href: guideUrl(priceGuideSlug(year), 'fr') },
    { h: 'x-default', href: guideUrl(priceGuideSlug(year), 'ar') },
  ];
  const title = String(meta.title || '').replace(/202\d/g, String(year));
  const description = String(meta.description || '').replace(/202\d/g, String(year));
  const rowsByModel: Record<string, PriceRow> = Object.fromEntries(
    (stats.rows || []).map((r) => [r.key, r]),
  );
  const live = stats.ok && Object.keys(rowsByModel).length > 0;

  let articleHtml = mdToHtml(body.replace(/202\d/g, String(year)))
    .replace(/<h1>/g, '<h2>')
    .replace(/<\/h1>/g, '</h2>');
  // Inject live tables at the markers (escaped HTML comments in the HTML).
  // C-R58-1 (0.0.0.33): a segment with no qualifying models must NEVER
  // render an empty section — the explanatory note renders for every
  // empty segment.
  articleHtml = articleHtml.replace(
    /<p>&lt;!-- LIVE-PRICES:([a-z]+) --&gt;<\/p>/g,
    (mm: string, key: string) => {
      const t = priceSectionTable(key, lang, rowsByModel);
      return (
        t ||
        `<p class="live-note">${
          isFr
            ? 'Pas encore assez d’annonces pour ce segment — les prix apparaîtront ici dès que 5 annonces seront publiées.'
            : 'لا توجد إعلانات كافية بعد لهذه الفئة — ستظهر الأسعار هنا فور توفر 5 إعلانات.'
        }</p>`
      );
    },
  );
  const updatedNote = live
    ? `<p class="live-note">${
        isFr
          ? `Données calculées à partir de ${stats.totalAds} annonces · mises à jour en continu.`
          : `محسوبة من ${stats.totalAds} إعلان · تُحدَّث باستمرار.`
      }</p>`
    : `<p class="live-note">${
        isFr
          ? 'Les prix sont en cours de collecte à partir des annonces publiées — ils apparaîtront ici automatiquement.'
          : 'الأسعار قيد الجمع من الإعلانات المنشورة — ستظهر هنا تلقائياً.'
      }</p>`;
  articleHtml = articleHtml.replace(/<p>&lt;!-- LIVE-UPDATED --&gt;<\/p>/g, () => updatedNote);

  const faqs = priceGuideFaqs(lang);
  const faqHtml =
    `<h2>${isFr ? 'Questions fréquentes' : 'أسئلة شائعة'}</h2>\n` +
    faqs.map((f) => `<h3>${escHtml(f.q)}</h3>\n<p>${escHtml(f.a)}</p>`).join('\n');

  const modelItems = PRICE_MODELS.filter((m) => rowsByModel[m.key]).map((m, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: isFr ? m.fr : m.ar,
    url: m.modelSlug ? `${SITE}/voitures/modeles/${m.modelSlug}` : canonical,
  }));
  const jsonLd = JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      description,
      inLanguage: lang,
      url: canonical,
      datePublished: meta.date || undefined,
      dateModified: stats.fetchedAt || meta.date || undefined,
      author: { '@type': 'Organization', name: 'DLALA', url: SITE },
      image: `${SITE}/icon-512.png`,
      publisher: { '@type': 'Organization', name: 'DLALA', url: SITE },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: isFr ? 'Accueil' : 'الرئيسية', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: title, item: canonical },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: title,
      itemListElement: modelItems,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ]);
  const bodyHtml =
    `<h1>${escHtml(title)}</h1>\n` +
    `<p><small>${escHtml(meta.category || '')} · ${escHtml(meta.reading_time || '')} ${isFr ? 'min de lecture' : 'دقائق قراءة'}</small></p>\n` +
    ctaTop(lang) +
    '\n' +
    articleHtml +
    '\n' +
    faqHtml +
    `\n<p><a href="${SITE}/" class="cta">${isFr ? 'Voir les annonces sur DLALA' : 'تصفح الإعلانات على دلالة'}</a></p>`;
  const breadcrumbs: Breadcrumb[] = [
    { label: isFr ? 'Accueil' : 'الرئيسية', href: SITE + '/' },
    { label: isFr ? 'Guides' : 'الأدلة', href: indexUrl(lang) },
    { label: title },
  ];
  return {
    title,
    description,
    canonical,
    hreflangs,
    jsonLd,
    bodyHtml,
    breadcrumbs,
    meta,
    live,
  };
}

// Load the price-guide content file for the guide year (latest ≤ year),
// mirroring the Cloud Function's priceGuideFile(). Dedicated loader (not
// the shared loadGuide): the price slug is intentionally absent from
// GUIDE_SLUGS so generateStaticParams never prerenders the dynamic page.
export function loadPriceGuide(
  lang: GuideLang,
  year: number,
): { meta: Record<string, string>; body: string; slug: string } | null {
  for (let y = year; y >= 2026; y--) {
    const slug = priceGuideSlug(y);
    const fname = lang === 'fr' ? `${slug}.fr.md` : `${slug}.md`;
    const fpath = path.join(PRICE_CONTENT_DIR, fname);
    if (!fs.existsSync(fpath)) continue;
    const { meta, body } = parseFrontmatter(fs.readFileSync(fpath, 'utf8'));
    if (meta.lang !== lang) continue;
    return { meta, body, slug };
  }
  return null;
}
