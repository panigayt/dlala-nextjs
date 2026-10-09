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
//   - Missing seller (404) renders the trilingual 404.

import { Suspense } from 'react';
import Link from 'next/link';
import { cacheLife } from 'next/cache';
import {
  fetchSeller,
  fetchSellerListings,
  cardTitle,
  cardImage,
  formatPrice,
  type ListingCard,
  type SellerProfile,
} from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import TimeAgo from '@/components/TimeAgo';

async function getSeller(uid: string): Promise<SellerProfile | null> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchSeller(uid);
}

async function getSellerListings(uid: string): Promise<ListingCard[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchSellerListings(uid, 24);
}

function wilayaName(code: number | undefined): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string }[]).find((x) => x.code === Number(code));
  return w ? `${w.code} - ${w.ar}` : '';
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

function NotFoundView() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center" dir="rtl">
      <div className="text-6xl font-bold text-emerald-700">D</div>
      <h1 className="mt-4 text-4xl font-bold">404</h1>
      <h2 className="mt-2 text-xl" lang="ar" dir="rtl">هذا البائع غير موجود</h2>
      <p className="mt-2 text-zinc-600" lang="ar" dir="rtl">
        ربما تم حذف الحساب أو أن الرابط غير صحيح.
      </p>
      <p className="mt-1 text-zinc-600" lang="fr">Ce vendeur n&rsquo;existe pas ou a été supprimé.</p>
      <p className="mt-1 text-zinc-600" lang="en">This seller does not exist or was removed.</p>
      <div className="mt-6">
        <Link href="/" className="inline-block rounded-lg bg-emerald-700 text-white px-6 py-3 font-medium">
          تصفح الإعلانات
        </Link>
      </div>
    </div>
  );
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

function ListingCardView({ l }: { l: ListingCard }) {
  const img = cardImage(l);
  return (
    <a
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
    </a>
  );
}

function SellerProfileCard({ s }: { s: SellerProfile }) {
  const ratingNum = Number(s.rating);
  const hasRating = isFinite(ratingNum) && ratingNum > 0;
  const ratingTxt = hasRating ? ratingNum.toFixed(1) + ' ★' : '';
  const rating = s.ratingCount
    ? `${ratingTxt} (${Number(s.ratingCount) || 0})`
    : ratingTxt;
  // Verified pro sellers show their store name (matches production SPA).
  const displayName =
    s.storeTier === 'verified' && s.storeName ? s.storeName : s.name || s.username || '';
  const photo = s.photoUrl || '';

  return (
    <div className="rounded-xl bg-white shadow-sm p-6" dir="rtl">
      <div className="flex items-center gap-4">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={displayName}
            className="w-20 h-20 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl font-bold shrink-0">
            {displayName ? displayName.charAt(0) : '?'}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-zinc-900 truncate">
            {displayName}
            {s.verified === true && (
              <span className="text-emerald-600 text-xl mr-1" title="موثّق">✓</span>
            )}
          </h1>
          {s.username && s.username !== displayName && (
            <p className="text-sm text-zinc-500" dir="ltr">@{s.username}</p>
          )}
          {(rating || s.verified === true) && (
            <p className="mt-1 text-sm text-zinc-600">
              {rating} {s.verified === true && !rating ? '✓ موثّق' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

async function SellerContent({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;

  let seller: SellerProfile | null = null;
  let listings: ListingCard[] = [];
  let error: string | null = null;
  try {
    const [s, ls] = await Promise.all([getSeller(uid), getSellerListings(uid)]);
    seller = s;
    listings = ls;
  } catch (e) {
    error = e instanceof Error ? e.message : 'seller-error';
  }

  if (!seller || error) {
    return <NotFoundView />;
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-6" dir="rtl">
      <SellerProfileCard s={seller} />

      <h2 className="mt-8 mb-4 text-lg font-semibold text-zinc-800">
        إعلانات البائع ({listings.length})
      </h2>

      {listings.length === 0 ? (
        <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
          لا توجد إعلانات متاحة حاليا.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {listings.map((l) => (
            <ListingCardView key={l.id} l={l} />
          ))}
        </div>
      )}

      <p className="mt-8 text-center text-xs text-zinc-400">SSR + ISR (60s) · Next.js · $0/month</p>
    </main>
  );
}

export default function SellerPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <Header />
      <Suspense fallback={<SellerSkeleton />}>
        <SellerContent params={params} />
      </Suspense>
    </div>
  );
}
