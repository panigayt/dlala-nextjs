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

import { Suspense } from 'react';
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
  type ListingCard,
  type ListingDetail,
  type SellerProfile,
} from '@/lib/firestore';

import { WILAYAS } from '@/lib/wilayas';
import { dzPriceWords } from '@/lib/dz-price';
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
import BackLink from '@/components/BackLink';
import ListingActions from './ListingActions';
import OwnerSellerCard from './OwnerSellerCard';
import RateCta from '@/components/RateCta';
import NotFoundCta from './NotFoundCta';
import {
  ListingDir,
  SoldBanner,
  MetaGrid,
  StatRow,
  SellerCardBody,
  ListingDescription,
  AnswersBox,
  SimilarAds,
} from './ListingShell';
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
        <NotFoundCta />
      </div>
    </div>
  );
}


function ListingSkeleton() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-6">
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
  // Round 128 (js/app.js priceWordsHtml / detailPriceHtml parity, 0.0.0.39):
  // the Darija price parenthetical «(200 مليون)» next to the DZD price on
  // the detail page — display-only, stays Arabic in FR/EN UI (Zak, 21 Sep
  // 2026). dzPriceWords returns '' for the 1-DZD no-price convention.
  const priceWords = dzPriceWords(l.price || 0);
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
    <main className="max-w-4xl mx-auto px-4 py-6">
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
        {l.status === 'sold' && <SoldBanner />}
        <h1 className="text-2xl font-bold text-zinc-900">{title}</h1>
        <p className="mt-2 text-3xl font-bold text-emerald-700">
          <span dir="ltr">{formatPrice(l.price || 0)}</span>
          {priceWords && <small className="ms-1 font-normal text-zinc-500">({priceWords})</small>}
        </p>
        <MetaGrid
          wilayaCode={l.wilayaCode}
          condition={l.condition}
          categoryId={l.categoryId}
          createdAtISO={l.createdAt ? l.createdAt.toISOString() : null}
          answers={l.answers as Record<string, unknown> | undefined}
        />
        {/* js/app.js FIX-WEB-025 parity: stat-row under the meta grid —
            views with proper Arabic plurals + favorite count (public
            popularity signal). Legacy markup:
            <div class="stat-row"><span>👁 viewsText(l.views)</span>
            <span>♥ favCount inFavorites</span></div>. */}
        <StatRow views={l.views} favoriteCount={l.favoriteCount} />
        {/* js/listing.js loadRateBox parity: the #rateBox sits directly under
            the stat-row in the detail card — rating entry point shown when I
            have a buyer-confirmed deal with this seller that I have not
            rated yet (LIS-2: the dialog names the PERSON, falling back to
            the ad title only when the name is unknown). Renders nothing for
            guests/owners/no-deals, like legacy. */}
        {l.sellerId && (
          <div className="mt-3">
            <RateCta
              uid={l.sellerId}
              rateeName={
                profile?.name ||
                (l as unknown as { sellerName?: string }).sellerName ||
                title
              }
            />
          </div>
        )}
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
        {/* js/listing.js loadSeller full-card parity: heading + identity row
            (name left, .follow-btn right) + rating row + view-store/page +
            report-user buttons. Trilingual via ListingShell. OwnerSellerCard
            swaps the whole card for "✓ إعلانك" when the viewer owns it. */}
        {l.sellerId && (
          <SellerCardBody
            sellerId={l.sellerId}
            profile={profile}
            denormName={
              (l as unknown as { sellerName?: string }).sellerName
            }
            denormPhoto={
              (l as unknown as { sellerPhotoUrl?: string }).sellerPhotoUrl
            }
          />
        )}
      </div>
      </OwnerSellerCard>

      {/* Description — body follows the UI language (js/app.js
          localizedText parity). */}
      <ListingDescription description={l.description} />

      {/* Answers box — structured category Q&A (js/app.js renderAnswers
          parity). Labels follow the UI language (PUB_STR ar/fr/en). */}
      <AnswersBox answers={l.answers as Record<string, unknown> | undefined} />

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
        similar !== null && <SimilarAds items={similar} />
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
    <ListingDir>
      <Suspense fallback={<ListingSkeleton />}>
        <ListingContent params={params} />
      </Suspense>
    </ListingDir>
  );
}
