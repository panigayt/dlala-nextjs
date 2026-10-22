'use client';

// Seller profile page — client shell (Round 111: trilingual AR/FR/EN,
// js/i18n.js + js/seller.js parity).
//
// Pattern (Round 107 home / Round 109 search): the server page only fetches
// the seller doc, listings and ratings — all language-dependent rendering
// lives here via useLang(), so a header language switch re-renders the
// whole profile (js/i18n.js onLangChange parity).
//
// The markup is the verbatim port of the previous server components
// (NotFoundView / StoreHero / SellerProfileCard / SellerInfosTab) with
// every Arabic string replaced by t(key).

import Link from 'next/link';
import { useState } from 'react';
import { useLang, type Lang } from '@/lib/i18n';
import FollowButton from '@/components/FollowButton';
import RateCta from '@/components/RateCta';
import ReportUserButton from '@/components/ReportUserButton';
import StoreAnalytics from '@/components/StoreAnalytics';
import RecentFollowers from '@/components/RecentFollowers';
import SellerActions, { ShareIconButton } from '@/app/seller/[uid]/SellerActions';
import RatingsList from '@/app/seller/[uid]/RatingsList';
import SellerTabsSection from '@/app/seller/[uid]/SellerTabsSection';
import {
  type ListingCard,
  type SellerProfile,
  type SellerRating,
} from '@/lib/firestore';

// js/seller.js localeDate parity (I-07): ar-DZ / fr-FR / en-US.
function dateLocale(lang: Lang): string {
  return lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-US';
}

