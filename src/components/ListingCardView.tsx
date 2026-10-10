'use client';

// Shared listing card renderer — used by the home feed (SSR + load-more).
// Moved from src/app/page.tsx (Round 39) so the client-side "load more"
// can render identical cards. All helpers used here are client-safe
// (pure functions + the TimeAgo client component).

import { cardTitle, cardImage, formatPrice, type ListingCard } from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import { catName } from '@/lib/categories';
import { dzPriceWords } from '@/lib/dz-price';
import TimeAgo from '@/components/TimeAgo';

function wilayaName(code: number | undefined): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string }[]).find((x) => x.code === Number(code));
  return w ? `${w.code} - ${w.ar}` : '';
}

export default function ListingCardView({ l }: { l: ListingCard }) {
  const img = cardImage(l);
  const reduced = l.priceReduced && (l.previousPrice || 0) > 0;
  const jobType = (l.answers && typeof l.answers.jobType === 'string' && l.answers.jobType) || '';
  const isSeeker = jobType === 'jobSeeker';
  const isOffer = jobType === 'jobOffer';
  const words = dzPriceWords(l.price || 0);
  const favCount = Number(l.favoriteCount) || 0;
  const cond =
    l.condition === 'new' ? 'جديد' : l.condition === 'good' ? 'جيد' : l.condition === 'used' ? 'مستعمل' : '';
  const cat = catName(l.categoryId || '');
  // js/market.js wantedCard: seekers keep their own blue badge, never stack
  // the orange wanted badge; wilayaCode 0 shows "كل الولايات".
  const showWantedBadge = !!l.isWanted && !isSeeker;
  const wilayaLabel = l.isWanted && !l.wilayaCode ? 'كل الولايات' : wilayaName(l.wilayaCode);
  const metaBits = [cond, cat, wilayaLabel].filter(Boolean).join(' · ');
  return (
    <a
      href={`/listing/${l.id}`}
      data-sid={l.sellerId || ''}
      className="block rounded-xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      dir="rtl"
    >
      <div className="relative aspect-[4/3] bg-zinc-100">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={cardTitle(l)}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
        )}
        {(showWantedBadge || l.status === 'sold' || l.isWholesale || reduced || isSeeker || isOffer) && (
          <div className="absolute top-2 right-2 flex flex-col items-start gap-1">
            {showWantedBadge && (
              <span className="rounded-full bg-orange-500 px-2.5 py-0.5 text-xs font-bold text-white">مطلوب</span>
            )}
            {l.status === 'sold' && (
              <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">مباع</span>
            )}
            {l.isWholesale && (
              <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">الجملة</span>
            )}
            {reduced && (
              <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white">
                ▼ انخفض السعر
              </span>
            )}
            {isSeeker && (
              <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white">
                باحث عن عمل
              </span>
            )}
            {isOffer && (
              <span className="rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-bold text-white">
                عرض عمل
              </span>
            )}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2">
          {/* fav pill — Zak 21 Sep option B: white pill with ♡ + count next to
              the price, pill first (right in RTL). Display-only on this SSR
              home page: the interactive toggle needs a client component with
              auth (follow-up parity block). */}
          {l.status !== 'sold' && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-600 shadow-sm"
              aria-label={`المفضلة: ${favCount}`}
            >
              <span aria-hidden="true">♡</span>
              <span>{favCount}</span>
            </span>
          )}
          <p className="font-bold text-emerald-700 text-lg">
            <span dir="ltr">{formatPrice(l.price || 0)}</span>
            {words && <small className="ms-1 font-normal text-zinc-500">({words})</small>}
          </p>
        </div>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">{cardTitle(l)}</h3>
        {metaBits && <p className="mt-1 text-xs text-zinc-600">{metaBits}</p>}
        <p className="mt-1 text-xs text-zinc-500">
          {l.createdAt ? <TimeAgo iso={l.createdAt.toISOString()} /> : ''}
        </p>
      </div>
    </a>
  );
}
