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
import Link from 'next/link';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';
import {
  fetchListing,
  cardTitle,
  cardImage,
  formatPrice,
  type ListingDetail,
} from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import TimeAgo from '@/components/TimeAgo';
import ListingActions from './ListingActions';

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
  const mainPhoto = photos[0] || cardImage(l);
  const title = cardTitle(l);

  return (
    <main className="max-w-4xl mx-auto px-4 py-6" dir="rtl">
      {/* Gallery */}
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        {mainPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mainPhoto}
            alt={title}
            className="w-full aspect-[4/3] object-cover"
          />
        ) : (
          <div className="w-full aspect-[4/3] flex items-center justify-center text-zinc-300 text-6xl bg-zinc-100">
            📷
          </div>
        )}
        {photos.length > 1 && (
          <div className="flex gap-2 p-3 overflow-x-auto">
            {photos.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={p}
                alt={`${title} — صورة ${i + 1}/${photos.length}`}
                loading="lazy"
                className="w-20 h-20 object-cover rounded-lg shrink-0"
              />
            ))}
          </div>
        )}
      </div>

      {/* Head: title / price / meta */}
      <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
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
            photoUrl={mainPhoto || ''}
            sold={l.status === 'sold'}
          />
        )}
      </div>

      {/* Seller card — denormalized fast path (R11-RADICAL) */}
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

      {/* Description */}
      {description(l) && (
        <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
          <h2 className="text-lg font-semibold mb-2">الوصف</h2>
          <p className="whitespace-pre-wrap text-zinc-800">{description(l)}</p>
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
