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
import FollowButton from './FollowButton';
import SellerActions from './SellerActions';
import RatingsList from './RatingsList';
import SellerTabs from './SellerTabs';
import {
  fetchSeller,
  fetchSellerListings,
  fetchSellerRatings,
  cardTitle,
  cardImage,
  formatPrice,
  type ListingCard,
  type SellerProfile,
  type SellerRating,
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

// ---------- pro-store hero helpers (js/seller.js renderStoreHero parity) ----------

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

function StoreHero({ s, uid }: { s: SellerProfile; uid: string }) {
  const displayName = s.storeName || s.name || s.username || '';
  const logo = storeLogoSrc(s);
  const cover = cssSafeUrl(s.storeCoverUrl);
  const bio = String(s.storeBio || '');
  const isVerified = s.verified === true || s.emailVerified === true;
  const ratingNum = Number(s.rating);
  const ratingTxt = s.ratingCount
    ? isFinite(ratingNum)
      ? ratingNum.toFixed(1)
      : '—'
    : '—';
  const deals = Number(s.confirmedDeals) || 0;
  const followersCount = Number(s.followerCount) || 0;
  const memberSince =
    s.createdAt instanceof Date && !isNaN(s.createdAt.getTime())
      ? s.createdAt.toLocaleDateString('ar-DZ', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '';

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden" dir="rtl">
      {cover && (
        <div
          className="h-36 sm:h-44 bg-zinc-200 bg-cover bg-center"
          style={{ backgroundImage: `url("${cover}")` }}
          role="img"
          aria-label={displayName}
        />
      )}
      <div className={`p-6${cover ? ' -mt-12 relative' : ''}`}>
        <div className="flex items-start gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={displayName}
              className="w-20 h-20 rounded-full object-cover shrink-0 border-4 border-white shadow"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl font-bold shrink-0 border-4 border-white shadow">
              {displayName ? displayName.charAt(0) : '?'}
            </div>
          )}
          <div className="min-w-0 pt-1">
            <h1 className="text-2xl font-bold text-zinc-900 truncate">
              {displayName}
              {isVerified && (
                <span className="text-emerald-600 text-xl mr-1" title="موثّق">✓</span>
              )}
            </h1>
            <p className="mt-1">
              <span className="inline-block rounded-full bg-amber-100 text-amber-800 text-sm font-bold px-3 py-0.5">
                ★ تاجر محترف
              </span>
            </p>
            {bio && <p className="mt-2 text-zinc-700">{bio}</p>}
            <p className="mt-1 text-sm text-zinc-600">🚚 توصيل لجميع الولايات</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-600 border-t border-zinc-100 pt-4">
          <span>
            ★ <b className="text-zinc-900">{ratingTxt}</b> التقييم
          </span>
          <span>
            🤝 <b className="text-zinc-900">{deals}</b> صفقات مؤكدة
          </span>
          <span>
            👥 <b className="text-zinc-900">{followersCount}</b> متابع
          </span>
          {memberSince && (
            <span>
              عضو منذ: <b className="text-zinc-900">{memberSince}</b>
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-3 items-stretch">
          <div className="flex-1 min-w-[220px]">
            <FollowButton storeUid={uid} />
          </div>
          <SellerActions uid={uid} storeName={displayName} />
        </div>
      </div>
    </div>
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
  // js/seller.js parity: legacy accepts verified===true OR emailVerified===true.
  const isVerified = s.verified === true || s.emailVerified === true;
  const followersCount = Number(s.followerCount) || 0;
  const memberSince =
    s.createdAt instanceof Date && !isNaN(s.createdAt.getTime())
      ? s.createdAt.toLocaleDateString('ar-DZ', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '';

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
            {isVerified && (
              <span className="text-emerald-600 text-xl mr-1" title="موثّق">✓</span>
            )}
          </h1>
          {s.username && s.username !== displayName && (
            <p className="text-sm text-zinc-500" dir="ltr">@{s.username}</p>
          )}
          <p className="mt-1 text-sm text-zinc-600">
            {rating && <span>{rating}</span>}
            {rating && followersCount > 0 && <span> · </span>}
            {followersCount > 0 && (
              <span>👥 {followersCount} متابع</span>
            )}
            {memberSince && (
              <span className="block text-xs text-zinc-500 mt-0.5">
                عضو منذ {memberSince}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function SellerInfosTab({ s }: { s: SellerProfile }) {
  // js/seller.js parity (QA 16 Sep 2026 #8): the Infos tab opens with an
  // about block — bio plus a locale-correct member-since date.
  const bio = String(s.bio || '');
  const memberSince =
    s.createdAt instanceof Date && !isNaN(s.createdAt.getTime())
      ? s.createdAt.toLocaleDateString('ar-DZ', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '';
  const ratingNum = Number(s.rating);
  const hasRating = isFinite(ratingNum) && ratingNum > 0;

  return (
    <div className="rounded-xl bg-white shadow-sm p-6" dir="rtl">
      <h2 className="text-lg font-bold text-zinc-900 mb-4">المعلومات</h2>
      {bio ? (
        <p className="text-zinc-700 mb-4">{bio}</p>
      ) : (
        <p className="text-zinc-400 text-sm mb-4">لا توجد نبذة بعد.</p>
      )}
      <dl className="space-y-2 text-sm">
        {memberSince && (
          <div className="flex gap-2">
            <dt className="text-zinc-500">عضو منذ:</dt>
            <dd className="font-medium text-zinc-900">{memberSince}</dd>
          </div>
        )}
        {hasRating && (
          <div className="flex gap-2">
            <dt className="text-zinc-500">التقييم:</dt>
            <dd className="font-medium text-zinc-900">
              {ratingNum.toFixed(1)} ★ ({Number(s.ratingCount) || 0})
            </dd>
          </div>
        )}
        {s.username && (
          <div className="flex gap-2">
            <dt className="text-zinc-500">اسم المستخدم:</dt>
            <dd className="font-medium text-zinc-900" dir="ltr">@{s.username}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

async function SellerContent({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;

  let seller: SellerProfile | null = null;
  let listings: ListingCard[] = [];
  let ratings: SellerRating[] | null = null;
  let ratingsFailed = false;
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

  // Ratings are secondary content (js/seller.js loadRatings): a failed
  // fetch shows an error box with retry inside the Infos tab — it never
  // fails the whole profile.
  try {
    ratings = await fetchSellerRatings(uid);
  } catch {
    ratingsFailed = true;
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
    <main className="max-w-6xl mx-auto px-4 py-6" dir="rtl">
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

      <SellerTabs
        uid={uid}
        isPro={seller.storeTier === 'verified'}
        listingsCount={listings.length}
        listings={
          listings.length === 0 ? (
            <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
              لا توجد إعلانات متاحة حاليا.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {listings.map((l) => (
                <ListingCardView key={l.id} l={l} />
              ))}
            </div>
          )
        }
        infos={
          <>
            <SellerInfosTab s={seller} />
            <div className="mt-4">
              <RatingsList ratings={ratings} failed={ratingsFailed} />
            </div>
          </>
        }
      />
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
