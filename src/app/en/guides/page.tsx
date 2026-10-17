// Guides index (English) — same pattern as the French index
// (src/app/fr/guides/page.tsx): SEO parity with title/meta/canonical,
// hreflang ar/fr/en/x-default, CollectionPage JSON-LD, breadcrumb nav.

import type { Metadata } from 'next';
import { connection } from 'next/server';

import { SITE } from '@/lib/seo';
import { renderIndexData, type GuideLang } from '@/lib/guides';
import { GuideBreadcrumbs } from '../../guides/[slug]/page';

const LANG: GuideLang = 'en';

// Round 43: request-time render — see the note on the Arabic index page
// (SiteChrome's usePathname() empties statically prerendered bodies).

export async function generateMetadata(): Promise<Metadata> {
  // 17 Oct 2026 (audit H2): NO connection() in generateMetadata — it
  // streamed the metadata into <body>. See ../../guides/[slug]/page.tsx:
  // the page body keeps its own connection(), so the route stays dynamic
  // and this resolves per-request, before the head flush.
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
  // Request-time render (see generateMetadata above).
  await connection();
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
