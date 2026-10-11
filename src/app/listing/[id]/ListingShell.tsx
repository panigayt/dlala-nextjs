'use client';

// Trilingual shell fragments for the listing detail page (js/listing.js +
// js/i18n.js parity, Round 115).
//
// The page itself stays a Server Component (SSR + ISR for SEO). The server
// always renders Arabic; these small fragments re-render in the viewer's
// language via useLang() — the same pattern every other trilingual page
// uses (server snapshot 'ar', client re-render on hydration).

import Link from 'next/link';
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
import { answerRows } from '@/lib/answers';
import TimeAgo from '@/components/TimeAgo';
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
export function MetaGrid({
  wilayaCode,
  condition,
  categoryId,
  createdAtISO,
  answers,
  isWanted,
}: {
  wilayaCode?: number;
  condition?: string;
  categoryId?: string;
  createdAtISO?: string | null;
  answers?: Record<string, unknown> | null;
  isWanted?: boolean;
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
    </div>
  );
}

// js/app.js FIX-WEB-025 stat-row parity.
export function StatRow({
  views,
  favoriteCount,
}: {
  views?: number | null;
  favoriteCount?: number | null;
}) {
  const { t, lang } = useLang();
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-1 text-[13px] text-zinc-500">
      <span>👁 {viewsText(views, lang)}</span>
      <span>
        ♥ {Math.max(0, Number(favoriteCount) || 0)} {t('inFavorites')}
      </span>
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
        <div className="shrink-0 min-w-[120px]">
          <FollowButton storeUid={sellerId} />
        </div>
      </div>
      {ratingRow && <p className="mt-1 text-sm text-zinc-500">{ratingRow}</p>}
      {/* Round 138: legacy .seller-card .btn parity — solid emerald
          view-store/page (flex:1), #eef4f1 report-user; 8px padding,
          12.5px font, 8px radius (style-listing.css). */}
      <div className="mt-2 flex gap-2">
        <Link
          href={`/seller/${sellerId}`}
          className="flex-1 rounded-lg bg-[#0b6b4f] px-2 py-2 text-[12.5px] font-bold text-white text-center hover:bg-[#085c43]"
        >
          {isPro ? t('viewStore') : t('viewProfile')}
        </Link>
        <ReportUserButton
          uid={sellerId}
          targetTitle={displayName || ''}
          className="flex-1 rounded-lg bg-[#eef4f1] px-2 py-2 text-[12.5px] font-bold text-[#0b6b4f] text-center hover:bg-[#dfe9e4]"
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
  return (
    <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
      <ListingH2 k="description" />
      <p className="whitespace-pre-wrap text-zinc-800">{text}</p>
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
  const { lang } = useLang();
  const img = cardImage(l);
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={cardTitle(l)}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">
            📷
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="font-bold text-emerald-700 text-lg">
          <span dir="ltr">{formatPrice(l.price || 0)}</span>
          {words && <small className="ms-1 font-normal text-zinc-500">({words})</small>}
        </p>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">
          {cardTitle(l)}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
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
