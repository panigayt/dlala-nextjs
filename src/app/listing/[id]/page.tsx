// Dlala listing detail — Server-Side Rendered.
//
// Pattern (Next.js 16 Cache Components + Partial Prefetching):
//   - The route shell prerenders instantly.
//   - <Suspense> wraps the params-dependent fetch: first visit to an ID
//     renders on demand, then the result is cached (ISR, 300s revalidate).
//     Subsequent visits serve from cache.
//   - The listing document is fetched server-side via Firestore REST.
//   - Public view renders without auth; sold/hidden docs (403 anonymous)
//     render the trilingual 404.
//
// I18N DESIGN (R54, 18 Oct 2026 — supersedes the Round-4 cookie-SSR design):
//   Listing-detail pages are SINGLE-LOCALE (no /fr/listing/<id> or
//   /en/listing/<id> routes — they 404 by design) and their SSR is
//   LANGUAGE-INVARIANT (Arabic). The dlala_lang cookie MUST NOT drive
//   server rendering: the edge cache cannot vary by cookie (K-M1 follow-up,
//   verified live 18 Oct 2026 — Vary: Cookie via next.config.ts +
//   vercel.json and Cache-Control: private via the proxy were ALL
//   ineffective), so cookie-dependent SSR poisoned every locale. One URL
//   serves all three languages via CLIENT-SIDE translation (useLang():
//   ListingH1, ListingPrice, Gallery alt text, LocalizedDocTitle) — the
//   Round-107 pattern the homepage/search/wanted shells already use.
//   SEO is unchanged: crawlers get Arabic SSR + Arabic JSON-LD, the sitemap
//   keeps canonical Arabic URLs (hreflang: ar + x-default).
//   Do NOT create localized listing routes. Do NOT read dlala_lang here.

import { Suspense, cache } from 'react';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
// R33-1: print stylesheet for this route only (module CSS, so it loads
// solely on the listing detail page; all rules are @media print, so
// screen rendering is untouched). The bound import applies .printScope
// to <main>, which the print rules use as their scoping anchor.
import printStyles from './print.module.css';
import {
  fetchListing,
  fetchSimilarListings,
  fetchSimilarWindow,
  fetchSeller,
  cardTitle,
  cardImage,
  type ListingCard,
  type ListingDetail,
  type SellerProfile,
} from '@/lib/firestore';

import { WILAYAS } from '@/lib/wilayas';
import { dzPriceWords } from '@/lib/dz-price';
import {
  SITE,
  listingSeoText,
  listingJsonLd,
  wantedJsonLd,
  listingBrandName,
  isConditionExempt,
  condLabel as condLabelText,
  fmtPriceText,
} from '@/lib/seo';
import { t, type Lang } from '@/lib/i18n-strings';
import { LoadErrorText, LocaleDir, RetryLabel } from '@/components/LocaleBits';
import type { MatchOfferDoc } from './MatchingOffers';
import BackLink from '@/components/BackLink';
import OwnerSellerCard from './OwnerSellerCard';
import WantedBadge from './WantedBadge';
import ListingH1 from './ListingH1';
import ListingPrice from './ListingPrice';
import RateCta from '@/components/RateCta';
import NotFoundCta from './NotFoundCta';

import ActionsLoader from './ActionsLoader';
import MatchesLoader from './MatchesLoader';

// Fire-and-forget recorders with no UI — client-only, never block hydration.
// `ssr: false` is illegal in Server Components, so they live behind the tiny
// client wrapper RecordersClient (12 Oct 2026 gate fix).
import RecordersClient from './RecordersClient';
import { ListingJsonLd } from './ListingJsonLd';
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
import TrackView from './TrackView';
import { lqipUrlFor } from '@/lib/image-variants';
import LocalizedDocTitle from '@/components/LocalizedDocTitle';

