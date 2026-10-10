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
  normSearchText,
  type ListingCard,
} from '@/lib/firestore';
import WantedShell from './WantedShell';
import type { WantedFilters } from './WantedFilterBar';

const WANTED_LIMIT = 60;

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

// js/wanted.js wantedMatches — verbatim logic.
function wantedMatches(l: ListingCard, f: WantedFilters): boolean {
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
  const q = normSearchText(f.q);
  if (q) {
    const title =
      l.title && typeof l.title === 'object' ? l.title.ar || '' : '';
    const desc =
      l.description && typeof l.description === 'object'
        ? l.description.ar || ''
        : '';
    const hay = normSearchText(title + ' ' + desc);
    if (!hay.includes(q)) return false;
  }
  return true;
}

async function WantedLoader({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; wilaya?: string; q?: string }>;
}) {
  const sp = await searchParams;
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

  const list = docs
    .filter((l) => wantedVisible(l) && wantedMatches(l, f))
    .slice(0, WANTED_LIMIT);

  return <WantedShell f={f} docs={list} error={error} />;
}

// Visual skeleton — no text, so no language dependency (search-page parity).
function WantedSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-white shadow-sm overflow-hidden"
            >
              <div className="aspect-[4/3] bg-zinc-200 animate-pulse" />
              <div className="p-3">
                <div className="h-5 bg-zinc-200 rounded animate-pulse w-1/2" />
                <div className="mt-2 h-4 bg-zinc-200 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function WantedPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; wilaya?: string; q?: string }>;
}) {
  return (
    <Suspense fallback={<WantedSkeleton />}>
      <WantedLoader searchParams={searchParams} />
    </Suspense>
  );
}
