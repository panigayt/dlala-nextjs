// Guide article (Arabic) — Next.js port of the production guides Cloud
// Function renderArticle() serving dzdlala.com/guides/<slug>.
//
// SEO parity: title "<meta.title> | DLALA", meta description, canonical,
// hreflang ar/fr/x-default, og:type=article, Article JSON-LD
// (headline/description/inLanguage/url/datePublished/dateModified/author/
// image/publisher), breadcrumb nav. Article body HTML is byte-equivalent to
// the function output (see src/lib/guides.ts).

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { SITE } from '@/lib/seo';
import {
  GUIDE_SLUGS,
  renderArticleData,
  type Breadcrumb,
  type GuideLang,
} from '@/lib/guides';
import {
  loadPriceGuide,
  priceGuideSlugYear,
  priceGuideYear,
  renderPriceGuideData,
  type PriceGuideData,
} from '@/lib/price-guide';
import { getPriceStats } from '@/lib/price-stats';

const LANG: GuideLang = 'ar';

// Only the known slugs exist — anything else is a 404 (the function answers
// 404 'Not found' for unknown slugs).

export function generateStaticParams() {
  return GUIDE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Dynamic live price guide (S-17/S-18/S-25) — Zak 27 Sep 2026 «يجب ان يكون
  // تلقائيا»: median + p25–p75 per model computed LIVE from Firestore.
  const pgYear = priceGuideSlugYear(slug);
  if (pgYear !== null) {
    // Live guide → request-time render (Next 16: new Date() is unstable
    // during prerender; the price guide is inherently dynamic).
    // Old-year slugs never reach here (src/proxy.ts 301s them).
    await connection();
    const g = loadPriceGuide(LANG, priceGuideYear());
    if (!g) return {};
    const d = renderPriceGuideData({
      lang: LANG,
      year: priceGuideYear(),
      meta: g.meta,
      body: g.body,
      stats: await getPriceStats(),
    });
    return {
      title: `${d.title} | DLALA`,
      description: d.description,
      // No live data → noindex until the data pipeline delivers
      // (audit S-17/S-18/S-25; CF sets the X-Robots-Tag header).
      ...(d.live ? {} : { robots: { index: false, follow: true } }),
      alternates: {
        canonical: d.canonical,
        languages: {
          ar: d.hreflangs[0].href,
          fr: d.hreflangs[1].href,
          'x-default': d.hreflangs[2].href,
        },
      },
      openGraph: {
        type: 'article',
        url: d.canonical,
        siteName: 'DLALA',
        title: `${d.title} | DLALA`,
        description: d.description,
        images: [`${SITE}/icon-512.png`],
      },
      twitter: {
        card: 'summary_large_image',
        title: `${d.title} | DLALA`,
        description: d.description,
        images: [`${SITE}/icon-512.png`],
      },
    };
  }
  const d = renderArticleData(slug, LANG);
  if (!d) return {};
  return {
    title: d.title,
    description: d.description,
    alternates: {
      canonical: d.canonical,
      languages: {
        ar: d.hreflangs[0].href,
        fr: d.hreflangs[1].href,
        'x-default': d.hreflangs[2].href,
      },
    },
    openGraph: {
      type: 'article',
      url: d.canonical,
      siteName: 'DLALA',
      title: d.title,
      description: d.description,
      images: [`${SITE}/icon-512.png`],
    },
    twitter: {
      card: 'summary_large_image',
      title: d.title,
      description: d.description,
      images: [`${SITE}/icon-512.png`],
    },
  };
}

export function GuideBreadcrumbs({ items }: { items: Breadcrumb[] }) {
  return (
    <nav aria-label="breadcrumb">
      <ol className="crumbs">
        {items.map((c, i) =>
          i < items.length - 1 ? (
            <li key={i}>
              <a href={c.href}>{c.label}</a>
            </li>
          ) : (
            <li key={i} aria-current="page">
              {c.label}
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}

// Shared price-guide view — the FR route reuses it (same pattern as
// GuideBreadcrumbs below).
export function PriceGuideView({ d, lang }: { d: PriceGuideData; lang: GuideLang }) {
  return (
    <div className="guide-page" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
      <GuideBreadcrumbs items={d.breadcrumbs} />
      <div dangerouslySetInnerHTML={{ __html: d.bodyHtml }} />
      {/* Per-listing JSON-LD pattern (listing page): crawlers read JSON-LD
          anywhere in the HTML. '<' is escaped by JSON.stringify. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: d.jsonLd }}
      />
    </div>
  );
}

export default async function GuideArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pgYear = priceGuideSlugYear(slug);
  if (pgYear !== null) {
    // Live guide → request-time render (see generateMetadata above).
    // Old-year slugs never reach here: src/proxy.ts 301s them to
    // the current year before the route renders.
    await connection();
    const g = loadPriceGuide(LANG, priceGuideYear());
    if (!g) notFound();
    const d = renderPriceGuideData({
      lang: LANG,
      year: priceGuideYear(),
      meta: g.meta,
      body: g.body,
      stats: await getPriceStats(),
    });
    return <PriceGuideView d={d} lang={LANG} />;
  }
  const d = renderArticleData(slug, LANG);
  if (!d) notFound();
  return (
    <div className="guide-page" dir="rtl" lang="ar">
      <GuideBreadcrumbs items={d.breadcrumbs} />
      <div dangerouslySetInnerHTML={{ __html: d.bodyHtml }} />
      {/* Per-listing JSON-LD pattern (listing page): crawlers read JSON-LD
          anywhere in the HTML. '<' is escaped by JSON.stringify. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: d.jsonLd }}
      />
    </div>
  );
}
