// Guide article (French) — Next.js port of the production guides Cloud
// Function renderArticle() serving dzdlala.com/fr/guides/<slug>.
// Same SEO parity as the Arabic version (see ../[slug]/page.tsx).

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { SITE } from '@/lib/seo';
import { renderArticleData, type GuideLang } from '@/lib/guides';
import {
  loadPriceGuide,
  priceGuideSlugYear,
  priceGuideYear,
  renderPriceGuideData,
} from '@/lib/price-guide';
import { getPriceStats } from '@/lib/price-stats';
import { GuideBreadcrumbs, PriceGuideView } from '../../../guides/[slug]/page';

const LANG: GuideLang = 'fr';

// Round 43: request-time render — see the note on the Arabic article page
// (SiteChrome's usePathname() empties statically prerendered bodies).

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  // 17 Oct 2026 (audit H2): NO connection() in generateMetadata — it
  // streamed the metadata into <body>. See ../../guides/[slug]/page.tsx:
  // the page body keeps its own connection(), so the route stays dynamic
  // and this still resolves per-request, before the head flush.
  const { slug } = await params;
  // Dynamic live price guide (S-17/S-18/S-25) — see ../../guides/[slug]/page.tsx.
  const pgYear = priceGuideSlugYear(slug);
  if (pgYear !== null) {
    // Live guide → request-time render (see ../../guides/[slug]/page.tsx).
    // Old-year slugs never reach here (src/proxy.ts 301s them).
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

export default async function GuideArticleFrPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Request-time render (see generateMetadata above).
  await connection();
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
    <div className="guide-page" dir="ltr" lang="fr">
      <GuideBreadcrumbs items={d.breadcrumbs} lang="fr" />
      <div dangerouslySetInnerHTML={{ __html: d.bodyHtml }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: d.jsonLd }}
      />
    </div>
  );
}
