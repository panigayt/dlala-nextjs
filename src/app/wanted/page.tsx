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
import Link from 'next/link';
import {
  fetchWanted,
  normSearchText,
  cardTitle,
  cardImage,
  formatPrice,
  type ListingCard,
} from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES } from '@/lib/categories';
import TimeAgo from '@/components/TimeAgo';
import BlurUpImage from '@/components/BlurUpImage';
import WilayaSelect from './WilayaSelect';

const WANTED_LIMIT = 60;

async function getWanted(): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchWanted(120);
}

function wilayaName(code: number | undefined): string {
  const n = Number(code || 0);
  if (n === 0) return 'كل الولايات';
  const w = WILAYAS.find((x) => x.code === n);
  return w ? `${w.code} - ${w.ar}` : '';
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

function WantedCard({ l }: { l: ListingCard }) {
  const img = cardImage(l);
  return (
    <a
      href={`/listing/${l.id}`}
      className="block rounded-xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      dir="rtl"
    >
      <div className="relative aspect-[4/3] bg-zinc-100">
        {img ? (
          <BlurUpImage
            listing={l}
            img={img}
            alt={cardTitle(l)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">
            📷
          </div>
        )}
        <span className="absolute top-2 right-2 rounded-full bg-amber-500 text-white text-xs font-bold px-2.5 py-1">
          مطلوب
        </span>
      </div>
      <div className="p-3">
        <p className="font-bold text-emerald-700 text-lg">
          {formatPrice(l.price || 0)}
        </p>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">
          {cardTitle(l)}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          {wilayaName(l.wilayaCode)}
          {l.createdAt ? (
            <>
              {' · '}
              <TimeAgo iso={l.createdAt.toISOString()} />
            </>
          ) : (
            ''
          )}
        </p>
      </div>
    </a>
  );
}

function FilterBar({ f }: { f: Filters }) {
  const chipCls = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
      active
        ? 'bg-emerald-700 text-white'
        : 'bg-white text-zinc-700 border border-zinc-200 hover:border-emerald-400'
    }`;

  const params = (over: Partial<Filters>) => {
    const p = new URLSearchParams();
    const nf = { ...f, ...over };
    if (nf.cat) p.set('cat', nf.cat);
    if (nf.wilaya) p.set('wilaya', nf.wilaya);
    if (nf.q) p.set('q', nf.q);
    const s = p.toString();
    return s ? `/wanted?${s}` : '/wanted';
  };

  return (
    <div className="mb-5 space-y-3">
      <form action="/wanted" method="get" className="flex gap-2">
        {f.cat ? <input type="hidden" name="cat" value={f.cat} /> : null}
        {f.wilaya ? <input type="hidden" name="wilaya" value={f.wilaya} /> : null}
        <input
          name="q"
          defaultValue={f.q}
          placeholder="ابحث..."
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 text-base"
        />
        <button
          type="submit"
          className="rounded-lg bg-emerald-700 px-5 py-2.5 font-bold text-white hover:bg-emerald-800 transition-colors"
        >
          بحث
        </button>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Link href={params({ cat: '' })} className={chipCls(!f.cat)}>
          كل الأقسام
        </Link>
        {CATEGORIES.map((c) => (
          <Link key={c.id} href={params({ cat: c.id })} className={chipCls(f.cat === c.id)}>
            {c.ar}
          </Link>
        ))}
      </div>

      <WilayaSelect f={f} />
    </div>
  );
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

        <FilterBar f={f} />

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
              <WantedCard key={l.id} l={l} />
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