// Round 17 T3: the Round 149/159 manual preload set (hero + strip
// thumbs[0..2] via <PreloadLinks>) is REMOVED — a Slow-3G A/B (n=6/arm,
// interleaved, 390px) showed every tag it emitted was wasted or
// redundant, and dropping them improved gallery completion:
//   - the "hero" tag preloaded photos[0] (full-size), but the gallery
//     hero displays thumbs[0] (LIS-9 progressive hero) — a high-priority
//     fetch of bytes nothing shows at first paint, contending with the
//     real images on thin pipes;
//   - the thumbs[0..2] tags duplicated React 19's automatic
//     <link rel="preload" as="image" fetchPriority="high"> hoisting for
//     the eager+high strip imgs (verified in served HTML: the auto tags
//     land in <head>, ahead of any body tags).
// Measured medians, ttfb removed: hero completion -1.6s, strip thumb #2
// -0.9s; first content unchanged (parse-driven, ttfb-dominated).
// The strip's eager+high imgs (Gallery.tsx, Round 16 T9) plus React's
// auto-preloads carry the whole load — no manual tags needed.

async function _getListing(id: string): Promise<ListingDetail | null> {
  'use cache';
  // Round 150: listings rarely change — 5min ISR (was 60s).
  cacheLife({ revalidate: 300 });
  return fetchListing(id);
}

// 22 Oct 2026 (reads-incident fix): the similar rail (52 reads: wilaya
// window 12 + category window 40) and the seller profile re-executed on
// EVERY listing render while the listing doc itself was cached 300s.
// They now share the listing's own 300s freshness contract — repeat
// views of a listing inside the window cost zero Firestore reads, and
// the rail can lag a brand-new listing by at most the same 5 minutes
// the listing page already accepts for edits.
async function getSimilarCached(
  categoryId: string,
  wilayaCode: number,
  excludeId: string
): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 300 });
  return fetchSimilarListings(categoryId, wilayaCode, excludeId);
}

async function getSimilarWindowCached(
  categoryId: string
): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 300 });
  return fetchSimilarWindow(categoryId);
}

async function getSellerCached(uid: string): Promise<SellerProfile | null> {
  'use cache';
  cacheLife({ revalidate: 300 });
  return fetchSeller(uid);
}

// Round 12 (12 Oct 2026): React cache() dedupes the existence check across
// generateMetadata + the page body within one request — one Firestore read.
const getListing = cache(_getListing);

function wilayaName(code: number | undefined, lang: Lang): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string; fr: string; en: string }[]).find(
    (x) => x.code === Number(code)
  );
  if (!w) return '';
  // 0.0.0.21 (I-08): English UI uses the English transliterations.
  return lang === 'ar'
    ? `${w.code} - ${w.ar}`
    : lang === 'en' && w.en
      ? `${w.code} - ${w.en}`
      : `${w.code} - ${w.fr}`;
}

