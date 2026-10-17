// Guides index (Arabic) — Next.js port of the production guides Cloud
// Function renderIndex() serving dzdlala.com/guides.
//
// SEO parity: title "أدلة الشراء | دلالة", meta description, canonical,
// hreflang ar/fr/x-default, CollectionPage JSON-LD, breadcrumb nav, guide
// cards sorted by title (localeCompare parity).

import type { Metadata } from 'next';
import { connection } from 'next/server';

import { SITE } from '@/lib/seo';
import { renderIndexData, type GuideLang } from '@/lib/guides';
import { GuideBreadcrumbs } from './[slug]/page';

const LANG: GuideLang = 'ar';

// Round 43: request-time render — SiteChrome's usePathname() suspends during
// static prerender and empties the prerendered body (guides SEO bug, Oct 2026).
// `connection()` is the Next 16 / cacheComponents way to opt into
// request-time rendering. Edge cache: src/proxy.ts sets s-maxage=3600.

export async function generateMetadata(): Promise<Metadata> {
  // 17 Oct 2026 (audit H2): NO connection() in generateMetadata — it
  // streamed the metadata into <body>. The page body below keeps its own
  // connection() (Round 43), so the route stays dynamic and this resolves
  // per-request, before the head flush.
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
  // Request-time render (see generateMetadata above).
  await connection();
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
