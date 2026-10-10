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

import { useEffect, useSyncExternalStore } from 'react';
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

export default function BlurUpImage({ listing, img, alt, eager, priority, className }: BlurUpImageProps) {
  useEffect(() => {
    installBlurUpHandler();
  }, []);
  const isDesktop = useSyncExternalStore(subscribeDesktopWidth, getDesktopWidth, () => false);

  const lqip = lqipUrlFor(listing);
  if (!lqip) {
    // No derivable LQIP (old listings, non-variant URLs): today's behavior.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={img} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" className={className} />
    );
  }

  const full = (listing.photoUrls && listing.photoUrls[0]) || '';
  const w640 = listing.photoVariants && full ? variantUrlFor(full, 640) : '';
  const hi = isDesktop && w640 ? w640 : img;

  // LQIP died (404 — publish writes variants best-effort): fall back to the
  // card image instead of a broken icon. The src===hi guard prevents loops.
  const onLqipError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    try {
      if (el.src !== hi) el.src = hi;
      el.classList.add('hi'); // no blur on the fallback
    } catch {
      /* noop */
    }
  };

  const tag = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={lqip}
      alt={alt}
      onError={onLqipError}
      className={className ? `img-blurup ${className}` : 'img-blurup'}
      data-hi={hi}
      data-noretry="1"
      {...(priority ? { 'data-prio': 'high' } : {})}
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
