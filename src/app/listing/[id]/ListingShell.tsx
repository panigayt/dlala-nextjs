'use client';

// Trilingual shell fragments for the listing detail page (js/listing.js +
// js/i18n.js parity, Round 115).
//
// The page itself stays a Server Component (SSR + ISR for SEO). The server
// always renders Arabic; these small fragments re-render in the viewer's
// language via useLang() — the same pattern every other trilingual page
// uses (server snapshot 'ar', client re-render on hydration).

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLang, type Lang } from '@/lib/i18n';
import { WILAYAS } from '@/lib/wilayas';
import { dzPriceWords } from '@/lib/dz-price';
import {
  viewsText,
  formatPrice,
  cardTitle,
  cardImage,
  type ListingCard,
  type SellerProfile,
} from '@/lib/firestore';
import { isConditionExempt } from '@/lib/seo';
import { catName } from '@/lib/categories';
import { answerRows } from '@/lib/answers';
import TimeAgo from '@/components/TimeAgo';
import BlurUpImage from '@/components/BlurUpImage';
import FollowButton from '@/components/FollowButton';
import ReportUserButton from '@/components/ReportUserButton';

// js/app.js wilayaName() — the port's server helper only knew Arabic;
// the label follows the UI language (alerts page parity).
export function wilayaNameLang(
  code: number | undefined,
  lang: Lang
): string {
  if (!code) return '';
  const w = (
    WILAYAS as { code: number; ar: string; fr: string; en: string }[]
  ).find((x) => x.code === Number(code));
  return w ? `${w.code} - ${w[lang] || w.ar}` : '';
}

// js/app.js condLabel() verbatim: new → condNew, good → condGood, else condUsed.
function condLabel(c: string, t: (k: string) => string): string {
  return c === 'new' ? t('condNew') : c === 'good' ? t('condGood') : t('condUsed');
}

// Page root — dir follows the UI language (was hardcoded rtl).
export function ListingDir({ children }: { children: React.ReactNode }) {
  const { lang } = useLang();
  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {children}
    </div>
  );
}

// LIS-1 sold banner (legacy t('soldNotice')).
export function SoldBanner() {
  const { t, lang } = useLang();
  return (
    <div
      className="bg-[#7a1f1f] text-white px-[14px] py-[10px] rounded-[10px] mb-3 font-bold text-center"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      {t('soldNotice')}
    </div>
  );
}

// Meta grid: wilaya / condition / published labels + values.
// 14 Oct 2026 (Zak ordered «اضفهم»): also category + price rows —
// production 0.0.0.39 parity (D4). Appended after the existing rows;
// existing row order untouched.
export function MetaGrid({
  wilayaCode,
  condition,
  categoryId,
  createdAtISO,
  answers,
  isWanted,
  negotiable,
  price,
}: {
  wilayaCode?: number;
  condition?: string;
  categoryId?: string;
  createdAtISO?: string | null;
  answers?: Record<string, unknown> | null;
  isWanted?: boolean;
  negotiable?: boolean;
  price?: number;
}) {
  const { t, lang } = useLang();
  const showCond =
    !!condition && !isConditionExempt(categoryId, answers ?? undefined);
  // For wanted ads without a wilaya, show "All wilayas"
  const wilayaDisplay = wilayaCode
    ? wilayaNameLang(wilayaCode, lang)
    : isWanted
      ? t('allWilayas')
      : '';
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
      <div>
        <span className="text-zinc-500">{t('wilaya')}: </span>
        <b>{wilayaDisplay}</b>
      </div>
      {showCond && (
        <div>
          <span className="text-zinc-500">{t('condition')}: </span>
          <b>{condLabel(condition!, t)}</b>
        </div>
      )}
      {createdAtISO && (
        <div>
          <span className="text-zinc-500">{t('publishedOn')}: </span>
          <b>
            <TimeAgo iso={createdAtISO} lang={lang} />
          </b>
        </div>
      )}
      {/* 0.0.0.39 parity rows (Zak «اضفهم» 14 Oct 2026). Production always
          shows the price row: «قابل للتفاوض» when negotiable, else the price
          (its restorePricePair injects the price row for non-negotiable). */}
      {categoryId && (
        <div>
          <span className="text-zinc-500">{t('category')}: </span>
          <b>{catName(categoryId, lang)}</b>
        </div>
      )}
      {/* Zak 18 Oct 2026 (explicit order, overriding CA-D1): ALWAYS show the
          price (even "1 دج") + badge when negotiable OR price <= 1
          (1 DZD = negotiable). */}
      <div>
        <span className="text-zinc-500">{t('price')}: </span>
        {/* Zak 18 Oct 2026: ALWAYS show the price (even "1 دج") + badge. */}
        <b className="whitespace-nowrap">
          <span dir="ltr">{formatPrice(price || 0, lang)}</span>
          {(negotiable || Number(price) <= 1) && (
            <span className="ms-1 text-xs font-normal bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 whitespace-nowrap align-middle">{t('negotiable')}</span>
          )}
        </b>
      </div>
    </div>
  );
}

