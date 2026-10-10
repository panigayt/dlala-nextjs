// Guide article (French) — Next.js port of the production guides Cloud
// Function renderArticle() serving dzdlala.com/fr/guides/<slug>.
// Same SEO parity as the Arabic version (see ../[slug]/page.tsx).

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SITE } from '@/lib/seo';
import { GUIDE_SLUGS, renderArticleData, type GuideLang } from '@/lib/guides';
import { GuideBreadcrumbs } from '../../../guides/[slug]/page';

const LANG: GuideLang = 'fr';


export function generateStaticParams() {
  return GUIDE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
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

export default async function GuideArticleFrPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const d = renderArticleData(slug, LANG);
  if (!d) notFound();
  return (
    <div className="guide-page" dir="ltr" lang="fr">
      <GuideBreadcrumbs items={d.breadcrumbs} />
      <div dangerouslySetInnerHTML={{ __html: d.bodyHtml }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: d.jsonLd }}
      />
    </div>
  );
}
