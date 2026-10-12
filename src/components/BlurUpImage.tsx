'use client';

// Listing card image with LQIP blur-up — js/app.js Speed 29 parity.
//
// Listings with the photoVariants flag (R11+ publishes) get blur-up:
//   - src starts as the ~0.5KB w32 LQIP (paints in ~50ms, blurred via CSS)
//   - a delegated capture-phase load handler preloads data-hi, then swaps
//     src and unblurs (.hi CSS transition)
//   - desktop gets a <picture> W640 gate (media="(min-width: 861px)") so
//     mobile never downloads W640; data-hi matches the W640 source on
//     desktop so the "upgrade" is a cache hit, not a new fetch
// Listings without derivable variants render today's plain <img> — zero
// behavior change, zero extra requests (old listings, non-variant URLs).

import { useEffect, useState, useSyncExternalStore } from 'react';
import { lqipUrlFor, variantUrlFor } from '@/lib/image-variants';

export interface BlurUpListing {
  photoVariants?: boolean;
  photoUrls?: string[];
}

// Verbatim js/app.js Speed 29 delegated hi-res upgrade. Installed once per
// page (module guard). load events don't bubble but DO fire in capture phase
// (same pattern as legacy's error delegation).
let blurUpInstalled = false;

function installBlurUpHandler(): void {
  if (blurUpInstalled) return;
  blurUpInstalled = true;
  if (typeof document === 'undefined' || !document.addEventListener) return;
  document.addEventListener(
    'load',
    (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== 'IMG' || !t.classList || !t.classList.contains('img-blurup')) return;
      if (t.getAttribute('data-done') === '1') return; // one claim per img
      t.setAttribute('data-done', '1');
      try {
        const hi0 = t.getAttribute('data-hi');
        if (!hi0) {
          t.classList.add('hi');
          return;
        }
        const pre = new Image();
        try {
          pre.decoding = 'async';
        } catch {
          /* noop */
        }
        try {
          if (t.getAttribute('data-prio') === 'high' && 'fetchPriority' in pre) {
            (pre as { fetchPriority?: string }).fetchPriority = 'high';
          }
        } catch {
          /* noop */
        }
        pre.onload = () => {
          try {
            if (!t.isConnected) return;
            const hiNow = t.getAttribute('data-hi'); // re-read: may be hero now
            if (hiNow) (t as HTMLImageElement).src = hiNow; // identical URL = no-op
            t.classList.add('hi');
          } catch {
            /* noop */
          }
        };
        pre.onerror = () => {}; // keep the blurred LQIP — better than broken
        pre.src = hi0;
      } catch {
        try {
          t.classList.add('hi');
        } catch {
          /* noop */
        }
      }
    },
    true
  );
}

// Hydration-safe desktop detection (useSyncExternalStore: server snapshot
// false matches SSR; the client subscribes to matchMedia changes). data-hi
// is re-read at swap time, so a late correction can never downgrade the
// upgrade target.
function subscribeDesktopWidth(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia('(min-width: 861px)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function getDesktopWidth(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(min-width: 861px)').matches;
  } catch {
    return false;
  }
}

interface BlurUpImageProps {
  listing: BlurUpListing;
  img: string; // w320 thumb (or full-photo fallback) — today's card image
  alt: string;
  eager?: boolean; // above-the-fold: loading="eager" (default lazy, today's behavior)
  priority?: boolean; // first card: fetchpriority="high" on the upgrade preload
  className?: string;
}

// Round 14 T6: the 📷 placeholder tile (same glyph/styling as the gallery
// SafeImg fallback and the SimilarCard no-image tile).
function PlaceholderTile({ className, alt }: { className?: string; alt: string }) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={
        (className || '') +
        ' bg-zinc-200 flex items-center justify-center text-zinc-400 text-4xl select-none'
      }
    >
      📷
    </div>
  );
}

