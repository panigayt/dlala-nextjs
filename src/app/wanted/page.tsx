// Dlala wanted ads (مطلوب) — Server-Side Rendered.
//
// Mirrors js/wanted.js exactly:
//   - Query: isWanted == true AND status IN [available, negotiating],
//     orderBy createdAt DESC, limit 120 (server-side newest-first).
//   - Client-side pipeline: keep visible, apply filters (cat/wilaya/q),
//     cap at 60 rendered.
//   - All-wilayas wanted ads (wilayaCode 0) stay visible under any wilaya
//     filter (M-8: relevant everywhere by definition).
//   - Filters via URL search params (?cat=&wilaya=&q=) so back/forward works.
//   - Public page — no auth required.
//
// Round 125: user-facing strings moved to the WantedShell client island
// (js/wanted.js + js/i18n.js parity) — this file is a data-only server
// shell (parse + fetch + Suspense skeleton, streaming behavior unchanged).

import { Suspense } from 'react';
import { cacheLife } from 'next/cache';
import {
  fetchWanted,
  type ListingCard,
} from '@/lib/firestore';
import WantedShell, { WantedSkeleton } from './WantedShell';
import type { WantedFilters } from './WantedFilterBar';
import { SITE } from '@/lib/seo';
import type { Metadata } from 'next';

// 14 Oct 2026 audit R18: server-rendered SEO (was client-side document.title only).
// 17 Oct 2026 (audit H2 — root-cause fix): generateMetadata is STATIC — no
// dlala_lang cookie read. Awaiting cookies() deferred the metadata segment
// past the initial <head> flush, so Next streamed the tags into <body>.
// Crawlers get the Arabic fallback; the tab re-localizes on hydration via
// lib/i18n updateDocTitle (titleKeyForPath '/wanted' → 'title_wanted').
export function generateMetadata(): Metadata {
  const title = 'مطلوب — دلالة';
  const url = `${SITE}/wanted`;
  return {
    title,
    // Round 205 (audit R1, A3): hreflang cluster — self-referential 'ar'
    // plus x-default. No /fr or /en wanted route exists, so fr/en targets
    // would be 404s.
    alternates: {
      canonical: url,
      languages: { ar: url, 'x-default': url },
    },
    // R23-6 fix (24 Oct 2026): og:image was missing — shared links
    // rendered without the Dlala image card. Standard site og image,
    // same as the other page types.
    openGraph: {
      title,
      url,
      type: 'website',
      images: [{ url: `${SITE}/icon-512.png` }],
    },
  };
}

// R54: the 60-cap moved client-side (WantedShell applies it after the
// language-dependent q filter).

async function getWanted(): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchWanted(120);
}

// js/wanted.js wantedVisible — verbatim logic.
function wantedVisible(l: ListingCard): boolean {
  return !!(
    l &&
    l.isWanted === true &&
    (l.status === 'available' || l.status === 'negotiating')
  );
}

// js/wanted.js wantedMatches — verbatim logic, split for R54.
//
// R54 (18 Oct 2026): the text-search (q) match is language-dependent, so it
// MUST NOT run server-side — the edge cache cannot vary by the dlala_lang
// cookie (K-M1 follow-up, verified live), and server filtering poisoned
// every locale. Server applies the language-invariant filters (cat/wilaya)
// only; the q text-match runs client-side in WantedShell via useLang()
// (same Round-107 pattern as the homepage/search shells).
function wantedMatchesServer(l: ListingCard, f: WantedFilters): boolean {
  if (!l) return false;
  const cat = l.categoryId || '';
  if (f.cat && cat !== f.cat) return false;
  if (f.wilaya !== '' && f.wilaya != null) {
    if (
      String(Number(l.wilayaCode || 0)) !== String(f.wilaya) &&
      !(l.isWanted === true && Number(l.wilayaCode || 0) === 0)
    )
      return false;
  }
  return true;
}

async function WantedLoader({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; wilaya?: string; q?: string }>;
}) {
  const sp = await searchParams;
  // R54: NO dlala_lang cookie read — SSR is language-invariant (Arabic).
  // The q text-match is language-dependent and runs client-side in
  // WantedShell; the server applies cat/wilaya only. The client re-applies
  // the 60-cap after its q filter, so the server passes the full
  // cat/wilaya-filtered window (≤120).
  const f: WantedFilters = {
    cat: sp.cat || '',
    wilaya: sp.wilaya || '',
    q: sp.q || '',
  };

  let docs: ListingCard[] = [];
  let error: string | null = null;
  try {
    docs = await getWanted();
  } catch {
    error = 'wanted-error';
  }

  const list = docs.filter((l) => wantedVisible(l) && wantedMatchesServer(l, f));

  return <WantedShell f={f} docs={list} error={error} />;
}

export default async function WantedPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; wilaya?: string; q?: string }>;
}) {
  // R54: skeleton dir follows the UI language client-side (WantedSkeleton
  // is a client component) — no dlala_lang cookie read in SSR.
  return (
    <Suspense fallback={<WantedSkeleton />}>
      <WantedLoader searchParams={searchParams} />
    </Suspense>
  );
}