function memberSinceOf(s: SellerProfile, lang: Lang): string {
  if (!(s.createdAt instanceof Date) || isNaN(s.createdAt.getTime())) return '';
  try {
    return s.createdAt.toLocaleDateString(dateLocale(lang), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    const d = s.createdAt;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

// Cover URLs are injected into a style attribute — allow https:// only and
// strip quotes (cssSafeUrl parity from js/seller.js).
function cssSafeUrl(u: string | undefined): string {
  const s = String(u || '');
  if (!/^https:\/\//i.test(s)) return '';
  return s.replace(/["']/g, '');
}

// js/seller.js storeLogoSrc parity: store logo, else account photo, else ''.
function storeLogoSrc(s: SellerProfile): string {
  const logo = String(s.storeLogoUrl || '');
  if (logo && /^https:\/\//i.test(logo)) return logo;
  const photo = String(s.photoUrl || s.photoPath || '');
  if (photo && /^https:\/\//i.test(photo)) return photo;
  return '';
}

function NotFoundView() {
  const { t, lang } = useLang();
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="text-6xl font-bold text-emerald-700">D</div>
      <h1 className="mt-4 text-4xl font-bold">404</h1>
      <h2 className="mt-2 text-xl">{t('sellerNotFound')}</h2>
      <p className="mt-2 text-zinc-600">{t('sellerNotFoundHint')}</p>
      <div className="mt-6">
        <Link href="/" className="inline-block rounded-lg bg-emerald-700 text-white px-6 py-3 font-medium">
          {t('browseAds')}
        </Link>
      </div>
    </div>
  );
}

// ---------- pro-store hero (js/seller.js renderStoreHero parity) ----------
// Royal Gold Boutique — Design A (chosen by Zak 16 Sep 2026). Verbatim
// structure of the production hero: boutique-hero card, identity row
// (logo + name + pro badge + bio + delivery), meta row (rating / deals /
// followers / member-since), actions row (follow + share icon only).
// Production shows NO verification checkmark in the hero and NO
// block/report buttons there (report lives in the Infos tab for pro).

function StoreHero({ s, uid }: { s: SellerProfile; uid: string }) {
  const { t, lang } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const displayName = s.storeName || s.name || s.username || '';
  const logo = storeLogoSrc(s);
  // 12 Oct 2026: broken-logo fallback (was broken-image icon).
  const [logoBroken, setLogoBroken] = useState(false);
  const cover = cssSafeUrl(s.storeCoverUrl);
  const bio = String(s.storeBio || '');
  const ratingNum = Number(s.rating);
  const ratingTxt = s.ratingCount
    ? isFinite(ratingNum)
      ? ratingNum.toFixed(1)
      : '—'
    : '—';
  const deals = Number(s.confirmedDeals) || 0;
  const followersCount = Number(s.followerCount) || 0;
  const memberSince = memberSinceOf(s, lang);

  return (
    <div className="boutique-hero boutique-compact boutique-store" dir={dir}>
      {cover && (
        <div
          className="store-cover-hero"
          style={{ backgroundImage: `url("${cover}")` }}
          role="img"
          aria-label={displayName}
        />
      )}
      <div className={`bh-idrow${cover ? ' bh-overlap' : ''}`}>
        {logo && !logoBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={displayName}
            className="store-logo"
            onError={() => setLogoBroken(true)}
          />
        ) : (
          <div className="store-logo store-logo-letter" aria-hidden="true">
            {displayName ? displayName.charAt(0) : '?'}
          </div>
        )}
        <div className="bh-id">
          <h1 className="bh-name">{displayName}</h1>
          <div className="bh-sub">
            <span className="pro-badge">★ {t('proMerchant')}</span>
          </div>
          {bio && <p className="store-bio-hero">{bio}</p>}
          <div className="bh-sub">🚚 {t('deliveryAllWilayas')}</div>
        </div>
      </div>

      <div className="bh-meta">
        <span>
          ★ <b>{ratingTxt}</b> {t('rating')}
        </span>
        <span>
          🤝 <b>{deals}</b> {t('dealsConfirmed')}
        </span>
        {/* Round 29 D4 (18 Oct 2026): hide the zero count, matching the
            ordinary seller card below — zero followers shows nothing. */}
        {followersCount > 0 && (
          <span className="boutique-fcount">
            👥 <b>{followersCount}</b> {t('followers')}
          </span>
        )}
        <span className="bh-since">
          {t('memberSince')}: {memberSince}
        </span>
      </div>

      <div className="bh-actions-row">
        <div className="bh-follow-wrap">
          <FollowButton storeUid={uid} className="bh-follow-btn" />
        </div>
        <ShareIconButton uid={uid} storeName={displayName} />
      </div>
    </div>
  );
}

function SellerProfileCard({ s }: { s: SellerProfile }) {
  const { t, lang } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const ratingNum = Number(s.rating);
  const hasRating = isFinite(ratingNum) && ratingNum > 0;
  const ratingTxt = hasRating ? ratingNum.toFixed(1) + ' ★' : '';
  const rating = s.ratingCount
    ? `${ratingTxt} (${Number(s.ratingCount) || 0})`
    : ratingTxt;
  // Verified pro sellers show their store name (matches production SPA).
  const displayName =
    s.storeTier === 'verified' && s.storeName ? s.storeName : s.name || s.username || '';
  // 11 Oct 2026: also check photoPath (legacy parity — ordinary avatars use photoPath).
  const photo = s.photoUrl || (s as { photoPath?: string }).photoPath || '';
  // 12 Oct 2026: broken-photo fallback (was broken-image icon).
  const [photoBroken, setPhotoBroken] = useState(false);
  // js/seller.js parity: legacy accepts verified===true OR emailVerified===true.
  const isVerified = s.verified === true || s.emailVerified === true;
  const followersCount = Number(s.followerCount) || 0;
  const memberSince = memberSinceOf(s, lang);

  return (
    <div className="rounded-xl bg-white shadow-sm p-6" dir={dir}>
      <div className="flex items-center gap-4">
        {photo && !photoBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={displayName}
            className="w-20 h-20 rounded-full object-cover shrink-0"
            onError={() => setPhotoBroken(true)}
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl font-bold shrink-0">
            {displayName ? displayName.charAt(0) : '?'}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-zinc-900 truncate">
            {displayName}
            {isVerified && (
              <span className="text-emerald-600 text-xl me-1" title={t('verifiedBadge')}>✓</span>
            )}
          </h1>
          {s.username && s.username !== displayName && (
            <p className="text-sm text-zinc-500" dir="ltr">@{s.username}</p>
          )}
          <p className="mt-1 text-sm text-zinc-600">
            {rating && <span>{rating}</span>}
            {rating && followersCount > 0 && <span> · </span>}
            {followersCount > 0 && (
              <span>👥 {followersCount} {t('followers')}</span>
            )}
            {memberSince && (
              <span className="block text-xs text-zinc-500 mt-0.5">
                {t('memberSince')} {memberSince}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function SellerInfosTab({ s }: { s: SellerProfile }) {
  const { t, lang } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  // js/seller.js parity (QA 16 Sep 2026 #8): the Infos tab opens with an
  // about block — bio plus a locale-correct member-since date.
  const bio = String(s.bio || '');
  const memberSince = memberSinceOf(s, lang);
  const ratingNum = Number(s.rating);
  const hasRating = isFinite(ratingNum) && ratingNum > 0;

  return (
    <div className="rounded-xl bg-white shadow-sm p-6" dir={dir}>
      <h2 className="text-lg font-bold text-zinc-900 mb-4">{t('infosTab')}</h2>
      {bio ? (
        <p className="text-zinc-700 mb-4">{bio}</p>
      ) : (
        <p className="text-zinc-400 text-sm mb-4">{t('noBioYet')}</p>
      )}
      <dl className="space-y-2 text-sm">
        {memberSince && (
          <div className="flex gap-2">
            <dt className="text-zinc-500">{t('memberSince')}:</dt>
            <dd className="font-medium text-zinc-900">{memberSince}</dd>
          </div>
        )}
        {hasRating && (
          <div className="flex gap-2">
            <dt className="text-zinc-500">{t('rating')}:</dt>
            <dd className="font-medium text-zinc-900">
              {ratingNum.toFixed(1)} ★ ({Number(s.ratingCount) || 0})
            </dd>
          </div>
        )}
        {s.username && (
          <div className="flex gap-2">
            <dt className="text-zinc-500">{t('username')}:</dt>
            <dd className="font-medium text-zinc-900" dir="ltr">@{s.username}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default function SellerPage({
  uid,
  seller,
  listings,
  listingsCursor,
  ratings,
  ratingsFailed,
}: {
  uid: string;
  seller: SellerProfile | null;
  listings: ListingCard[];
  listingsCursor: string | null;
  ratings: SellerRating[] | null;
  ratingsFailed: boolean;
}) {
  const { lang } = useLang();

  if (!seller) {
    return (
      <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <NotFoundView />
      </div>
    );
  }

  // Share dialog name — FD-003 parity: verified stores are branded by
  // their store name.
  const shareName =
    seller.storeTier === 'verified' && seller.storeName
      ? seller.storeName
      : seller.name || seller.username || '';
  // js/seller.js parity: for pro stores the boutique hero sits above the
  // tabs and replaces the ordinary profile card (its content moved into
  // the hero + Infos). The hero carries the follow/share actions, so the
  // standalone actions row below is rendered for non-pro sellers only.
  const isPro = seller.storeTier === 'verified';

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main id="main-content" className="max-w-6xl mx-auto px-4 py-6">
        {isPro ? (
          <StoreHero s={seller} uid={uid} />
        ) : (
          <SellerProfileCard s={seller} />
        )}

        {!isPro && (
          <div className="mt-4 flex flex-wrap gap-3 items-stretch">
            <div className="flex-1 min-w-[220px]">
              <FollowButton storeUid={uid} />
            </div>
            <SellerActions uid={uid} storeName={shareName} />
          </div>
        )}
        {/* js/seller.js v101 follow-notif parity: ordinary owners see their
            latest followers below the profile card (pro owners get it in
            the Infos tab instead). The component self-hides for non-owners. */}
        {!isPro && <RecentFollowers uid={uid} />}

        <SellerTabsSection
          uid={uid}
          isPro={seller.storeTier === 'verified'}
          initialListings={listings}
          initialNextCursor={listingsCursor}
          infos={
            <>
              <SellerInfosTab s={seller} />
              {/* js/seller.js renderSellerExtras parity: for pro stores the
                  report-user button lives in the Infos tab (visitors only —
                  the component self-hides for the owner), not in the hero. */}
              {isPro && (
                <div style={{ marginBottom: 10 }}>
                  <ReportUserButton uid={uid} targetTitle={shareName} />
                </div>
              )}
              {/* js/seller.js renderSellerExtras (0.0.0.4) parity: for pro
                  stores the owner boxes (store analytics + recent followers)
                  live in the Infos tab. Both self-hide for non-owners. */}
              {isPro && (
                <>
                  <StoreAnalytics uid={uid} isPro={true} />
                  <RecentFollowers uid={uid} />
                </>
              )}
              {/* js/seller.js loadRateCta parity: the rate CTA box sits
                  directly above the ratings list. */}
              <RateCta
                uid={uid}
                rateeName={seller.name || seller.username || ''}
              />
              <div className="mt-4">
                <RatingsList ratings={ratings} failed={ratingsFailed} profileUid={uid} />
              </div>
            </>
          }
        />
      </main>
    </div>
  );
}
