'use client';

// Vitrine showcase card — ported from vitrineCardHTML() in
// ~/workspace/dlala-040/js/home.js (Minimal Editorial vitrine, Design 3).
//
// Renders a merchant's showcase: seller header (name, badges, rating,
// followers, follow button) + grid of up to 8 product minis.
// Any tap inside the card counts as interaction (R17 no-repeat model).

import Link from 'next/link';
import { cardTitle, cardImage, formatPrice, type ListingCard } from '@/lib/firestore';
import { markVitrineInteracted, type VitrineShowcase as Showcase } from '@/lib/vitrine';
import TimeAgo from '@/components/TimeAgo';
import BlurUpImage from '@/components/BlurUpImage';
import FavoriteToggle from '@/components/FavoriteToggle';

function condLabel(cond: string | undefined): string {
  if (cond === 'new') return 'جديد';
  if (cond === 'good') return 'جيد';
  if (cond === 'used') return 'مستعمل';
  return '';
}

function MiniProduct({ p }: { p: ListingCard }) {
  const img = cardImage(p);
  const favCount = Number(p.favoriteCount) || 0;
  const cond = condLabel(p.condition);
  return (
    <div className="vitrine-mini">
      <Link href={`/listing/${p.id}`} className="vitrine-thumb relative block">
        <div className="relative aspect-square bg-zinc-100 rounded-lg overflow-hidden">
          {img ? (
            <BlurUpImage
              listing={p}
              img={img}
              alt={cardTitle(p)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-2xl">
              📷
            </div>
          )}
          {favCount > 0 && (
            <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
              ♥ {favCount}
            </span>
          )}
          {/* 16 Sep 2026 (js/home.js .fav-heart.vitrine-fav parity): minis
              carry interactive hearts — own listings and sold get none. */}
          {p.status !== 'sold' && (
            <FavoriteToggle
              compact
              listingId={p.id}
              sellerId={p.sellerId || ''}
              initialCount={favCount}
              title={cardTitle(p)}
              price={p.price || 0}
              photoUrl={img || ''}
            />
          )}
        </div>
      </Link>
      <div className="vitrine-mini-info mt-1">
        {p.price != null && p.price !== 0 && (
          <span className="vitrine-mini-price block text-sm font-bold text-emerald-700">
            {formatPrice(p.price)}
          </span>
        )}
        <span className="vitrine-mini-meta block text-[11px] text-zinc-500">
          {cond && <span className="vitrine-mini-cond">{cond}</span>}
          {cond && p.createdAt && ' · '}
          {p.createdAt && <TimeAgo iso={p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt)} />}
        </span>
      </div>
    </div>
  );
}

export default function VitrineShowcase({ showcase }: { showcase: Showcase }) {
  const { seller, products, isPro } = showcase;
  const sid = seller.id;
  // 18 Sep 2026 (Zak): verified pro sellers show their STORE name.
  const displayName =
    seller.storeTier === 'verified' && seller.storeName
      ? seller.storeName
      : seller.name || '?';
  const nameParts = displayName.trim().split(/\s+/);
  const rNum = Number(seller.rating);
  const rTxt = seller.ratingCount
    ? `${isFinite(rNum) ? rNum.toFixed(1) : '—'} ★ (${Number(seller.ratingCount) || 0})`
    : '';
  const fCount = Number(seller.followerCount) || 0;
  const verified = seller.verified === true || seller.emailVerified === true;

  const handleClick = () => {
    // R17: any tap inside a vitrine card counts as interaction.
    markVitrineInteracted(sid);
  };

  return (
    <article
      className="vitrine-card rounded-xl bg-white shadow-sm overflow-hidden border-2 border-amber-200"
      data-vseller={sid}
      onClick={handleClick}
      dir="rtl"
    >
      <div className="vitrine-head flex items-center justify-between p-3 border-b border-zinc-100">
        <Link href={`/seller/${sid}`} className="vitrine-id flex-1 min-w-0">
          <span className="vitrine-name block font-bold text-zinc-900 truncate">
            {nameParts.length > 1 ? (
              <>
                {nameParts[0]} <em className="not-italic text-emerald-700">{nameParts.slice(1).join(' ')}</em>
              </>
            ) : (
              nameParts[0]
            )}
            {verified && <span className="vbadge text-emerald-600 mr-1">✓</span>}
          </span>
          <span className="vitrine-meta flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
            {isPro && (
              <span className="pro-badge rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                ★ تاجر محترف
              </span>
            )}
            {rTxt && <span className="vitrine-sub">{rTxt}</span>}
            <span className="vitrine-sub">👥 {fCount} متابِع</span>
          </span>
        </Link>
        <button
          className="follow-btn shrink-0 rounded-full border border-emerald-700 px-3 py-1 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
          data-follow={sid}
          aria-pressed="false"
        >
          + تابع
        </button>
      </div>
      <div className="vitrine-grid grid grid-cols-4 gap-2 p-3">
        {products.slice(0, 8).map((p) => (
          <MiniProduct key={String(p.id)} p={p} />
        ))}
      </div>
      {isPro && (
        <Link
          href={`/seller/${sid}`}
          className="vitrine-cta flex items-center justify-center gap-1 p-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 border-t border-zinc-100"
        >
          <span>اكتشف المتجر</span>
          <span className="vitrine-arrow">←</span>
        </Link>
      )}
    </article>
  );
}
