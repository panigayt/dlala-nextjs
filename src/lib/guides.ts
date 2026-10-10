// SEO guides — verbatim port of the pure rendering functions from the
// production Cloud Function ~/workspace/dlala-app/functions/guides/index.js
// (2nd gen, nodejs22, europe-west3) that serves dzdlala.com/guides/*.
//
// Round 129 scope: the 3 static editorial guides × AR/FR + the guides index.
// Round 130: the dynamic price guide (prix-voitures-occasion-<year>, live
// Firestore medians) — pure functions in ./price-guide.ts, cached
// aggregation in ./price-stats.ts. The 22 model pages, category landing
// pages and category×wilaya pages are still open (seoCategories parity).
//
// Content markdown files are bundled verbatim under ./guides-content/.

import fs from 'fs';
import path from 'path';

import { SITE } from './seo';

export type GuideLang = 'ar' | 'fr';

const CONTENT_DIR = path.join(process.cwd(), 'src', 'lib', 'guides-content');

// Static editorial guides (Round 129). The price guide slug is intentionally
// absent — it is dynamic (Round 130).
export const GUIDE_SLUGS = [
  'acheter-voiture-occasion',
  'controler-telephone-occasion',
  'eviter-arnaques',
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

export interface GuideMeta {
  title: string;
  description: string;
  slug: string;
  lang: string;
  category: string;
  reading_time: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Minimal Markdown → HTML — VERBATIM from the Cloud Function (no external
// deps). Supports: #/##/### headings, **bold**, *italic*, [link](url),
// | tables |, - lists, 1. lists, > quotes, --- hr, `code`, paragraphs.
// ---------------------------------------------------------------------------
export function escHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMd(s: string): string {
  let h = escHtml(s);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return h;
}

export function mdToHtml(md: string): string {
  const lines = String(md || '').split('\n');
  let html = '';
  let inList: 'ul' | 'ol' | null = null;
  let inTable = false;
  let para: string[] = [];

  function flushPara() {
    if (para.length) {
      html += '<p>' + para.map(inlineMd).join('<br>') + '</p>\n';
      para = [];
    }
  }
  function closeList() {
    if (inList) { html += inList === 'ul' ? '</ul>\n' : '</ol>\n'; inList = null; }
  }
  function closeTable() {
    if (inTable) { html += '</tbody></table>\n'; inTable = false; }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    // Table row
    if (/^\|.*\|$/.test(t)) {
      flushPara(); closeList();
      const cells = t.slice(1, -1).split('|').map((c) => c.trim());
      const isSep = cells.every((c) => /^:?-+:?$/.test(c));
      if (isSep) continue; // separator row
      if (!inTable) { html += '<table>\n<thead>\n<tr>'; inTable = true; }
      else if (!html.endsWith('</thead>\n')) { /* body */ }
      // First row after <table> is header; detect by checking if thead open
      const tag = html.endsWith('<tr>') && !html.includes('</thead>') ? 'th' : 'td';
      // Simpler: treat first data row as header
      html += '<tr>' + cells.map((c) => `<${tag}>${inlineMd(c)}</${tag}>`).join('') + '</tr>\n';
      // Close thead after first row
      if (tag === 'th' && !html.includes('</thead>')) {
        // will be closed when table ends or next non-table line
      }
      continue;
    } else {
      if (inTable) {
        html = html.replace(/<table>\n<thead>\n/, '<table>\n<thead>\n') ;
        // close thead before tbody if not already
        if (!html.includes('</thead>')) html = html.replace(/(<\/tr>\n)(<tr>)/, '$1</thead>\n<tbody>\n$2');
        closeTable();
      }
    }

    if (!t) { flushPara(); closeList(); continue; }
    if (/^---+$/.test(t)) { flushPara(); closeList(); html += '<hr>\n'; continue; }

    const h = t.match(/^(#{1,4})\s+(.*)/);
    if (h) { flushPara(); closeList(); html += `<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>\n`; continue; }

    const bq = t.match(/^>\s?(.*)/);
    if (bq) { flushPara(); closeList(); html += `<blockquote>${inlineMd(bq[1])}</blockquote>\n`; continue; }

    const ul = t.match(/^[-*]\s+(.*)/);
    if (ul) {
      flushPara();
      if (inList !== 'ul') { closeList(); html += '<ul>\n'; inList = 'ul'; }
      html += `<li>${inlineMd(ul[1])}</li>\n`;
      continue;
    }
    const ol = t.match(/^\d+\.\s+(.*)/);
    if (ol) {
      flushPara();
      if (inList !== 'ol') { closeList(); html += '<ol>\n'; inList = 'ol'; }
      html += `<li>${inlineMd(ol[1])}</li>\n`;
      continue;
    }

    closeList();
    para.push(line);
  }
  flushPara(); closeList(); closeTable();
  // Fix unclosed thead if table ended with only header
  html = html.replace(/(<\/tr>\n)(<\/tbody>)/, '$1</thead>\n<tbody>\n$2');
  html = html.replace(/<thead>\n<tbody>/, '<thead>\n</thead>\n<tbody>');
  return html;
}

// ---------------------------------------------------------------------------
// Frontmatter + content loading — VERBATIM from the Cloud Function.
// ---------------------------------------------------------------------------
export function parseFrontmatter(src: string): { meta: Record<string, string>; body: string } {
  const m = String(src || '').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: String(src || '') };
  const meta: Record<string, string> = {};
  m[1].split('\n').forEach((line) => {
    const kv = line.match(/^(\w+):\s*"?([^"]*)"?$/);
    if (kv) meta[kv[1]] = kv[2];
  });
  return { meta, body: m[2] };
}

export interface LoadedGuide {
  meta: Record<string, string>;
  body: string;
  slug: string;
}

export function loadGuide(slug: string, lang: GuideLang): LoadedGuide | null {
  if (!(GUIDE_SLUGS as readonly string[]).includes(slug)) return null;
  const fname = lang === 'fr' ? `${slug}.fr.md` : `${slug}.md`;
  const fpath = path.join(CONTENT_DIR, fname);
  if (!fs.existsSync(fpath)) return null;
  const { meta, body } = parseFrontmatter(fs.readFileSync(fpath, 'utf8'));
  if (meta.lang !== lang) return null;
  return { meta, body, slug };
}

export function listGuides(lang: GuideLang): LoadedGuide[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return GUIDE_SLUGS
    .map((slug) => loadGuide(slug, lang))
    .filter((g): g is LoadedGuide => g !== null)
    .sort((a, b) => (a.meta.title || '').localeCompare(b.meta.title || ''));
}

// ---------------------------------------------------------------------------
// URL helpers — VERBATIM from the Cloud Function (SITE = port base).
// ---------------------------------------------------------------------------
export function guideUrl(slug: string, lang: GuideLang): string {
  return lang === 'fr' ? `${SITE}/fr/guides/${slug}` : `${SITE}/guides/${slug}`;
}

export function indexUrl(lang: GuideLang): string {
  return lang === 'fr' ? `${SITE}/fr/guides` : `${SITE}/guides`;
}

// Top CTA banner (design 2, Zak-approved 28 Sep 2026) — VERBATIM.
export function ctaTop(lang: GuideLang): string {
  const isFr = lang === 'fr';
  const head = isFr ? 'Découvrez toutes les annonces sur Dlala' : 'تصفح موقع دلالة و اكتشف كل الاعلانات';
  const btn = isFr ? 'Cliquez ici' : 'اضغط هنا';
  return `<div class="cta-top"><span class="h">${escHtml(head)}</span><a class="b" href="${SITE}/">${escHtml(btn)}</a></div>`;
}

// ---------------------------------------------------------------------------
// Page data builders. The Cloud Function returns a full HTML shell; the port
// renders inside the Next.js app shell, so these return data (title, meta,
// JSON-LD, body HTML, breadcrumbs) and the route components render them.
// Body HTML and JSON-LD are VERBATIM-equivalent to the function output.
// ---------------------------------------------------------------------------
export interface Hreflang {
  h: string;
  href: string;
}

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface GuidePageData {
  title: string;
  description: string;
  canonical: string;
  hreflangs: Hreflang[];
  jsonLd: string;
  bodyHtml: string;
  breadcrumbs: Breadcrumb[];
  meta: Record<string, string>;
}

export function renderArticleData(slug: string, lang: GuideLang): GuidePageData | null {
  const g = loadGuide(slug, lang);
  if (!g) return null;
  const isFr = lang === 'fr';
  const canonical = guideUrl(slug, lang);
  const hreflangs: Hreflang[] = [
    { h: 'ar', href: guideUrl(slug, 'ar') },
    { h: 'fr', href: guideUrl(slug, 'fr') },
    { h: 'x-default', href: guideUrl(slug, 'ar') },
  ];
  // The page shell already renders the frontmatter title as the single <h1>;
  // demote any <h1> inside the markdown body to <h2>.
  const articleHtml = mdToHtml(g.body)
    .replace(/<h1>/g, '<h2>')
    .replace(/<\/h1>/g, '</h2>');
  // Related guides (same category, excluding self, max 3)
  const related = listGuides(lang)
    .filter((r) => r.slug !== slug && r.meta.category === g.meta.category)
    .slice(0, 3);
  const relatedHtml = related.length
    ? `<h2>${isFr ? 'Guides liés' : 'أدلة ذات صلة'}</h2>\n<ul>` +
      related.map((r) => `<li><a href="${guideUrl(r.slug, lang)}">${escHtml(r.meta.title)}</a></li>`).join('\n') +
      `</ul>`
    : '';
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: g.meta.title,
    description: g.meta.description,
    inLanguage: lang,
    url: canonical,
    datePublished: g.meta.date || undefined,
    dateModified: g.meta.date || undefined,
    author: { '@type': 'Organization', name: 'DLALA', url: SITE },
    image: `${SITE}/icon-512.png`,
    publisher: { '@type': 'Organization', name: 'DLALA', url: SITE },
  });
  const bodyHtml =
    `<h1>${escHtml(g.meta.title)}</h1>\n` +
    `<p><small>${escHtml(g.meta.category || '')} · ${escHtml(g.meta.reading_time || '')} ${isFr ? 'min de lecture' : 'دقائق قراءة'}</small></p>\n` +
    ctaTop(lang) + '\n' +
    articleHtml + '\n' + relatedHtml +
    `\n<p><a href="${SITE}/" class="cta">${isFr ? 'Voir les annonces sur DLALA' : 'تصفح الإعلانات على دلالة'}</a></p>`;
  const breadcrumbs: Breadcrumb[] = [
    { label: isFr ? 'Accueil' : 'الرئيسية', href: SITE + '/' },
    { label: isFr ? 'Guides' : 'الأدلة', href: indexUrl(lang) },
    { label: g.meta.title },
  ];
  return {
    title: `${g.meta.title} | DLALA`,
    description: g.meta.description,
    canonical,
    hreflangs,
    jsonLd,
    bodyHtml,
    breadcrumbs,
    meta: g.meta,
  };
}

export function renderIndexData(lang: GuideLang): GuidePageData {
  const guides = listGuides(lang);
  const isFr = lang === 'fr';
  const title = isFr ? "Guides d\u2019achat | DLALA" : 'أدلة الشراء | دلالة';
  const description = isFr
    ? 'Guides pratiques pour acheter en toute confiance en Algérie : voitures d\u2019occasion, téléphones, prix du marché, et comment éviter les arnaques.'
    : 'أدلة عملية للشراء بثقة في الجزائر: السيارات المستعملة، الهواتف، أسعار السوق، وكيفية تجنب النصب.';
  const canonical = indexUrl(lang);
  const hreflangs: Hreflang[] = [
    { h: 'ar', href: indexUrl('ar') },
    { h: 'fr', href: indexUrl('fr') },
    { h: 'x-default', href: indexUrl('ar') },
  ];
  const cards = guides.map((g) =>
    `<article><h2><a href="${guideUrl(g.slug, lang)}">${escHtml(g.meta.title)}</a></h2>` +
    `<p>${escHtml(g.meta.description)}</p>` +
    `<p><small>${escHtml(g.meta.category || '')} · ${escHtml(g.meta.reading_time || '')} ${isFr ? 'min' : 'دقائق'}</small></p></article>`
  ).join('\n<hr>\n');
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
    inLanguage: lang,
  });
  const bodyHtml = `<h1>${escHtml(isFr ? "Guides d\u2019achat" : 'أدلة الشراء')}</h1>\n<p>${escHtml(description)}</p>\n<p><a href="${SITE}/" class="cta">${isFr ? 'Parcourir les annonces DLALA en toute sécurité' : 'تصفح إعلانات دلالة بأمان'}</a></p>\n${cards}`;
  const breadcrumbs: Breadcrumb[] = [
    { label: isFr ? 'Accueil' : 'الرئيسية', href: SITE + '/' },
    { label: isFr ? 'Guides' : 'الأدلة' },
  ];
  return { title, description, canonical, hreflangs, jsonLd, bodyHtml, breadcrumbs, meta: {} };
}
