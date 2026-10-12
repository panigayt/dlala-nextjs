// Guides index (English) — same pattern as the French index
// (src/app/fr/guides/page.tsx): SEO parity with title/meta/canonical,
// hreflang ar/fr/en/x-default, CollectionPage JSON-LD, breadcrumb nav.

import type { Metadata } from 'next';

import { SITE } from '@/lib/seo';
import { renderIndexData, type GuideLang } from '@/lib/guides';
import { GuideBreadcrumbs } from '../../guides/[slug]/page';

const LANG: GuideLang = 'en';

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

export default async function GuidesIndexEnPage() {
  const d = renderIndexData(LANG);
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
