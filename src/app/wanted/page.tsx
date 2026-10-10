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

import { Suspense } from 'react';
import { cacheLife } from 'next/cache';
import {
  fetchWanted,
  normSearchText,
  type ListingCard,
} from '@/lib/firestore';
import ListingCardView from '@/components/ListingCardView';
import WantedFilterBar from './WantedFilterBar';

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

interface Filters {
  cat: string;
  wilaya: string;
  q: string;
}

// js/wanted.js wantedMatches — verbatim logic.
function wantedMatches(l: ListingCard, f: Filters): boolean {
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

async function WantedContent({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; wilaya?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const f: Filters = {
    cat: sp.cat || '',
    wilaya: sp.wilaya || '',
    q: sp.q || '',
  };

  let docs: ListingCard[] = [];
  let error: string | null = null;
  try {
    docs = await getWanted();
  } catch (e) {
    error = e instanceof Error ? e.message : 'wanted-error';
  }

  const list = docs
    .filter((l) => wantedVisible(l) && wantedMatches(l, f))
    .slice(0, WANTED_LIMIT);

  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-zinc-900">مطلوب</h1>
          <a
            href="/publish?mode=wanted"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 transition-colors"
          >
            انشر إعلان مطلوب
          </a>
        </div>

        <WantedFilterBar f={f} />

        {error ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
            تعذر تحميل الإعلانات ({error}). حاول مرة أخرى.
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl bg-white p-10 text-center text-zinc-500">
            لا توجد إعلانات مطلوبة حاليا.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {list.map((l) => (
              <ListingCardView key={l.id} l={l} />
            ))}
          </div>
        )}
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
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-50" dir="rtl">
          <div className="max-w-6xl mx-auto px-4 py-16 text-center text-zinc-500">
            جارٍ التحميل...
          </div>
        </div>
      }
    >
      <WantedContent searchParams={searchParams} />
    </Suspense>
  );
}