// Round 14 T6 (Bug #2): pre-hydration image errors are LOST — an <img> that
// 404s before React attaches onError never fires it again, so the
// broken-image icon stays forever. A ref callback runs at mount (after
// hydration); complete && naturalWidth === 0 is the deterministic "it
// already failed" signal — apply the fallback immediately, exactly as the
// onError path does.
function mountBroke(el: HTMLImageElement | null): boolean {
  try {
    return !!el && el.complete && el.naturalWidth === 0;
  } catch {
    return false;
  }
}

export default function BlurUpImage({ listing, img, alt, eager, priority, className }: BlurUpImageProps) {
  useEffect(() => {
    installBlurUpHandler();
  }, []);
  const isDesktop = useSyncExternalStore(subscribeDesktopWidth, getDesktopWidth, () => false);
  // Rules of Hooks (12 Oct 2026): this must be unconditional — inside the
  // !lqip branch the hook order shifted when lqip changed between renders.
  const [broken, setBroken] = useState(false);
  // Round 14 T6: LQIP branch — true when BOTH the LQIP and the hi fallback
  // failed (each stage is attempted exactly once, so a dead URL can't loop).
  const [dead, setDead] = useState(false);

  const lqip = lqipUrlFor(listing);
  // 11 Oct 2026: rewrite dzdlala.com default ad images to local paths
  const rewriteDefaultImg = (u: string) =>
    u.replace('https://dzdlala.com/img/default_ads/', '/img/default_ads/');
  if (!lqip) {
    // No derivable LQIP (old listings, non-variant URLs): today's behavior.
    // Round 14 T6: the 📷 tile (was a blank div) + the mount check catches
    // pre-hydration 404s that never fired onError.
    if (broken) {
      return <PlaceholderTile className={className} alt={alt} />;
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={(el) => {
          if (mountBroke(el)) setBroken(true);
        }}
        src={rewriteDefaultImg(img || '')}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className={className}
        onError={() => setBroken(true)}
      />
    );
  }

  // (dzdlala.com blocks hotlinking on the preview domain) — defined above.
  const full = rewriteDefaultImg((listing.photoUrls && listing.photoUrls[0]) || '');
  const w640 = listing.photoVariants && full ? variantUrlFor(full, 640) : '';
  const imgRewritten = rewriteDefaultImg(img || '');
  const hi = isDesktop && w640 ? w640 : imgRewritten;

  // Round 14 T6: shared error logic for the LQIP branch, used both by
  // onError (post-hydration failures) and by the mount check (pre-hydration
  // 404s whose error event was lost). Stage 1: LQIP died (404 — publish
  // writes variants best-effort) → fall back to the card image. Stage 2:
  // the card image also died → the 📷 tile. The src===hi guard means each
  // stage is attempted exactly once, so a dead URL can never loop.
  const handleLqipError = (el: HTMLImageElement) => {
    try {
      if (el.src !== hi) {
        el.src = hi;
        el.classList.add('hi'); // no blur on the fallback
      } else {
        setDead(true);
      }
    } catch {
      setDead(true);
    }
  };
  const onLqipError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    handleLqipError(e.currentTarget);
  };

  if (dead) {
    return (
      <PlaceholderTile className={className ? `img-blurup ${className}` : 'img-blurup'} alt={alt} />
    );
  }

  const tag = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={(el) => {
        if (el && mountBroke(el)) handleLqipError(el);
      }}
      src={lqip}
      alt={alt}
      onError={onLqipError}
      className={className ? `img-blurup ${className}` : 'img-blurup'}
      data-hi={hi}
      data-noretry="1"
      {...(priority ? { 'data-prio': 'high', fetchpriority: 'high' } : {})}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
  // R11-speed-12: responsive card image — the <picture> media gate (not
  // srcset+sizes) guarantees mobile NEVER downloads W640. display:contents
  // keeps the img positioned exactly as before (absolute inset-0).
  return w640 ? (
    <picture className="contents">
      <source media="(min-width: 861px)" srcSet={w640} />
      {tag}
    </picture>
  ) : (
    tag
  );
}
