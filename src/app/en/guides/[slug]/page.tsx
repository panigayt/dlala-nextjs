// Guide article (English) — same pattern as the French article
// (src/app/fr/guides/[slug]/page.tsx): SEO parity with title/meta/
// canonical, hreflang ar/fr/en/x-default, og:type=article, Article JSON-LD,
// breadcrumb nav. Reuses GuideBreadcrumbs and PriceGuideView from the
// Arabic article route.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { SITE } from '@/lib/seo';
import { GUIDE_SLUGS, renderArticleData, type GuideLang } from '@/lib/guides';
import {
  loadPriceGuide,
  priceGuideSlugYear,
  priceGuideYear,
  renderPriceGuideData,
} from '@/lib/price-guide';
import { getPriceStats } from '@/lib/price-stats';
import { GuideBreadcrumbs, PriceGuideView } from '../../../guides/[slug]/page';

const LANG: GuideLang = 'en';

// Only the known slugs exist — anything else is a 404.
export function generateStaticParams() {
  return GUIDE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Dynamic live price guide — see ../../guides/[slug]/page.tsx.
  const pgYear = priceGuideSlugYear(slug);
  if (pgYear !== null) {
    // Live guide → request-time render.
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
      ...(d.live ? {} : { robots: { index: false, follow: true } }),
      alternates: {
        canonical: d.canonical,
        languages: {
          ar: d.hreflangs[0].href,
          fr: d.hreflangs[1].href,
          en: d.hreflangs[2].href,
          'x-default': d.hreflangs[3].href,
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
        en: d.hreflangs[2].href,
        'x-default': d.hreflangs[3].href,
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

export default async function GuideArticleEnPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pgYear = priceGuideSlugYear(slug);
  if (pgYear !== null) {
    // Live guide → request-time render (see ../../guides/[slug]/page.tsx).
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
    <div className="guide-page" dir="ltr" lang="en">
      <GuideBreadcrumbs items={d.breadcrumbs} lang="en" />
      <div dangerouslySetInnerHTML={{ __html: d.bodyHtml }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: d.jsonLd }}
      />
    </div>
  );
}
