'use client';

import { memo } from 'react';
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

// 11 Oct 2026: memoized — prevents re-render storm on scroll/filter/lang change.
function ListingCardView({ l, eager, priority, gold }: { l: ListingCard; eager?: boolean; priority?: boolean; gold?: boolean }) {
  const { t, lang } = useLang();
  // Round 62: prefer the canonical server-resolved image (trimFeedCard);
  // cardImage(l) stays the fallback for cards that still carry the photo
  // arrays (/api/feed load-more, /api/search filters). Byte-identical value.
  const img = l.img ?? cardImage(l);
  const reduced = l.priceReduced && (l.previousPrice || 0) > 0;
  const jobType = (l.answers && typeof l.answers.jobType === 'string' && l.answers.jobType) || '';
  const isSeeker = jobType === 'jobSeeker';
  const isOffer = jobType === 'jobOffer';
  const words = dzPriceWords(l.price || 0);
  const favCount = Number(l.favoriteCount) || 0;
  // Round 137 (0.0.0.39 listingCard parity): meta is category + wilaya ONLY,
  // no condition (legacy: `${catName} · ${wilayaName}`).
  const cat = catName(l.categoryId || '', lang);
  // js/market.js wantedCard: seekers keep their own blue badge, never stack
  // the orange wanted badge; wilayaCode 0 shows "كل الولايات".
  const showWantedBadge = !!l.isWanted && !isSeeker;
  const wilayaLabel = l.isWanted && !l.wilayaCode ? t('allWilayas') : wilayaName(l.wilayaCode, lang);
  const metaBits = [cat, wilayaLabel].filter(Boolean).join(' · ');
  return (
    <a
      href={`/listing/${l.id}`}
      data-sid={l.sellerId || ''}
      className={`block relative rounded-xl bg-white border overflow-hidden hover:shadow-md transition-shadow ${gold ? 'border-amber-400' : 'border-[#e5e7eb]'}`}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* HOM-4 parity (js/app.js markOwnCards): "yours" badge, positioned
          against the card (absolute vs this relative anchor). */}
      <OwnBadge sellerId={l.sellerId || ''} />
      <div className="relative aspect-[4/3] bg-[#e8f0ec]">
        {img ? (
          <BlurUpImage
            listing={l}
            img={img}
            alt={cardTitle(l, lang)}
            eager={eager}
            priority={priority}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
        )}
        {(showWantedBadge || l.status === 'sold' || l.isWholesale || reduced || isSeeker || isOffer) && (
          <div className="absolute top-2 start-2 flex flex-col items-start gap-1">
            {showWantedBadge && (
              <span className="rounded-md bg-orange-500 px-2.5 py-0.5 text-xs font-bold text-white">{t('wantedBadge')}</span>
            )}
            {l.status === 'sold' && (
              <span className="rounded-md bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">{t('sold')}</span>
            )}
            {l.isWholesale && (
              <span className="rounded-md bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">{t('wholesale')}</span>
            )}
            {reduced && (
              <span className="rounded-md bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white">
                ▼ {t('priceReduced')}
              </span>
            )}
            {isSeeker && (
              <span className="rounded-md bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white">
                {t('seekerBadge')}
              </span>
            )}
            {isOffer && (
              <span className="rounded-md bg-emerald-700 px-2.5 py-0.5 text-xs font-bold text-white">
                {t('offerBadge')}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="px-3 pt-[10px] pb-[10px]">
        {/* Round 137 (0.0.0.39 .card-price-row parity): flex space-between,
            fav pill FIRST (right in RTL), price second. */}
        <div className="flex items-center justify-between gap-2">
          {/* Interactive favorite pill — Zak 21 Sep option B white-pill
              model (inline heart + count next to the price, pill first in
              RTL). Own listings and sold listings get no heart
              (js/app.js listingCard / stripOwnHearts parity). */}
          {l.status !== 'sold' && (
            <FavoriteToggle
              listingId={l.id}
              sellerId={l.sellerId || ''}
              initialCount={favCount}
              title={cardTitle(l, lang)}
              price={l.price || 0}
              photoUrl={img}
            />
          )}
          <div className={`font-extrabold text-base ${gold ? 'text-amber-600' : 'text-[#0b6b4f]'}`}>
            {/* Zak 18 Oct 2026: price ALWAYS shown (even "1 دج"). Darija words
                on line 2, never truncated. Negotiable badge moved to card bottom
                opposite the date (Zak 18 Oct). */}
            {/* 11 Oct 2026: job offers show salary/month, not price (0 DZD). */}
            {isOffer && typeof l.answers?.salary === 'number' ? (
              <p className="whitespace-nowrap">
                <span dir="ltr">{t('salaryPerMonth').replace('{x}', formatPrice(l.answers.salary, lang))}</span>
              </p>
            ) : (
              <>
                <p className="whitespace-nowrap font-extrabold"><bdi>{formatPrice(l.price || 0, lang)}</bdi></p>
                {words && Number(l.price) > 1 && (
                  <p className="text-xs font-normal text-zinc-500">({words})</p>
                )}
              </>
            )}
          </div>
        </div>
        <h3 className="mt-1 mb-1 text-sm text-zinc-900 whitespace-nowrap overflow-hidden text-ellipsis" style={{unicodeBidi: 'plaintext'}}>
          {cardTitle(l, lang)}
          {/* 16 Sep 2026 parity (js/app.js markProCards): gold pro badge
              appended inside the card title for verified pro merchants. */}
          <ProBadge sellerId={l.sellerId || ''} />
        </h3>
        {metaBits && <p className="mt-1 text-xs text-zinc-600">{metaBits}</p>}
        {/* Zak 18 Oct 2026: bottom row — date on one side, negotiable badge
            on the opposite side (flex justify-between handles RTL). */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-500">
            {/* Round 139: createdAt may be a JSON-round-tripped ISO string
                (e.g. cards appended from /api/feed) — never assume Date. */}
            {l.createdAt ? (
              <TimeAgo
                iso={l.createdAt instanceof Date ? l.createdAt.toISOString() : String(l.createdAt)}
                lang={lang}
              />
            ) : (
              ''
            )}
          </p>
          {(l.negotiable || Number(l.price) <= 1) && (
            <span className="text-xs font-normal bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 whitespace-nowrap">{t('negotiable')}</span>
          )}
        </div>
      </div>
    </a>
  );
}

export default memo(ListingCardView);
