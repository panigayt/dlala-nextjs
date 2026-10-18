// Dlala seller profile — Server-Side Rendered.
//
// Pattern (Next.js 16 Cache Components + Partial Prefetching):
//   - The route shell prerenders instantly.
//   - <Suspense> wraps the params-dependent fetches: first visit to a UID
//     renders on demand, then the result is cached (ISR, 60s revalidate).
//     Subsequent visits serve from cache.
//   - The public profile doc (users/{uid}) and the seller's active
//     listings are fetched server-side via Firestore REST — zero Firebase
//     SDK on the server path.
//
// Round 111: the server only fetches the data — all language-dependent
// rendering moved to the client <SellerPage> shell (NotFoundView, hero,
// profile card, infos tab via useLang(); js/i18n.js onLangChange parity;
// same pattern as the home page Round 107 and search Round 109).

// Round 14 (12 Oct 2026): the REAL HTTP 404 now comes from the Edge
// proxy (src/proxy.ts + src/proxy-404.ts) — it runs the Firestore
// existence check (documents/users/{uid}: 404/403 → real 404;
// transient check failures fail open to this page) BEFORE any
// rendering/streaming starts. The earlier Round-12 plan of notFound()
// kept HTTP 200 under cacheComponents:true PPR (verified via curl on
// a local production build 12 Oct 2026), so it is retained only as a
// harmless fallback for the no-proxy case: the dynamic metadata also
// streams after the 200 headers are sent, so a notFound() here cannot
// set the 404 status either.
export async function generateMetadata({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  let seller: SellerProfile | null = null;
  let fetchFailed = false;
  try {
    seller = await getSeller(uid);
  } catch {
    // Transient fetch failure — noindex fallback; the page body renders the
    // in-page error view at HTTP 200 (never a 404 for a failed fetch).
    fetchFailed = true;
  }
  if (!seller && !fetchFailed) notFound();
  if (!seller) return { title: 'DLALA', robots: { index: false, follow: false } };
  return {
    title: `DLALA — ${seller.name || 'Seller'}`,
    alternates: { canonical: 'https://www.dzdlala.com/seller/' + encodeURIComponent(uid) },
  };
}

import { Suspense, cache } from 'react';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';
import SellerPage from '@/components/SellerPage';
import {
  fetchSeller,
  fetchSellerListings,
  fetchSellerRatings,
  SELLER_LISTINGS_PAGE_SIZE,
  type ListingCard,
  type SellerProfile,
  type SellerRating,
} from '@/lib/firestore';

async function _getSeller(uid: string): Promise<SellerProfile | null> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchSeller(uid);
}

// Round 12 (12 Oct 2026): React cache() dedupes the existence check across
// generateMetadata + the page body within one request — one Firestore read.
const getSeller = cache(_getSeller);

// js/seller.js R3 parity: the grid starts at 30 ads; "Show more" adds +30.
async function getSellerListings(uid: string): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchSellerListings(uid, SELLER_LISTINGS_PAGE_SIZE);
}

function SellerSkeleton() {
  return (
    <main id="main-content" className="max-w-6xl mx-auto px-4 py-6" dir="rtl">
      <div className="rounded-xl bg-white shadow-sm p-6">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-zinc-200 animate-pulse" />
          <div className="flex-1">
            <div className="h-6 bg-zinc-200 rounded animate-pulse w-1/3" />
            <div className="mt-2 h-4 bg-zinc-200 rounded animate-pulse w-1/4" />
          </div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="aspect-[4/3] bg-zinc-200 animate-pulse" />
            <div className="p-3">
              <div className="h-5 bg-zinc-200 rounded animate-pulse w-2/3" />
              <div className="mt-2 h-4 bg-zinc-200 rounded animate-pulse w-full" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

async function SellerContent({
  uid,
  seller,
  listings,
}: {
  uid: string;
  // Round 12: the existence check ran in the page body (ONE read shared via
  // the React-cache-deduped getSeller). seller is null only on a transient
  // fetch failure — SellerPage renders its in-page error view at HTTP 200
  // (a failed fetch is never a 404).
  seller: SellerProfile | null;
  listings: ListingCard[];
}) {
  let ratings: SellerRating[] | null = null;
  let ratingsFailed = false;

  if (seller) {
    // Ratings are secondary content (js/seller.js loadRatings): a failed
    // fetch shows an error box with retry inside the Infos tab — it never
    // fails the whole profile.
    try {
      ratings = await fetchSellerRatings(uid);
    } catch {
      ratingsFailed = true;
    }
  }

  return (
    <SellerPage
      uid={uid}
      seller={seller}
      listings={listings}
      ratings={ratings}
      ratingsFailed={ratingsFailed}
    />
  );
}

export default async function SellerPageRoute({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;

  // Round 14 (12 Oct 2026): the REAL HTTP 404 now comes from the Edge
  // proxy (src/proxy.ts + src/proxy-404.ts), which checks Firestore
  // (documents/users/{uid}) BEFORE rendering/streaming starts.
  // The earlier Round-12 approach of notFound() at this point kept
  // HTTP 200: with cacheComponents:true the page-body await is postponed
  // (x-nextjs-postponed: 1), so the 200 headers were sent before notFound()
  // threw (verified via curl on a local production build 12 Oct 2026).
  // Retained only as a harmless fallback for the no-proxy case.
  let seller: SellerProfile | null = null;
  let listings: ListingCard[] = [];
  let sellerFailed = false;
  try {
    // Seller + listings fetched in parallel (js/seller.js parity); both
    // reads share the React-cache-deduped fetch with generateMetadata.
    const [s, ls] = await Promise.all([getSeller(uid), getSellerListings(uid)]);
    seller = s;
    listings = ls;
  } catch {
    // Fetch failure: render the in-page error view (not a 404 — a transient
    // error must not tell crawlers the profile is gone).
    sellerFailed = true;
  }

  // Genuinely missing seller (null) → real HTTP 404. A THROWN fetch is
  // transient — the in-page error view at HTTP 200, never a 404.
  if (!seller && !sellerFailed) notFound();

  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <Suspense fallback={<SellerSkeleton />}>
        <SellerContent uid={uid} seller={seller} listings={listings} />
      </Suspense>
    </div>
  );
}
