// Dlala listing detail — Server-Side Rendered.
//
// Pattern (Next.js 16 Cache Components + Partial Prefetching):
//   - The route shell prerenders instantly.
//   - <Suspense> wraps the params-dependent fetch: first visit to an ID
//     renders on demand, then the result is cached (ISR, 60s revalidate).
//     Subsequent visits serve from cache.
//   - The listing document is fetched server-side via Firestore REST.
//   - Public view renders without auth; sold/hidden docs (403 anonymous)
//     render the trilingual 404.

import { Suspense, Fragment } from 'react';
import Link from 'next/link';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  fetchListing,
  fetchSimilarListings,
  fetchSimilarWindow,
  fetchSeller,
  cardTitle,
  cardImage,
  formatPrice,
  viewsText,
  type ListingCard,
  type ListingDetail,
  type SellerProfile,
} from '@/lib/firestore';
import { answerRows } from '@/lib/answers';
import { WILAYAS } from '@/lib/wilayas';
import {
  SITE,
  SITE_TAGLINE,
  listingSeoText,
  listingJsonLd,
  listingBrandName,
  isConditionExempt,
  condLabelAr,
  fmtPriceText,
} from '@/lib/seo';
import TimeAgo from '@/components/TimeAgo';
import BackLink from '@/components/BackLink';
import ListingActions from './ListingActions';
import OwnerSellerCard from './OwnerSellerCard';
import FollowButton from '@/components/FollowButton';
import ReportUserButton from '@/components/ReportUserButton';
import Gallery from './Gallery';
import { lqipUrlFor } from '@/lib/image-variants';
import MatchingOffers, { type MatchOfferDoc } from './MatchingOffers';
import TasteViewRecorder from './TasteViewRecorder';
import ViewRecorder from './ViewRecorder';

async function getListing(id: string): Promise<ListingDetail | null> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchListing(id);
}

function wilayaName(code: number | undefined): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string }[]).find((x) => x.code === Number(code));
  return w ? `${w.code} - ${w.ar}` : '';
}

// js/listing.js loadSeller trust row (verbatim logic):
// - verified pro stores show their STORE name, not their personal name
//   (18 Sep 2026, Zak).
// - rating text: "4.5 ★ (12)"; 0.0.0.31 (users_public split): ratingCount is
//   not in the public mirror — show the rating alone when absent.
// - 0.0.0.31 FIX-WEB-027: no orphan line — the row is hidden when there is
//   neither a rating nor a verified badge.
function sellerTrust(profile: SellerProfile | null): {
  displayName: string | null;
  isPro: boolean;
  ratingRow: string | null;
} {
  if (!profile) return { displayName: null, isPro: false, ratingRow: null };
  const isPro = profile.storeTier === 'verified';
  const displayName =
    (isPro && profile.storeName ? profile.storeName : profile.name) || null;
  const ratingNum = Number(profile.rating);
  const hasRating = isFinite(ratingNum) && ratingNum > 0;
  const ratingTxt = hasRating ? ratingNum.toFixed(1) + ' ★' : '';
  const rating = profile.ratingCount
    ? `${ratingTxt} (${Number(profile.ratingCount) || 0})`
    : ratingTxt;
  const ratingRow =
    ratingTxt || profile.verified === true
      ? `${rating}${profile.verified === true ? ' ✓' : ''}`.trim()
      : null;
  return { displayName, isPro, ratingRow };
}

// Per-listing SEO — mirrors js/listing.js applyListingSeoHead() +
// js/seo.js applyListingSeo(): dynamic title, meta description, OG tags,
// Twitter cards (via generateMetadata) and JSON-LD (script tag in the page).
// SEO must never break the page: any failure falls back to a bare title.
function seoForListing(
  l: ListingDetail,
  id: string
): { metadata: Metadata; jsonLd: Record<string, unknown> } {
  const title = cardTitle(l).trim();
  // js/listing.js applyListingSeoHead: priceLabel + negotiable suffix,
  // wilayaLabel (allWilayas fallback), condLabel unless condition-exempt
  // (C-R24-1 — the label must not leak into meta for exempt categories).
  const priceLabel =
    fmtPriceText(l.price) + (l.negotiable ? ' · قابل للتفاوض' : '');
  const wilayaLabel = l.wilayaCode ? wilayaName(l.wilayaCode) : 'كل الولايات';
  const condLabel =
    l.condition && !isConditionExempt(l.categoryId, l.answers)
      ? condLabelAr(l.condition)
      : '';
  const seo = listingSeoText({
    title,
    priceLabel,
    wilayaLabel,
    condLabel,
    siteTagline: SITE_TAGLINE,
  });
  const url = `${SITE}/listing/${encodeURIComponent(id)}`;
  const image = cardImage(l) || `${SITE}/icon-512.png`;
  const jsonLd = listingJsonLd({
    title: title || 'DLALA',
    description: seo.description,
    image: cardImage(l) || null,
    brand: listingBrandName(l.answers),
    url,
    price: Number(l.price) || 0,
    condition: l.condition,
    status: l.status,
  });
  const metadata: Metadata = {
    title: seo.title,
    description: seo.description,
    openGraph: {
      // 'product' is not in Next.js's Metadata OpenGraph type union, but the
      // runtime renders og:type verbatim — the cast keeps the legacy value.
      type: 'product' as 'website',
      siteName: 'DLALA',
      title: seo.title,
      description: seo.description,
      url,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.title,
      description: seo.description,
      images: [image],
    },
  };
  return { metadata, jsonLd };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  try {
    const { id } = await params;
    const listing = await getListing(id);
    if (!listing) return { title: 'DLALA' };
    return seoForListing(listing, id).metadata;
  } catch {
    return { title: 'DLALA' };
  }
}

