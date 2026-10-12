'use client';

// Vitrine showcase card — ported from vitrineCardHTML() in
// ~/workspace/dlala-040/js/home.js (Minimal Editorial vitrine, Design 3,
// chosen by Zak 16 Sep 2026).
//
// Renders a merchant's showcase: seller header (name, badges, rating,
// followers, follow button) + grid of up to 8 product minis.
// Any tap inside the card counts as interaction (R17 no-repeat model).
//
// Round 103: markup + styling aligned EXACTLY with 0.0.0.39 — the component
// uses the verbatim legacy class names (see src/app/vitrine.css, ported from
// dlala-040 css/style.css) instead of Tailwind approximations.

import Link from 'next/link';
import { cardTitle, cardImage, formatPrice, type ListingCard } from '@/lib/firestore';
import { markVitrineInteracted, type VitrineShowcase as Showcase } from '@/lib/vitrine';
import { useLang } from '@/lib/i18n';
import TimeAgo from '@/components/TimeAgo';
import BlurUpImage from '@/components/BlurUpImage';
import FavoriteToggle from '@/components/FavoriteToggle';
import VitrineFollowButton from '@/components/VitrineFollowButton';

function MiniProduct({ p }: { p: ListingCard }) {
  const { t, lang } = useLang();
  const img = cardImage(p);
  const favCount = Number(p.favoriteCount) || 0;
  // Round 107: condition label follows the UI language (trilingual parity).
  const cond =
    p.condition === 'new' ? t('condNew') : p.condition === 'good' ? t('condGood') : p.condition === 'used' ? t('condUsed') : '';
  const iso = p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt || '');
  return (
    <div className="vitrine-mini">
      <Link href={`/listing/${p.id}`} className="vitrine-thumb">
        {img ? (
          <BlurUpImage listing={p} img={img} alt={cardTitle(p, lang)} />
        ) : (
          <span className="vitrine-thumb-empty" aria-hidden="true">
            📷
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
            title={cardTitle(p, lang)}
            price={p.price || 0}
            photoUrl={img || ''}
          />
        )}
        {favCount > 0 && <span className="badge badge-likes">♥ {favCount}</span>}
      </Link>
      <div className="vitrine-mini-info">
        {p.price != null && p.price !== 0 && (
          <span className="vitrine-mini-price">{formatPrice(p.price, lang)}</span>
        )}
        {(cond || p.createdAt) && (
          <span className="vitrine-mini-meta">
            {cond && <span className="vitrine-mini-cond">{cond}</span>}
            {p.createdAt && (
              <span className="vitrine-mini-date">
                {' · '}
                <TimeAgo iso={iso} lang={lang} />
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export default function VitrineShowcase({ showcase, uid }: { showcase: Showcase; uid?: string }) {
  const { t, lang } = useLang();
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
    // 12 Oct 2026: pass uid for per-user isolation (was global key).
    markVitrineInteracted(sid, uid);
  };

  return (
    <article className="vitrine-card" data-vseller={sid} onClick={handleClick} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="vitrine-head">
        <Link href={`/seller/${sid}`} className="vitrine-id">
          <span className="vitrine-name">
            {nameParts.length > 1 ? (
              <>
                {nameParts[0]} <em>{nameParts.slice(1).join(' ')}</em>
              </>
            ) : (
              nameParts[0]
            )}
            {verified && <span className="vbadge"> ✓</span>}
          </span>
          <span className="vitrine-meta">
            {isPro && <span className="pro-badge">★ {t('proMerchant')}</span>}
            {rTxt && <span className="vitrine-sub">{rTxt}</span>}
            <span className="vitrine-sub">👥 {fCount} {t('followers')}</span>
          </span>
        </Link>
        {/* Round 104: wired to the shared follow logic (js/app.js v101
            armFollowButtons parity) — was a dead button with no handler. */}
        <VitrineFollowButton storeUid={sid} />
      </div>
      <div className="vitrine-grid">
        {products.slice(0, 8).map((p) => (
          <MiniProduct key={String(p.id)} p={p} />
        ))}
      </div>
      {isPro && (
        <Link href={`/seller/${sid}`} className="vitrine-cta">
          <span>{t('discoverStore')}</span>
          {/* Legacy: arrow points left in RTL, right in LTR. */}
          <span className="vitrine-arrow">{lang === 'ar' ? '←' : '→'}</span>
        </Link>
      )}
    </article>
  );
}
