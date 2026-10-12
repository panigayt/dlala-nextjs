// Guides index (Arabic) — Next.js port of the production guides Cloud
// Function renderIndex() serving dzdlala.com/guides.
//
// SEO parity: title "أدلة الشراء | دلالة", meta description, canonical,
// hreflang ar/fr/x-default, CollectionPage JSON-LD, breadcrumb nav, guide
// cards sorted by title (localeCompare parity).

import type { Metadata } from 'next';

import { SITE } from '@/lib/seo';
import { renderIndexData, type GuideLang } from '@/lib/guides';
import { GuideBreadcrumbs } from './[slug]/page';

const LANG: GuideLang = 'ar';

export async function generateMetadata(): Promise<Metadata> {
  const d = renderIndexData(LANG);
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
      type: 'website',
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

export default async function GuidesIndexPage() {
  const d = renderIndexData(LANG);
  return (
    <div className="guide-page" dir="rtl" lang="ar">
      <GuideBreadcrumbs items={d.breadcrumbs} />
      <div dangerouslySetInnerHTML={{ __html: d.bodyHtml }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: d.jsonLd }}
      />
    </div>
  );
}