function description(l: ListingDetail, lang = 'ar'): string {
  if (l.description && typeof l.description === 'object') {
    return l.description[lang] || l.description.ar || '';
  }
  return '';
}

function NotFoundView() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center" dir="rtl">
      <div className="text-6xl font-bold text-emerald-700">D</div>
      <h1 className="mt-4 text-4xl font-bold">404</h1>
      <h2 className="mt-2 text-xl" lang="ar" dir="rtl">هذا الإعلان غير موجود</h2>
      <p className="mt-2 text-zinc-600" lang="ar" dir="rtl">
        ربما تم حذف الإعلان أو أن الرابط غير صحيح.
      </p>
      <p className="mt-1 text-zinc-600" lang="fr">Cette annonce n&rsquo;existe pas ou a été supprimée.</p>
      <p className="mt-1 text-zinc-600" lang="en">This listing does not exist or was removed.</p>
      <div className="mt-6">
        <Link href="/" className="inline-block rounded-lg bg-emerald-700 text-white px-6 py-3 font-medium">
          تصفح الإعلانات
        </Link>
      </div>
    </div>
  );
}


// Card for the similar-ads grid — mirrors the seller page's
// ListingCardView (same markup, Link instead of plain anchor).
function SimilarCard({ l }: { l: ListingCard }) {
  const img = cardImage(l);
  return (
    <Link
      href={`/listing/${l.id}`}
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
      </div>
      <div className="p-3">
        <p className="font-bold text-emerald-700 text-lg">{formatPrice(l.price || 0)}</p>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">{cardTitle(l)}</h3>
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
    </Link>
  );
}

function ListingSkeleton() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-6" dir="rtl">
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="w-full aspect-[4/3] bg-zinc-200 animate-pulse" />
      </div>
      <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
        <div className="h-8 bg-zinc-200 rounded animate-pulse w-3/4" />
        <div className="mt-2 h-10 bg-zinc-200 rounded animate-pulse w-1/3" />
      </div>
    </main>
  );
}

