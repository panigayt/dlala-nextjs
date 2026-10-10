// Listing gallery photo prewarm — js/listing.js LIS-9 + LIS-10 parity.
//
// LIS-9 (16 Sep 2026): progressive main photo. The hero paints instantly
// from the (likely cached) thumbnail — the w32 LQIP for photo 0 — then
// upgrades to the display URL on arrival. Probe chain: variant → full
// photo → keep the instant paint.
//
// LIS-10 (24 Sep 2026, Zak: «باقي الصور تاخذ وقت كبير لكي تحمل»):
// preload every other photo's display URL on idle, right after the first
// paint. Measured 24 Sep 2026: the generated "thumbnails" are ~24KB vs
// ~29KB for the full photos, so the thumb step saves nothing, and tapping
// a photo used to chain two sequential fetches — seconds per photo on
// mobile. Warming the cache makes every tap instant.
//
// 0.0.0.21 Step 3: preload only the NEXT 1–2 gallery images (was: every
// remaining photo), and skip preloading entirely on metered/2G.
//
// LIS-10b (24 Sep 2026, Zak: «المصغرة الثانية تأخذ وقت كبير لكي تظهر»):
// the strip <img> src is dlalaThumb(listing, i) — a DIFFERENT URL from the
// display URL — so it is warmed too, otherwise thumbs 2..n still fetch
// cold.
//
// Pure + DOM-free (erasable TS only, injectable image factory) so node can
// import it directly for differential tests vs the legacy functions.

import { variantUrlFor } from '@/lib/image-variants';

// js/listing.js displayUrlFor (verbatim semantics): single source of truth
// for "the URL the main photo should display" — the W1024 hero variant
// when the publish pipeline wrote one (0.0.0.1w+), else the full photo.
// R11: W640 on mobile (faster), W1024 on desktop. Skip if no variants
// (old listing: no probe, no 404). Used by the LIS-9 upgrade and by the
// LIS-10 prewarm so both warm/swap exactly the same bytes.
export function displayUrlFor(
  full: string,
  hasVariants: boolean,
  isMobile: boolean
): string {
  try {
    if (!hasVariants) return full; // old listing, no probe, no 404
    const w = isMobile ? 640 : 1024;
    const v = variantUrlFor(full, w);
    if (v) return v;
  } catch {
    /* fall through to the full photo */
  }
  return full;
}

// js/listing.js displayUrlFor mobile gate (verbatim): matchMedia
// '(max-width: 860px)'. Client-only; SSR callers must pass the value in.
export function isMobileWidth(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 860px)').matches
    );
  } catch {
    return false;
  }
}

// js/app.js prewarmOnIdle (verbatim): requestIdleCallback with a 3000ms
// timeout, else setTimeout(800). Never throws; a returned promise's
// rejection is swallowed.
export function prewarmOnIdle(fn: () => unknown, timeoutMs = 3000): void {
  const kick = () => {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).catch === 'function') {
        (r as Promise<unknown>).catch(() => {});
      }
    } catch {
      /* prewarm must never break the page */
    }
  };
  try {
    const w = window as unknown as {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number }
      ) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(kick, { timeout: timeoutMs });
      return;
    }
  } catch {
    /* fall through to setTimeout */
  }
  setTimeout(kick, 800);
}

export interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

// js/listing.js preloadRemainingPhotos connection guard (0.0.0.21 Step 3):
// skip preloading entirely on metered/2G connections — the old loop fired
// up to 16 full-res downloads on idle, a hidden multi-MB cost the audit
// measured on listing pages.
export function isMeteredOrSlow(
  conn: ConnectionLike | null | undefined
): boolean {
  try {
    if (!conn) return false;
    if (conn.saveData) return true;
    const et = String(conn.effectiveType || '');
    return et === '2g' || et === 'slow-2g';
  } catch {
    return false;
  }
}

// Minimal image surface the warm/probe helpers need — injectable so unit
// tests can pass a fake instead of the DOM Image.
export interface WarmableImage {
  src: string;
  decoding?: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

export type ImageFactory = () => WarmableImage;

function domImageFactory(): WarmableImage {
  const im = new Image();
  try {
    im.decoding = 'async';
  } catch {
    /* older browsers ignore it */
  }
  return im as unknown as WarmableImage;
}

// Fire-and-forget single-image warm — legacy `warm()` inside
// preloadRemainingPhotos: `const im = new Image(); im.decoding = 'async';
// im.src = u;`
export function warmImage(
  url: string,
  make: ImageFactory = domImageFactory
): void {
  try {
    if (!url) return;
    const im = make();
    im.src = url;
  } catch {
    /* warming must never throw */
  }
}

// Promise probe for the LIS-9 upgrade chain: resolves when the URL loads,
// rejects on error so the caller can fall back to the next candidate.
export function probeImage(
  url: string,
  make: ImageFactory = domImageFactory
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const im = make();
      im.onload = () => resolve();
      im.onerror = () => reject(new Error('img-probe-failed'));
      im.src = url;
    } catch (e) {
      reject(e);
    }
  });
}

// js/listing.js preloadRemainingPhotos target computation (LIS-10 +
// LIS-10b): the display URLs of the NEXT 1–2 photos after `cur` (no wrap —
// photo 0 is already displayed), each followed by its strip thumbnail URL
// when one exists. Order-preserved, deduped.
export function prewarmTargets(
  photos: string[],
  thumbs: string[],
  cur: number,
  hasVariants: boolean,
  isMobile: boolean
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };
  if (!photos || photos.length < 2) return out;
  for (let k = 1; k <= 2; k++) {
    const i = cur + k;
    if (i >= photos.length) break; // no wrap — photo 0 is already displayed
    push(displayUrlFor(photos[i], hasVariants, isMobile));
    const t = thumbs[i] || '';
    if (t) push(t);
  }
  return out;
}