// Per-listing SEO — mirrors js/listing.js applyListingSeoHead() +
// js/seo.js applyListingSeo(): dynamic title, meta description, OG tags,
// Twitter cards (via generateMetadata) and JSON-LD (script tag in the page).
// SEO must never break the page: any failure falls back to a bare title.
// Round 133: UI-language-aware via the dlala_lang cookie (server) —
// price/wilaya/condition/tagline follow the reader's language
// (legacy applied t() to the same parts in applyListingSeoHead).
function seoForListing(
  l: ListingDetail,
  id: string,
  lang: Lang
): { metadata: Metadata; jsonLd: Record<string, unknown>[] | null } {
  const title = cardTitle(l, lang).trim();
  // js/listing.js applyListingSeoHead: priceLabel + negotiable suffix,
  // wilayaLabel (allWilayas fallback), condLabel unless condition-exempt
  // (C-R24-1 — the label must not leak into meta for exempt categories).
  // Zak 18 Oct 2026 (explicit order, overriding CA-D1): ALWAYS show the
  // price (even "1 دج") + negotiable suffix when negotiable OR price <= 1
  // (1 DZD = negotiable). Meta/OG/Twitter descriptions follow UI parity.
  const priceLabel =
    fmtPriceText(l.price, lang) + ((l.negotiable || Number(l.price) <= 1) ? ' · ' + t('negotiable', lang) : '');
  const wilayaLabel = l.wilayaCode ? wilayaName(l.wilayaCode, lang) : t('allWilayas', lang);
  const condLabel =
    l.condition && !isConditionExempt(l.categoryId, l.answers)
      ? condLabelText(l.condition, lang)
      : '';
  const seo = listingSeoText({
    title,
    priceLabel,
    wilayaLabel,
    condLabel,
    siteTagline: t('seoTagline', lang),
  });
  const url = `${SITE}/listing/${encodeURIComponent(id)}`;
  // 11 Oct 2026: rewrite default photos — dzdlala.com blocks hotlinking,
  // so OG crawlers get a blocked image without this.
  // 12 Oct 2026: cardImage() now rewrites centrally; ensure absolute URL
  // for OG + JSON-LD (Google prefers absolute image URLs).
  const rawImage = cardImage(l) || `${SITE}/icon-512.png`;
  const image = rawImage.startsWith('http') ? rawImage : `${SITE}${rawImage}`;
  // Round 199 (F7): JSON-LD Product `image` carries every gallery photo,
  // not just the card image — richer rich-results eligibility. Mirrors the
  // gallery strip's per-index thumb choice (photo_thumbs[i] || thumbUrls[i]
  // || photoUrls[i]); every entry absolute. Falls back to the single card
  // image when the listing has no photos (ld.image is never an empty array).
  const rewriteDefaultAd = (u: string) =>
    u.replace('https://www.dzdlala.com/img/default_ads/', '/img/default_ads/');
  const absImg = (u: string) => {
    const v = rewriteDefaultAd(u);
    return v.startsWith('http') ? v : `${SITE}${v}`;
  };
  const photoCount = Math.max(
    l.photoUrls?.length ?? 0,
    l.photo_thumbs?.length ?? 0,
    l.thumbUrls?.length ?? 0
  );
  const allImages: string[] = [];
  for (let i = 0; i < photoCount; i++) {
    const u =
      (l.photo_thumbs && l.photo_thumbs[i]) ||
      (l.thumbUrls && l.thumbUrls[i]) ||
      (l.photoUrls && l.photoUrls[i]);
    if (u) allImages.push(absImg(u));
  }
  if (!allImages.length) allImages.push(image);
  // 17 Oct 2026 (Google Search Console: "image" manquant): a listing has a
  // REAL product photo only when allImages contains something other than the
  // site-icon fallback or a category placeholder. Otherwise no Product JSON-LD.
  const hasRealImage = allImages.some(
    (u) => !u.includes('/icon-512.png') && !u.includes('/default_ads/')
  );
  // R32-1 (24 Oct 2026): wanted ads get the Demand builder — the
  // Product builder returns null for them (no real photo), which left
  // wanted pages with zero JSON-LD. A wanted ad's stored price is its
  // budget; its photos are carried only when real (never the wanted
  // placeholder).
  const jsonLd = l.isWanted
    ? wantedJsonLd({
        title: title || 'DLALA',
        description: seo.description,
        image: hasRealImage ? allImages : undefined,
        brand: listingBrandName(l.answers),
        url,
        budget: Number(l.price) || 0,
      })
    : listingJsonLd({
        title: title || 'DLALA',
        description: seo.description,
        image: allImages,
        brand: listingBrandName(l.answers),
        url,
        price: Number(l.price) || 0,
        condition: l.condition,
        status: l.status,
        hasRealImage,
      });
  const metadata: Metadata = {
    title: seo.title,
    description: seo.description,
    // 11 Oct 2026: canonical — prevents duplicate-content indexing.
    // Round 205 (audit R1, A3): hreflang cluster — self-referential 'ar'
    // plus x-default (the listing IS the Arabic default URL). /fr and /en
    // listing routes do not exist (404, listings are cookie-localized —
    // commit 7c7c8ba), so emitting fr/en hreflang targets here would point
    // crawlers at 404s and create Search Console errors.
    alternates: {
      canonical: url,
      languages: {
        ar: url,
        'x-default': url,
      },
    },
    openGraph: {
      // Round 133: 'product' was the legacy og:type, but Next 16's metadata
      // renderer throws `Invalid OpenGraph type: product` (exhaustive switch
      // with no 'product' case) — the throw silently drops the ENTIRE <head>
      // metadata (title, description, all OG/Twitter tags). Verified live:
      // listing pages rendered with no <title> at all. 'website' renders.
      // 17 Oct 2026 (SEO audit FIX #16): re-verified against the INSTALLED
      // Next 16.4.0 — node_modules/next/dist/lib/metadata/metadata-elements.js
      // still has the exhaustive switch (cases: website, article, book,
      // profile, music.*, video.* — no 'product'), and the default branch
      // still throws. Keep 'website' until Next adds 'product' support.
      type: 'website',
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
  const { id } = await params;
  let listing: ListingDetail | null = null;
  let fetchFailed = false;
  try {
    listing = await getListing(id);
  } catch {
    // Transient fetch failure — fall through to the noindex fallback below
    // (the page renders the not-found UI itself). A 404 must only be served
    // for genuinely missing listings, never for a failed fetch.
    fetchFailed = true;
  }
  // Round 14 (12 Oct 2026): the REAL HTTP 404 now comes from the Edge
  // proxy (src/proxy.ts + src/proxy-404.ts), which checks Firestore
  // BEFORE rendering/streaming starts. The earlier Round-12 plan of
  // notFound() here kept HTTP 200 under cacheComponents:true PPR
  // (verified via curl 12 Oct 2026); retained only as a harmless
  // fallback, since the dynamic metadata also streams after the 200
  // headers are sent.
  if (!listing && !fetchFailed) notFound();
  // 11 Oct 2026: noindex on 404 — deleted listings must not be indexed
  // (kept as belt-and-braces; the not-found boundary also injects noindex).
  if (!listing) return { title: 'DLALA', robots: { index: false, follow: false } };
  try {
    // 17 Oct 2026 (audit H2 — root-cause fix): metadata is STATIC Arabic —
    // no dlala_lang cookie read. Awaiting cookies() in generateMetadata
    // deferred the metadata segment past the initial <head> flush, so Next
    // streamed <title>/<meta>/OG/canonical into <body> (verified: </head>
    // at byte 1980, <title> at byte 15081). Static metadata resolves before
    // the head flush. The tab title still follows the reader's language:
    // ListingContent renders <LocalizedDocTitle> with the cookie-localized
    // SEO title (same request, same cookie — Round 17 T7 pattern).
    return seoForListing(listing, id, 'ar').metadata;
  } catch {
    return { title: 'DLALA', robots: { index: false, follow: false } };
  }
}

// Round 9 (12 Oct 2026): transient fetch-failure UI. fetchListing() THROWS
// (not null) on network/5xx/429 — the listing may well exist, so the 404
// "doesn't exist" messaging is wrong here. HTTP 200 is kept (a 404 must
// only be served for genuinely missing listings, via notFound(); the
// metadata already carries noindex from generateMetadata's fetchFailed
// branch). The retry link is a native <a> — a full document reload
// re-runs this server component and retries the Firestore fetch, so no
// client island is needed.
async function TransientErrorView({ id }: { id: string }) {
  // R54: language-invariant SSR (Arabic) — the edge cache cannot vary by
  // cookie, so no dlala_lang read here. dir, the retry label AND the
  // heading/body follow the UI language client-side (LocaleBits).
  // R25-3 (24 Oct 2026): the heading/body used to be an unconditional
  // Arabic block with the FR/EN texts stacked below — they render in
  // the active language now (LoadErrorText + the i18n tables).
  return (
    <LocaleDir className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="text-6xl font-bold text-emerald-700">D</div>
      <LoadErrorText
        titleKey="listingLoadErrorTitle"
        bodyKey="listingLoadErrorBody"
        titleClassName="mt-4 text-2xl font-bold"
        bodyClassName="mt-2 text-zinc-600"
      />
      <div className="mt-6 flex items-center justify-center gap-3">
        <a
          href={`/listing/${encodeURIComponent(id)}`}
          className="inline-block rounded-lg bg-emerald-700 text-white px-6 py-3 font-medium"
        >
          <RetryLabel />
        </a>
        <NotFoundCta />
      </div>
    </LocaleDir>
  );
}


function ListingSkeleton() {
  // Round 4 (18 Oct 2026, audit S-F2): was <main> — a loading skeleton is
  // not a landmark. Using <div> avoids duplicate <main> in React Flight
  // payloads (skeleton + content both serialize <main>).
  return (
    <div className="max-w-4xl mx-auto px-4 py-6" aria-hidden="true">
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="w-full aspect-[4/3] bg-zinc-200 animate-pulse" />
      </div>
      <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
        <div className="h-8 bg-zinc-200 rounded animate-pulse w-3/4" />
        <div className="mt-2 h-10 bg-zinc-200 rounded animate-pulse w-1/3" />
      </div>
    </div>
  );
}

async function ListingContent({
  params,
  listing,
}: {
  params: Promise<{ id: string }>;
  // Round 12: the existence check already ran in the page body (ONE read
  // shared via the React-cache-deduped getListing) — listing is guaranteed
  // non-null here; transient failures never reach this component.
  listing: ListingDetail;
}) {
  const { id } = await params;

  const l = listing;
  // R54 (18 Oct 2026): SSR is language-invariant (Arabic). The dlala_lang
  // cookie MUST NOT drive server rendering — the edge cache cannot vary by
  // cookie (K-M1: Vary: Cookie via next.config.ts + vercel.json and
  // Cache-Control: private via the proxy were all verified ineffective
  // live), so cookie-dependent SSR served Arabic to FR/EN users and vice
  // versa. UI language now applies client-side via useLang() (ListingH1,
  // ListingPrice, Gallery, LocalizedDocTitle) — the Round-107 pattern the
  // homepage/search/wanted shells already use.
  const pageLang = 'ar' as const;
  // 11 Oct 2026: rewrite dzdlala.com default ad images to local paths
  // (dzdlala.com blocks hotlinking on the preview domain). Fixes existing
  // listings without Firestore updates.
  const rewriteDefaultImg = (u: string) =>
    u.replace('https://www.dzdlala.com/img/default_ads/', '/img/default_ads/');
  const photos = (l.photoUrls && l.photoUrls.length ? l.photoUrls : []).map(rewriteDefaultImg);
  // 0.0.0.1s per-index thumbnail preference (js/app.js detailInnerHtml):
  // photo_thumbs, then legacy thumbUrls, then the full photo.
  // Round 158: the `|| p` fallback is the known slow path — only for
  // legacy/pre-0.0.0.1w listings that have no dedicated thumb variant.
  // For those listings the strip loads the full photo; current listings
  // always have thumbs, so the fast path (thumb URL) is used.
  const thumbs = photos.map(
    (p, i) => (l.photo_thumbs && l.photo_thumbs[i]) || (l.thumbUrls && l.thumbUrls[i]) || p
  );
  const title = cardTitle(l, pageLang);
  // Round 128 (js/app.js priceWordsHtml / detailPriceHtml parity, 0.0.0.39):
  // the Darija price parenthetical «(200 مليون)» next to the DZD price on
  // the detail page — display-only, stays Arabic in FR/EN UI (Zak, 21 Sep
  // 2026). dzPriceWords returns '' for the 1-DZD no-price convention.
  const priceWords = dzPriceWords(l.price || 0);
  // R13 AX-F1 (18 Oct 2026): the JSON-LD <script> NO LONGER renders here.
  // This component sits inside <Suspense> and Next.js PPR emitted its
  // script tag twice (static shell + streamed segment, byte-identical).
  // The script now renders exactly once in ListingPage's non-streamed
  // shell below. This block derives the tab title in all three languages
  // (R54: server computes ar/fr/en, the client picks via useLang()).
  let localizedTitles: Record<'ar' | 'fr' | 'en', string> = { ar: 'DLALA', fr: 'DLALA', en: 'DLALA' };
  try {
    // (Titles only here — the JSON-LD itself renders once in the shell.)
    (['ar', 'fr', 'en'] as const).forEach((tlang) => {
      const seo = seoForListing(l, id, tlang);
      if (typeof seo.metadata.title === 'string' && seo.metadata.title) {
        localizedTitles[tlang] = seo.metadata.title;
      }
    });
  } catch {
    /* keep default titles */
  }
  // js/listing.js loadMatches parity:
  // - regular ads: similar ads (same category, max 12).
  // - wanted ads (مطلوب): reverse-matched offers via matchingOffers
  //   (js/market.js) over the unfiltered 40-doc category window —
  //   the title-word match runs client-side with the viewer's uid.
  // null = fetch failed -> render nothing (legacy catch behavior).
  const isWanted = !!l.isWanted;
  // 11 Oct 2026: seekers store isWanted=true but show seeker badge, not wanted.
  const isSeeker = l.categoryId === 'jobs' && (l.answers as Record<string, unknown> | undefined)?.jobType === 'jobSeeker';
  // Round 17 T7: the similar-ads query and the seller-profile fetch are
  // independent — fire them in parallel instead of sequentially. Same
  // merge points, same null-on-failure behavior as the sequential
  // version (js/listing.js loadMatches + loadSeller parity): identical
  // output, ~1 fewer serial Firestore round-trip.
  const [similar, similarWindow, profile] = await Promise.all([
    !isWanted && l.categoryId
      ? getSimilarCached(l.categoryId, Number(l.wilayaCode) || 0, id).catch(
          (): ListingCard[] | null => null
        )
      : Promise.resolve(null as ListingCard[] | null),
    isWanted && l.categoryId
      ? getSimilarWindowCached(l.categoryId).catch(
          (): ListingCard[] | null => null
        )
      : Promise.resolve(null as ListingCard[] | null),
    // js/listing.js loadSeller parity: fetch the full seller profile for
    // the trust row (rating, verified badge, pro store name) —
    // best-effort, never breaks the page (legacy's background
    // fetchUserRest catch behavior).
    l.sellerId
      ? getSellerCached(l.sellerId).catch((): SellerProfile | null => null)
      : Promise.resolve(null as SellerProfile | null),
  ]);

  return (
    <>
    <main id="main-content" className={`${printStyles.printScope} max-w-4xl mx-auto px-4 py-6`}>
      {/* 17 Oct 2026 (audit H2): static-Arabic <title> metadata lands in
          <head>; the reader's localized SEO title goes on the tab here
          (R54: server computes ar/fr/en, client picks via useLang()). */}
      <LocalizedDocTitle titles={localizedTitles} />
      {/* LIS-7 (16 Sep 2026, js/listing.js): the back link returns to the
          previous page (feed with its filters/scroll intact) via
          history.back() instead of dumping to home; href="/" is the
          no-history fallback. */}
      <BackLink />
      {/* js/taste.js tasteRecordView (via js/listing.js): every non-owner
          view is an on-device taste signal. Owner views are excluded
          inside tasteRecordView via the dlala_uid mirror. */}
      <RecordersClient
        listing={{
          id,
          categoryId: l.categoryId,
          price: l.price,
          wilayaCode: l.wilayaCode,
          sellerId: l.sellerId,
        }}
        sellerId={l.sellerId}
      />
      {/* R13 AX-F1 (18 Oct 2026): the JSON-LD <script> used to render here
          (R8-8 had moved it out of <main>), but this whole component sits
          inside <Suspense> and PPR emitted the script twice — static shell
          + streamed segment. It now renders exactly once in ListingPage's
          non-streamed shell. Crawlers read JSON-LD anywhere. */}
      {/* Round 17 T3: manual preload set removed — the gallery's eager+high
          imgs and React 19's auto-preloads cover it. (Round 21: verified the
          Fizz auto-preloads match img URLs exactly and precede them in
          document order; head-hoisting not achieved but order is correct.) */}
      {/* Gallery — clickable thumbnails + fullscreen lightbox
          (client component; mirrors js/listing.js LIS-8 gallery,
          LIS-9 progressive hero, LIS-10 idle prewarm). */}
      <Gallery
        photos={photos}
        fallback={cardImage(l)}
        title={l.title}
        hasVariants={!!l.photoVariants}
        heroLqip={lqipUrlFor(l)}
        thumbs={thumbs}
      />

      {/* Head: title / price / meta */}
      <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
        {/* LIS-1 (legacy js/listing.js): sold listings get an explicit
            "no longer available" banner, prepended to the detail card. */}
        {l.status === 'sold' && <SoldBanner />}
        {/* R54: h1 follows the UI language client-side (ListingH1). */}
        <ListingH1 listing={l} />
        {isWanted && !isSeeker && <WantedBadge />}
        {/* R54: price + negotiable badge follow the UI language client-side
            (ListingPrice). Darija parenthetical stays Arabic (Zak, 21 Sep). */}
        <ListingPrice
          price={l.price || 0}
          negotiable={!!(l as { negotiable?: boolean }).negotiable}
          priceWords={priceWords}
          priceReduced={!!(l as { priceReduced?: boolean }).priceReduced}
        />
        <MetaGrid
          wilayaCode={l.wilayaCode}
          condition={l.condition}
          categoryId={l.categoryId}
          createdAtISO={l.createdAt ? l.createdAt.toISOString() : null}
          answers={l.answers as Record<string, unknown> | undefined}
          isWanted={isWanted}
          negotiable={(l as { negotiable?: boolean }).negotiable}
          price={l.price}
        />
        {/* js/app.js FIX-WEB-025 parity: stat-row under the meta grid —
            views with proper Arabic plurals + favorite count (public
            popularity signal). Legacy markup:
            <div class="stat-row"><span>👁 viewsText(l.views)</span>
            <span>♥ favCount inFavorites</span></div>. */}
        <StatRow listingId={id} views={l.views} favoriteCount={l.favoriteCount} />
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
          <ActionsLoader
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
      <div className="mt-4 rounded-xl bg-white border border-[#e5e7eb] shadow-[0_1px_3px_rgba(16,24,20,.06)] p-[10px]">
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
          js/market.js matchingOffers); regular ads show similar ads.
          R33-1: the .listing-matches wrapper exists only so the print
          stylesheet can hide this discovery section; it carries no
          screen styling, so screen rendering is unchanged. */}
      <div className="listing-matches">
      {isWanted ? (
        similarWindow !== null && (
          <MatchesLoader
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
      </div>

    </main>
    </>
  );
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Round 14 (12 Oct 2026): the REAL HTTP 404 now comes from the Edge
  // proxy (src/proxy.ts + src/proxy-404.ts), which checks Firestore
  // BEFORE rendering/streaming starts. The earlier Round-12 approach of
  // notFound() at this point kept HTTP 200: with cacheComponents:true
  // the page-body await is postponed (x-nextjs-postponed: 1), so the 200
  // headers were sent before notFound() threw (verified via curl on a
  // local production build 12 Oct 2026). Retained only as a harmless
  // fallback for the no-proxy case.
  let listing: ListingDetail | null = null;
  let fetchFailed = false;
  try {
    listing = await getListing(id);
  } catch {
    fetchFailed = true;
  }

  // fetchListing returns null for genuinely missing listings (404/403 —
  // incl. sold/hidden docs for anonymous readers). That is a real 404.
  if (!listing && !fetchFailed) notFound();

  // A THROWN fetch (network/5xx/429) is a transient failure — the listing
  // may well exist. HTTP 200 + retry UI (Round 9), never a 404.
  if (!listing) {
    return (
      <ListingDir>
        <TransientErrorView id={id} />
      </ListingDir>
    );
  }

  // R13 AX-F1 (18 Oct 2026), fixed R15b BB-2: the per-listing JSON-LD
  // <script> renders ONCE via the dedicated <ListingJsonLd> Server
  // Component (./ListingJsonLd.tsx). Inlined JSX duplicated it under PPR
  // (two byte-identical streamed chunks) — first inside <ListingDir>
  // (client boundary), then as a fragment sibling. The separate component
  // renders in the static shell. '<' is escaped (\u003c) so user content
  // can never break out of the script. 21 Oct 2026 (audit D1): 1-DZD
  // no-price listings now emit Product (no offers — BW-1) + BreadcrumbList;
  // seoForListing returns null only when there is no real photo/description.
  // R54 (18 Oct 2026): JSON-LD stays Arabic — crawlers never send the
  // dlala_lang cookie, and SSR must be language-invariant (see top).
  const pageLang = 'ar' as const;
  let jsonLdScript = '';
  try {
    const seo = seoForListing(listing, id, pageLang);
    if (seo.jsonLd)
      jsonLdScript = JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c');
  } catch {
    jsonLdScript = '';
  }

  return (
    <>
      <TrackView id={id} />
      <Suspense fallback={null}>
        <ListingJsonLd json={jsonLdScript} />
      </Suspense>
      <ListingDir>
        <Suspense fallback={<ListingSkeleton />}>
          <ListingContent params={params} listing={listing} />
        </Suspense>
      </ListingDir>
    </>
  );
}
