// Dlala seller profile — Server-Side Rendered.
//
// Pattern (Next.js 16 Cache Components + Partial Prefetching):
//   - The route shell prerenders instantly.
//   - <Suspense> wraps the params-dependent fetches: first visit to a UID
//     renders on demand, then the result is cached (ISR, 60s revalidate).
//     Subsequent visits serve from cache.
//   - The public profile doc (users_public/{uid}) and the seller's active
//     listings are fetched server-side via Firestore REST — zero Firebase
//     SDK on the server path.
//
// Round 111: the server only fetches the data — all language-dependent
// rendering moved to the client <SellerPage> shell (NotFoundView, hero,
// profile card, infos tab via useLang(); js/i18n.js onLangChange parity;
// same pattern as the home page Round 107 and search Round 109).

import { Suspense } from 'react';
import { cacheLife } from 'next/cache';
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

async function getSeller(uid: string): Promise<SellerProfile | null> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchSeller(uid);
}

// js/seller.js R3 parity: the grid starts at 30 ads; "Show more" adds +30.
async function getSellerListings(uid: string): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchSellerListings(uid, SELLER_LISTINGS_PAGE_SIZE);
}

function SellerSkeleton() {
  return (
    <main className="max-w-6xl mx-auto px-4 py-6" dir="rtl">
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

async function SellerContent({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;

  let seller: SellerProfile | null = null;
  let listings: ListingCard[] = [];
  let ratings: SellerRating[] | null = null;
  let ratingsFailed = false;
  try {
    const [s, ls] = await Promise.all([getSeller(uid), getSellerListings(uid)]);
    seller = s;
    listings = ls;
  } catch {
    // Missing seller renders the trilingual 404 inside <SellerPage>.
    seller = null;
  }

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

export default function SellerPageRoute({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <Suspense fallback={<SellerSkeleton />}>
        <SellerContent params={params} />
      </Suspense>
    </div>
  );
}