// js/app.js FIX-WEB-025 stat-row parity.
// AY-1 (18 Oct 2026): favorite-toggle event bridge. The heart button lives
// in ListingActions (lazy chunk, ListingActions.tsx), the count pill here —
// both would otherwise disagree until reload. The toggle emits this window
// event on every optimistic flip AND on every server reconcile, so the StatRow
// count moves on tap exactly like the feed card's FavoriteToggle (optimistic
// ±1), and can never stick on a failed optimistic flip.
export const FAV_CHANGE_EVENT = 'dlala:favchange';
export function emitFavChange(listingId: string, fav: boolean) {
  try {
    window.dispatchEvent(
      new CustomEvent(FAV_CHANGE_EVENT, { detail: { listingId, fav } })
    );
  } catch {
    /* non-fatal */
  }
}

export function StatRow({
  listingId,
  views,
  favoriteCount,
}: {
  listingId?: string;
  views?: number | null;
  favoriteCount?: number | null;
}) {
  const { t, lang } = useLang();
  // AY-1: optimistic count. base = SSR server count; the latest favchange
  // event for this listing adds/removes the viewer's own favorite (±1).
  // null = no toggle yet this session → show the server count as-is.
  const base = Math.max(0, Number(favoriteCount) || 0);
  const [favOn, setFavOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!listingId) return;
    const onFav = (e: Event) => {
      const d = (e as CustomEvent).detail as
        | { listingId?: string; fav?: boolean }
        | undefined;
      if (d && d.listingId === listingId) setFavOn(!!d.fav);
    };
    window.addEventListener(FAV_CHANGE_EVENT, onFav);
    return () => window.removeEventListener(FAV_CHANGE_EVENT, onFav);
  }, [listingId]);
  const count = Math.max(
    0,
    base + (favOn === true ? 1 : favOn === false ? -1 : 0)
  );
  // 23 Oct 2026 (Zak): public counters render only past their proof
  // thresholds — views >= 100, favorites >= 1. Below them the stat-row is
  // absent entirely (zero counts read as an empty site). Counting itself,
  // the seller's private stats and the ranking signal are untouched.
  const showViews = (Number(views) || 0) >= 100;
  const showFav = count >= 1;
  if (!showViews && !showFav) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-1 text-[13px] text-zinc-500">
      {showViews && <span>👁 {viewsText(views, lang)}</span>}
      {showFav && (
        <span>
          ♥ {count} {t('inFavorites')}
        </span>
      )}
    </div>
  );
}

// Listing seller card body (js/listing.js loadSeller parity):
// identity + follow + rating row + view-store/page + report-user buttons.
export function SellerCardBody({
  sellerId,
  profile,
  denormName,
  denormPhoto,
}: {
  sellerId: string;
  profile: SellerProfile | null;
  denormName?: string;
  denormPhoto?: string;
}) {
  const { t } = useLang();
  const isPro = profile?.storeTier === 'verified';
  // 18 Sep 2026 (Zak): verified pro sellers show their STORE name.
  const displayName =
    (isPro && profile?.storeName ? profile.storeName : profile?.name) || null;
  const name = displayName || denormName || t('viewProfile');
  // 0.0.0.31 FIX-WEB-027: no orphan line — hidden when there is neither
  // a rating nor a verified badge.
  const ratingNum = Number(profile?.rating);
  const hasRating = isFinite(ratingNum) && ratingNum > 0;
  const ratingTxt = hasRating ? ratingNum.toFixed(1) + ' ★' : '';
  const rating = profile?.ratingCount
    ? `${ratingTxt} (${Number(profile.ratingCount) || 0})`
    : ratingTxt;
  const ratingRow =
    ratingTxt || profile?.verified === true
      ? `${rating}${profile?.verified === true ? ' ✓' : ''}`.trim()
      : null;
  return (
    <>
      <h2 className="text-lg font-semibold">{t('seller')}</h2>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {denormPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={denormPhoto}
              alt=""
              className="w-12 h-12 rounded-full object-cover shrink-0"
            />
          )}
          <span className="font-bold truncate text-zinc-900">
            <Link
              href={`/seller/${sellerId}`}
              className="hover:underline"
            >
              {name}
            </Link>
            {isPro && (
              <span className="pro-badge">★ {t('proMerchant')}</span>
            )}
          </span>
        </div>
        <div className="shrink-0">
          <FollowButton storeUid={sellerId} className="listing-follow-btn" />
        </div>
      </div>
      {ratingRow && <p className="mt-1 text-sm text-zinc-500">{ratingRow}</p>}
      {/* Round 138: legacy .seller-card .btn parity — solid emerald
          view-store/page (flex:1), #eef4f1 report-user; 8px padding,
          12.5px font, 8px radius (style-listing.css).
          Round 58 (18 Oct 2026): 44px min touch target (was ~35px). */}
      <div className="mt-2 flex gap-2">
        <Link
          href={`/seller/${sellerId}`}
          className="flex-1 rounded-lg bg-[#0b6b4f] px-2 py-2 text-[12.5px] font-bold text-white text-center hover:bg-[#085c43] min-h-[44px] inline-flex items-center justify-center"
        >
          {isPro ? t('viewStore') : t('viewProfile')}
        </Link>
        <ReportUserButton
          uid={sellerId}
          targetTitle={displayName || ''}
          className="flex-1 rounded-lg bg-[#eef4f1] px-2 py-2 text-[12.5px] font-bold text-[#0b6b4f] text-center hover:bg-[#dfe9e4] min-h-[44px] inline-flex items-center justify-center"
        />
      </div>
    </>
  );
}

