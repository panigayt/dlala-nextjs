// Guides index (French) — Next.js port of the production guides Cloud
// Function renderIndex() serving dzdlala.com/fr/guides.
// Same SEO parity as the Arabic index (see ../../page.tsx).

import type { Metadata } from 'next';
import { connection } from 'next/server';

import { SITE } from '@/lib/seo';
import { renderIndexData, type GuideLang } from '@/lib/guides';
import { GuideBreadcrumbs } from '../../guides/[slug]/page';

const LANG: GuideLang = 'fr';

// Round 43: request-time render — see the note on the Arabic index page
// (SiteChrome's usePathname() empties statically prerendered bodies).

export async function generateMetadata(): Promise<Metadata> {
  // Request-time render (see ../../page.tsx).
  await connection();
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

export default async function GuidesIndexFrPage() {
  // Request-time render (see generateMetadata above).
  await connection();
  const d = renderIndexData(LANG);
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
