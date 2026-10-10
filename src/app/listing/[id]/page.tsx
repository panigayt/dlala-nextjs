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
  cardTitle,
  cardImage,
  formatPrice,
  type ListingCard,
  type ListingDetail,
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
import ListingActions from './ListingActions';
import OwnerSellerCard from './OwnerSellerCard';
import Gallery from './Gallery';
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

function Header() {
  return (
    <header className="sticky top-0 z-10 bg-emerald-700 text-white shadow">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold">دلالة</Link>
        <nav className="text-sm">سوق الجزائر للإعلانات المبوبة</nav>
      </div>
    </header>
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
  // js/listing.js loadMatches parity: similar ads (same category, max 12).
  // null = fetch failed -> render nothing (legacy catch behavior).
  let similar: ListingCard[] | null = null;
  if (l.categoryId) {
    try {
      similar = await fetchSimilarListings(l.categoryId, Number(l.wilayaCode) || 0, id);
    } catch {
      similar = null;
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-6" dir="rtl">
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
          (client component; mirrors js/listing.js LIS-8 gallery). */}
      <Gallery photos={photos} fallback={cardImage(l)} title={title} />

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
          {typeof l.views === 'number' && (
            <div>
              <span className="text-zinc-500">المشاهدات: </span>
              <b>{l.views}</b>
            </div>
          )}
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
          parity, via OwnerSellerCard). */}
      <OwnerSellerCard sellerId={l.sellerId}>
      <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
        <h2 className="text-lg font-semibold">البائع</h2>
        {(l as unknown as { sellerName?: string; sellerPhotoUrl?: string }).sellerName ? (
          <div className="mt-2 flex items-center gap-3">
            {(l as unknown as { sellerPhotoUrl?: string }).sellerPhotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={(l as unknown as { sellerPhotoUrl?: string }).sellerPhotoUrl}
                alt=""
                className="w-12 h-12 rounded-full object-cover"
              />
            )}
            <Link
              href={`/seller/${l.sellerId}`}
              className="font-bold text-emerald-700 hover:underline"
            >
              {(l as unknown as { sellerName?: string }).sellerName}
            </Link>
          </div>
        ) : (
            <Link
              href={`/seller/${l.sellerId}`}
              className="mt-2 inline-block font-bold text-emerald-700 hover:underline"
            >
              عرض صفحة البائع
            </Link>
        )}
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

      {/* Similar ads — same category, max 12 (js/listing.js loadMatches) */}
      {similar !== null && (
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
      <Header />
      <Suspense fallback={<ListingSkeleton />}>
        <ListingContent params={params} />
      </Suspense>
    </div>
  );
}
