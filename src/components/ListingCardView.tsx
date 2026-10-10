'use client';

// Shared listing card renderer — used by the home feed (SSR + load-more).
// Moved from src/app/page.tsx (Round 39) so the client-side "load more"
// can render identical cards. All helpers used here are client-safe
// (pure functions + the TimeAgo client component).

import { cardTitle, cardImage, formatPrice, type ListingCard } from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import { catName } from '@/lib/categories';
import { dzPriceWords } from '@/lib/dz-price';
import { useLang, type Lang } from '@/lib/i18n';
import TimeAgo from '@/components/TimeAgo';
import FavoriteToggle from '@/components/FavoriteToggle';
import BlurUpImage from '@/components/BlurUpImage';
import { OwnBadge, ProBadge } from '@/components/CardMarkers';

// Round 107: wilaya name follows the UI language (js/home.js c[LANG] parity).
function wilayaName(code: number | undefined, lang: Lang): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string; fr: string; en: string }[]).find(
    (x) => x.code === Number(code)
  );
  return w ? `${w.code} - ${w[lang]}` : '';
}

export default function ListingCardView({ l }: { l: ListingCard }) {
  const { t, lang } = useLang();
  const img = cardImage(l);
  const reduced = l.priceReduced && (l.previousPrice || 0) > 0;
  const jobType = (l.answers && typeof l.answers.jobType === 'string' && l.answers.jobType) || '';
  const isSeeker = jobType === 'jobSeeker';
  const isOffer = jobType === 'jobOffer';
  const words = dzPriceWords(l.price || 0);
  const favCount = Number(l.favoriteCount) || 0;
  // Round 107: condition + category follow the UI language (trilingual parity).
  const cond =
    l.condition === 'new' ? t('condNew') : l.condition === 'good' ? t('condGood') : l.condition === 'used' ? t('condUsed') : '';
  const cat = catName(l.categoryId || '', lang);
  // js/market.js wantedCard: seekers keep their own blue badge, never stack
  // the orange wanted badge; wilayaCode 0 shows "كل الولايات".
  const showWantedBadge = !!l.isWanted && !isSeeker;
  const wilayaLabel = l.isWanted && !l.wilayaCode ? t('allWilayas') : wilayaName(l.wilayaCode, lang);
  const metaBits = [cond, cat, wilayaLabel].filter(Boolean).join(' · ');
  return (
    <a
      href={`/listing/${l.id}`}
      data-sid={l.sellerId || ''}
      className="block relative rounded-xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* HOM-4 parity (js/app.js markOwnCards): "yours" badge, positioned
          against the card (absolute vs this relative anchor). */}
      <OwnBadge sellerId={l.sellerId || ''} />
      <div className="relative aspect-[4/3] bg-zinc-100">
        {img ? (
          <BlurUpImage
            listing={l}
            img={img}
            alt={cardTitle(l)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
        )}
        {(showWantedBadge || l.status === 'sold' || l.isWholesale || reduced || isSeeker || isOffer) && (
          <div className="absolute top-2 right-2 flex flex-col items-start gap-1">
            {showWantedBadge && (
              <span className="rounded-full bg-orange-500 px-2.5 py-0.5 text-xs font-bold text-white">{t('wantedBadge')}</span>
            )}
            {l.status === 'sold' && (
              <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">{t('sold')}</span>
            )}
            {l.isWholesale && (
              <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">{t('wholesale')}</span>
            )}
            {reduced && (
              <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white">
                ▼ {t('priceReduced')}
              </span>
            )}
            {isSeeker && (
              <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white">
                {t('seekerBadge')}
              </span>
            )}
            {isOffer && (
              <span className="rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-bold text-white">
                {t('offerBadge')}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2">
          {/* Interactive favorite pill — Zak 21 Sep option B white-pill
              model (inline heart + count next to the price, pill first in
              RTL). Own listings and sold listings get no heart
              (js/app.js listingCard / stripOwnHearts parity). */}
          {l.status !== 'sold' && (
            <FavoriteToggle
              listingId={l.id}
              sellerId={l.sellerId || ''}
              initialCount={favCount}
              title={cardTitle(l)}
              price={l.price || 0}
              photoUrl={img}
            />
          )}
          <p className="font-bold text-emerald-700 text-lg">
            <span dir="ltr">{formatPrice(l.price || 0)}</span>
            {words && <small className="ms-1 font-normal text-zinc-500">({words})</small>}
          </p>
        </div>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">
          {cardTitle(l)}
          {/* 16 Sep 2026 parity (js/app.js markProCards): gold pro badge
              appended inside the card title for verified pro merchants. */}
          <ProBadge sellerId={l.sellerId || ''} />
        </h3>
        {metaBits && <p className="mt-1 text-xs text-zinc-600">{metaBits}</p>}
        <p className="mt-1 text-xs text-zinc-500">
          {l.createdAt ? <TimeAgo iso={l.createdAt.toISOString()} lang={lang} /> : ''}
        </p>
      </div>
    </a>
  );
}