async function ListingContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let listing: ListingDetail | null = null;
  let error: string | null = null;
  try {
    listing = await getListing(id);
  } catch (e) {
    error = e instanceof Error ? e.message : 'listing-error';
  }

  if (!listing && !error) {
    notFound();
  }

  if (error || !listing) {
    return <NotFoundView />;
  }

  const l = listing;
  const photos = l.photoUrls && l.photoUrls.length ? l.photoUrls : [];
  // 0.0.0.1s per-index thumbnail preference (js/app.js detailInnerHtml):
  // photo_thumbs, then legacy thumbUrls, then the full photo.
  const thumbs = photos.map(
    (p, i) => (l.photo_thumbs && l.photo_thumbs[i]) || (l.thumbUrls && l.thumbUrls[i]) || p
  );
  const title = cardTitle(l);
  // Per-listing JSON-LD (js/seo.js listingJsonLd parity). Rendered as a
  // script tag — crawlers read JSON-LD anywhere in the HTML. '<' is
  // escaped (\u003c) so user content can never break out of the script.
  let jsonLdScript = '';
  try {
    jsonLdScript = JSON.stringify(seoForListing(l, id).jsonLd).replace(
      /</g,
      '\\u003c'
    );
  } catch {
    jsonLdScript = '';
  }
  // js/app.js renderAnswers parity: structured category Q&A.
  const rows = answerRows(l.answers);
  // js/listing.js loadMatches parity:
  // - regular ads: similar ads (same category, max 12).
  // - wanted ads (مطلوب): reverse-matched offers via matchingOffers
  //   (js/market.js) over the unfiltered 40-doc category window —
  //   the title-word match runs client-side with the viewer's uid.
  // null = fetch failed -> render nothing (legacy catch behavior).
  const isWanted = !!l.isWanted;
  let similar: ListingCard[] | null = null;
  let similarWindow: ListingCard[] | null = null;
  if (l.categoryId) {
    try {
      if (isWanted) {
        similarWindow = await fetchSimilarWindow(l.categoryId);
      } else {
        similar = await fetchSimilarListings(
          l.categoryId,
          Number(l.wilayaCode) || 0,
          id
        );
      }
    } catch {
      similar = null;
      similarWindow = null;
    }
  }
  // js/listing.js loadSeller parity: fetch the full seller profile for the
  // trust row (rating, verified badge, pro store name) — best-effort, never
  // breaks the page (legacy's background fetchUserRest catch behavior).
  let profile: SellerProfile | null = null;
  if (l.sellerId) {
    try {
      profile = await fetchSeller(l.sellerId);
    } catch {
      profile = null;
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-6" dir="rtl">
      {/* LIS-7 (16 Sep 2026, js/listing.js): the back link returns to the
          previous page (feed with its filters/scroll intact) via
          history.back() instead of dumping to home; href="/" is the
          no-history fallback. */}
      <BackLink />
      {/* js/taste.js tasteRecordView (via js/listing.js): every non-owner
          view is an on-device taste signal. Owner views are excluded
          inside tasteRecordView via the dlala_uid mirror. */}
      <TasteViewRecorder
        listing={{
          id,
          categoryId: l.categoryId,
          price: l.price,
          wilayaCode: l.wilayaCode,
          sellerId: l.sellerId,
        }}
      />
      {/* Server-visible view counting (js/listing.js recordSignedInView /
          recordAnonymousView): one listingViews doc per viewer per day.
          Best-effort — never affects rendering. */}
      {l.sellerId && <ViewRecorder listingId={id} sellerId={l.sellerId} />}
      {jsonLdScript && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript }}
        />
      )}
      {/* Gallery — clickable thumbnails + fullscreen lightbox
          (client component; mirrors js/listing.js LIS-8 gallery,
          LIS-9 progressive hero, LIS-10 idle prewarm). */}
      <Gallery
        photos={photos}
        fallback={cardImage(l)}
        title={title}
        hasVariants={!!l.photoVariants}
        heroLqip={lqipUrlFor(l)}
        thumbs={thumbs}
      />

      {/* Head: title / price / meta */}
      <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
        {/* LIS-1 (legacy js/listing.js): sold listings get an explicit
            "no longer available" banner, prepended to the detail card. */}
        {l.status === 'sold' && (
          <div
            className="bg-[#7a1f1f] text-white px-[14px] py-[10px] rounded-[10px] mb-3 font-bold text-center"
            lang="ar"
            dir="rtl"
          >
            تم بيع هذا الإعلان — لم يعد متاحاً
          </div>
        )}
        <h1 className="text-2xl font-bold text-zinc-900">{title}</h1>
        <p className="mt-2 text-3xl font-bold text-emerald-700">{formatPrice(l.price || 0)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-zinc-500">الولاية: </span>
            <b>{wilayaName(l.wilayaCode)}</b>
          </div>
          {l.condition && (
            <div>
              <span className="text-zinc-500">الحالة: </span>
              <b>{l.condition === 'used' ? 'مستعمل' : l.condition === 'new' ? 'جديد' : l.condition}</b>
            </div>
          )}
          {l.createdAt && (
            <div>
              <span className="text-zinc-500">نُشر: </span>
              <b><TimeAgo iso={l.createdAt.toISOString()} /></b>
            </div>
          )}
        </div>
        {/* js/app.js FIX-WEB-025 parity: stat-row under the meta grid —
            views with proper Arabic plurals + favorite count (public
            popularity signal). Legacy markup:
            <div class="stat-row"><span>👁 viewsText(l.views)</span>
            <span>♥ favCount inFavorites</span></div>. */}
        <div className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-1 text-[13px] text-zinc-500">
          <span>👁 {viewsText(l.views)}</span>
          <span>♥ {Number(l.favoriteCount) || 0} في المفضلة</span>
        </div>
        {/* Favorite + contact seller (client component — needs auth state) */}
        {l.sellerId && (
          <ListingActions
            listingId={id}
            sellerId={l.sellerId}
            title={title}
            price={l.price || 0}
            photoUrl={photos[0] || cardImage(l)}
            sold={l.status === 'sold'}
          />
        )}
      </div>

      {/* Seller card — denormalized fast path (R11-RADICAL).
          Owners see a compact "✓ إعلانك" indicator instead (js/listing.js
          parity, via OwnerSellerCard).
          Trust row (js/listing.js loadSeller full-card parity): verified
          pro stores show their STORE name (18 Sep 2026, Zak) + ★ pro badge;
          the rating row shows "4.5 ★ (12)" + ✓ for verified, hidden when
          there is neither (0.0.0.31 FIX-WEB-027). Buttons row: view
          store/profile link + report-user button. */}
      <OwnerSellerCard sellerId={l.sellerId}>
      <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
        <h2 className="text-lg font-semibold">البائع</h2>
        {/* js/listing.js parity: the listing seller card carries a follow
            button next to the seller identity (legacy loadSeller full-card
            row: name left, .follow-btn right). OwnerSellerCard swaps the
            whole card for "✓ إعلانك" when the viewer owns the listing. */}
        {(() => {
          const trust = sellerTrust(profile);
          const denorm = l as unknown as { sellerName?: string; sellerPhotoUrl?: string };
          const name = trust.displayName || denorm.sellerName || 'عرض صفحة البائع';
          return (
            <>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {denorm.sellerPhotoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={denorm.sellerPhotoUrl}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover shrink-0"
                    />
                  )}
                  <span className="font-bold truncate">
                    <Link
                      href={`/seller/${l.sellerId}`}
                      className="text-emerald-700 hover:underline"
                    >
                      {name}
                    </Link>
                    {trust.isPro && (
                      <span className="mr-2 inline-block rounded-full bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-0.5">
                        ★ تاجر محترف
                      </span>
                    )}
                  </span>
                </div>
                {l.sellerId && (
                  <div className="shrink-0 min-w-[120px]">
                    <FollowButton storeUid={l.sellerId} />
                  </div>
                )}
              </div>
              {trust.ratingRow && (
                <p className="mt-1 text-sm text-zinc-500">{trust.ratingRow}</p>
              )}
              {l.sellerId && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/seller/${l.sellerId}`}
                    className="rounded-lg border border-zinc-300 bg-white px-4 py-2 font-bold text-zinc-700 hover:border-emerald-500"
                  >
                    {trust.isPro ? 'عرض المتجر' : 'عرض الصفحة'}
                  </Link>
                  <ReportUserButton
                    uid={l.sellerId}
                    targetTitle={trust.displayName || ''}
                    className="rounded-lg border border-zinc-300 bg-white px-4 py-2 font-bold text-zinc-700 hover:border-red-300"
                  />
                </div>
              )}
            </>
          );
        })()}
      </div>
      </OwnerSellerCard>

      {/* Description */}
      {description(l) && (
        <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
          <h2 className="text-lg font-semibold mb-2">الوصف</h2>
          <p className="whitespace-pre-wrap text-zinc-800">{description(l)}</p>
        </div>
      )}

      {/* Answers box — structured category Q&A (js/app.js renderAnswers) */}
      {rows.length > 0 && (
        <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
          <h2 className="text-lg font-semibold mb-2">التفاصيل</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 mt-2 text-sm">
            {rows.map((r, i) => (
              <Fragment key={i}>
                <dt className="text-zinc-500">{r.label}</dt>
                <dd className="text-zinc-900">{r.value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}

      {/* Matches section — js/listing.js loadMatches parity:
          wanted ads show reverse-matched offers («عروض مطابقة لطلبك»,
          js/market.js matchingOffers); regular ads show similar ads. */}
      {isWanted ? (
        similarWindow !== null && (
          <MatchingOffers
            windowDocs={similarWindow.map(
              (d): MatchOfferDoc => ({
                ...d,
                createdAt:
                  d.createdAt instanceof Date
                    ? d.createdAt.toISOString()
                    : null,
              })
            )}
            wanted={{ title: l.title, categoryId: l.categoryId }}
          />
        )
      ) : (
        similar !== null && (
          <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
            <h2 className="text-lg font-semibold mb-4">إعلانات مشابهة</h2>
            {similar.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {similar.map((s) => (
                  <SimilarCard key={s.id} l={s} />
                ))}
              </div>
            ) : (
              <p className="text-zinc-500">لا توجد إعلانات مشابهة حالياً</p>
            )}
          </div>
        )
      )}

    </main>
  );
}

export default function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <Suspense fallback={<ListingSkeleton />}>
        <ListingContent params={params} />
      </Suspense>
    </div>
  );
}