// Description body — js/app.js localizedText() verbatim:
// map[LANG] || map.ar || map.fr || map.en || ''.
export function ListingDescription({
  description,
}: {
  description: unknown;
}) {
  const { lang } = useLang();
  let text = '';
  if (description && typeof description === 'object') {
    const m = description as Record<string, string>;
    text = m[lang] || m.ar || m.fr || m.en || '';
  } else if (typeof description === 'string') {
    text = description;
  }
  if (!text) return null;
  // 17 Oct 2026: phone numbers in RTL descriptions render backwards
  // ("0560 93 83 70" → "70 83 93 0560") on iOS Safari despite U+2066/2069
  // isolates. Fix: split into lines; render digit-heavy lines (phone
  // numbers) inside <bdi> for proper bidi isolation.
  const lines = text.split('\n');
  const isPhoneLine = (l: string) => /^[\d\s+().-]{7,}$/.test(l.trim());
  return (
    <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
      <ListingH2 k="description" />
      <p className="whitespace-pre-wrap break-words text-zinc-800" style={{ overflowWrap: 'anywhere' }}>
        {lines.map((l, i) => (
          <span key={i}>
            {isPhoneLine(l) ? <bdi dir="ltr">{l}</bdi> : l}
            {i < lines.length - 1 && '\n'}
          </span>
        ))}
      </p>
    </div>
  );
}

// Section headings (description / details).
export function ListingH2({ k }: { k: 'description' | 'details' }) {
  const { t } = useLang();
  return <h2 className="text-lg font-semibold mb-2">{t(k)}</h2>;
}

// Structured answers box (js/app.js renderAnswers parity) — labels follow
// the UI language via PUB_STR ar/fr/en.
export function AnswersBox({
  answers,
}: {
  answers: Record<string, unknown> | undefined | null;
}) {
  const { lang } = useLang();
  const rows = answerRows(answers, lang);
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
      <ListingH2 k="details" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 mt-2 text-sm">
        {rows.map((r, i) => (
          <div key={i} className="contents">
            <dt className="text-zinc-500">{r.label}</dt>
            <dd className="text-zinc-900">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Similar-ads card (client — needs useLang for wilaya/timeago/dir).
function SimilarCard({ l }: { l: ListingCard }) {
  const { t, lang } = useLang();
  const img = cardImage(l);
  // 11 Oct 2026: pass lang — titles were always Arabic.
  const title = cardTitle(l, lang);
  // Round 128 (js/app.js listingCard priceWordsHtml parity): similar ads
  // use the full card renderer in legacy, so they carry the Darija
  // parenthetical too.
  const words = dzPriceWords(l.price || 0);
  return (
    <Link
      href={`/listing/${l.id}`}
      className="block rounded-xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="relative aspect-[4/3] bg-zinc-100">
        {img ? (
          // 12 Oct 2026 (Round 9): BlurUpImage parity with ListingCardView —
          // broken images get the placeholder fallback instead of a broken icon.
          <BlurUpImage
            listing={l}
            img={img}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">
            📷
          </div>
        )}
      </div>
      <div className="p-3">
        {/* Zak 18 Oct 2026: price ALWAYS shown. Negotiable badge moved to
            bottom opposite date (Zak 18 Oct). */}
        <div className="font-bold text-emerald-700 text-lg">
          <p className="whitespace-nowrap">
            <span dir="ltr">{formatPrice(l.price || 0, lang)}</span>
          </p>
          {words && Number(l.price) > 1 && (
            <p className="text-xs font-normal text-zinc-500">({words})</p>
          )}
        </div>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">
          {title}
        </h3>
        {/* Zak 18 Oct 2026: bottom row — date/wilaya on one side, negotiable
            badge on the opposite side. */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-500">
            {wilayaNameLang(l.wilayaCode, lang)}
            {l.createdAt ? (
              <>
                {' · '}
                <TimeAgo
                  iso={
                    l.createdAt instanceof Date
                      ? l.createdAt.toISOString()
                      : String(l.createdAt)
                  }
                  lang={lang}
                />
              </>
            ) : (
              ''
            )}
          </p>
          {(l.negotiable || Number(l.price) <= 1) && (
            <span className="text-xs font-normal bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 whitespace-nowrap">{t('negotiable')}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

// Similar-ads section (js/listing.js loadMatches regular branch).
export function SimilarAds({ items }: { items: ListingCard[] }) {
  const { t } = useLang();
  return (
    <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
      <h2 className="text-lg font-semibold mb-4">{t('similarAds')}</h2>
      {items.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((s) => (
            <SimilarCard key={s.id} l={s} />
          ))}
        </div>
      ) : (
        <p className="text-zinc-500">{t('noSimilarAds')}</p>
      )}
    </div>
  );
}
