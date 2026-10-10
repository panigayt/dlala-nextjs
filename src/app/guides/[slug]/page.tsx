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

import { SITE } from '@/lib/seo';
import {
  GUIDE_SLUGS,
  renderArticleData,
  type Breadcrumb,
  type GuideLang,
} from '@/lib/guides';

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

export default async function GuideArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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
