'use client';

// Listing gallery — mirrors js/listing.js:
// - LIS-8 (16 Sep 2026): tap the main photo for a fullscreen viewer.
// - Clickable thumbnails switch the main photo (active state on current).
// - Lightbox: prev/next buttons, photo counter N/M, keyboard nav
//   (Escape closes, ArrowLeft/ArrowRight switch, Tab focus trap), touch
//   swipe, backdrop click closes.
// - A-06 (0.0.0.21): dialog role/aria-modal, accessible names for every
//   control, focus enters on open and returns to the opener on close.
// - Navigating inside the lightbox keeps the gallery selection in sync
//   behind it (legacy show() -> setPhoto).
// - LBZ-1 (16 Sep 2026): double-tap / double-click enlarges the photo
//   (2.5x, centered on the tap point); dragging pans while zoomed;
//   switching photos ALWAYS resets to the normal size. Zoom math lives
//   in ./zoom.ts (verbatim port of the lbView helpers in js/listing.js).
// - LIS-9 (16 Sep 2026): progressive hero — instant paint from the w32
//   LQIP (photo 0) or the strip thumb, then upgrade to the W640/W1024
//   hero variant on arrival (probe chain: variant → full → keep paint).
//   Prewarm math lives in ./gallery-prewarm.ts.
// - LIS-10 (24 Sep 2026, Zak): on idle, warm the next 1–2 photos'
//   display URLs + their strip thumbs so tapping through is instant;
//   skipped on metered/2G.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LB_SWIPE_MIN,
  LB_TAP_MAX_DELAY,
  LB_TAP_MAX_DIST,
  LB_TAP_MAX_MOVE,
  lbPanBy,
  lbResetZoom,
  lbZoomToggle,
  type ZoomState,
} from './zoom';
import {
  displayUrlFor,
  isMeteredOrSlow,
  isMobileWidth,
  prewarmOnIdle,
  prewarmTargets,
  probeImage,
  warmImage,
  type ConnectionLike,
} from './gallery-prewarm';
import { useLang } from '@/lib/i18n';

export default function Gallery({
  photos,
  fallback,
  title,
  hasVariants = false,
  heroLqip = '',
  thumbs = [],
}: {
  photos: string[];
  fallback: string;
  title: string;
  // LIS-9/LIS-10: the publish pipeline wrote W-series variants (R11+).
  hasVariants?: boolean;
  // Speed 29: w32 LQIP for photo 0 ('' = none — old listing).
  heroLqip?: string;
  // 0.0.0.1s per-index strip thumbs (photo_thumbs → thumbUrls → full).
  thumbs?: string[];
}) {
  // Round 108: trilingual AR/FR/EN (js/i18n.js parity) — lightbox
  // aria-labels follow the app language.
  const { t } = useLang();
  const all = useMemo(
    () => (photos.length ? photos : fallback ? [fallback] : []),
    [photos, fallback]
  );
  const [sel, setSel] = useState(0);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbIdx, setLbIdx] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // LBZ-1 zoom view state — mutable ref (no re-render needed; the style
  // is applied straight to the <img>, like legacy's module-level lbView).
  const zoomRef = useRef<ZoomState>({ z: 1, x: 0, y: 0 });

  const zoomReset = useCallback(() => lbResetZoom(imgRef.current, zoomRef.current), []);

  // LIS-9 (16 Sep 2026): progressive main photo. The hero paints instantly
  // from the (likely cached) thumbnail — the w32 LQIP for photo 0 — then
  // upgrades to the display URL (W640/W1024 hero when the publish pipeline
  // wrote variants, else the full photo) on arrival.
  // Probe chain: variant → full photo → keep the instant paint.
  // The instant src is derived at render (no effect needed); the effect
  // below only applies the async upgrade. The blur is managed by this
  // component's own probe chain (the Speed-29 delegated handler only
  // claims .img-blurup, which the hero never gets).
  const selClamped = all.length ? Math.max(0, Math.min(sel, all.length - 1)) : 0;
  const instantSrc =
    selClamped === 0 && heroLqip
      ? heroLqip
      : thumbs[selClamped] || all[selClamped] || '';
  // The async upgrade, keyed by photo index (a stale upgrade for the same
  // photo is still the right bytes, so it is reused, not discarded).
  const [upgrade, setUpgrade] = useState<{ sel: number; src: string } | null>(
    null
  );
  const shownSrc =
    upgrade && upgrade.sel === selClamped ? upgrade.src : instantSrc;
  const shownSharp =
    upgrade && upgrade.sel === selClamped ? true : instantSrc !== heroLqip;
  // Token guards the async probe chain against rapid photo switching.
  const probeToken = useRef(0);

  useEffect(() => {
    if (!all.length) return;
    const token = ++probeToken.current;
    const i = selClamped;
    const full = all[i];
    const instant = instantSrc;
    let cancelled = false;
    const alive = () => !cancelled && probeToken.current === token;
    void (async () => {
      const target = displayUrlFor(full, hasVariants, isMobileWidth());
      if (target === instant) return; // already at the best version
      try {
        await probeImage(target);
        if (alive()) setUpgrade({ sel: i, src: target });
        return;
      } catch {
        // Variant missing (pre-0.0.0.1w listing): fall back to the full photo.
      }
      if (target !== full) {
        try {
          await probeImage(full);
          if (alive()) setUpgrade({ sel: i, src: full });
        } catch {
          // Keep the instant paint — better than a broken image.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // instantSrc is derived from selClamped/thumbs/heroLqip/all above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selClamped, all, thumbs, heroLqip, hasVariants]);

  // LIS-10 (24 Sep 2026, Zak: «باقي الصور تاخذ وقت كبير لكي تحمل»): warm
  // the next 1–2 photos' display URLs (+ their strip thumbs, LIS-10b) on
  // idle, right after the first paint — tapping through the gallery is
  // then instant instead of seconds. Skipped on metered/2G (0.0.0.21
  // Step 3). Re-armed when the selection moves so the 1–2-ahead window
  // stays correct as the user taps through (legacy ran once at hydration).
  useEffect(() => {
    if (all.length < 2) return;
    prewarmOnIdle(() => {
      try {
        const nav = typeof navigator !== 'undefined' ? navigator : undefined;
        const conn = (nav as unknown as { connection?: ConnectionLike } | undefined)
          ?.connection;
        if (isMeteredOrSlow(conn)) return;
        const targets = prewarmTargets(
          all,
          thumbs,
          selClamped,
          hasVariants,
          isMobileWidth()
        );
        targets.forEach((u) => warmImage(u));
      } catch {
        /* prewarm must never break the page */
      }
    });
  }, [selClamped, all, thumbs, hasVariants]);

  const openLightbox = useCallback((idx: number) => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLbIdx(Math.max(0, Math.min(idx, all.length - 1)));
    setLbOpen(true);
  }, [all.length]);

  const closeLightbox = useCallback(() => {
    setLbOpen(false);
  }, []);

  const lbShow = useCallback(
    (d: number) => {
      zoomReset(); // LBZ-1: a new photo always starts at normal size
      setLbIdx((i) => {
        const n = (i + d + all.length) % all.length;
        setSel(n); // keep the gallery selection in sync behind the lightbox
        return n;
      });
    },
    [all.length, zoomReset]
  );

  // Focus return + scroll lock + keyboard nav + LBZ-1 touch zoom/pan while open.
  useEffect(() => {
    if (!lbOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    zoomReset(); // LBZ-1: a fresh viewer always starts at normal size
    const closeBtn = dialogRef.current?.querySelector<HTMLButtonElement>('.lb-close');
    closeBtn?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeLightbox();
        return;
      }
      if (all.length > 1 && e.key === 'ArrowLeft') lbShow(-1);
      else if (all.length > 1 && e.key === 'ArrowRight') lbShow(1);
      else if (e.key === 'Tab') {
        // Focus trap: Tab cycles among the dialog's controls.
        const f = Array.from(
          dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') || []
        ).filter((b) => !b.disabled);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // LBZ-1 touch handlers — verbatim legacy semantics from openLightbox:
    // swipe support for touch; double-tap toggles zoom, drag pans when
    // zoomed. Native listeners (not React props) so touchmove can be
    // { passive: false } and preventDefault() during a pan.
    const ov = dialogRef.current;
    let sx: number | null = null,
      sy: number | null = null,
      lastTapT = 0,
      lastTapX = 0,
      lastTapY = 0,
      panning = false,
      px = 0,
      py = 0;
    const onTs = (e: TouchEvent) => {
      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
      panning = zoomRef.current.z > 1 && e.touches.length === 1;
      px = t.clientX;
      py = t.clientY;
    };
    const onTm = (e: TouchEvent) => {
      if (!panning || e.touches.length !== 1) return;
      const t = e.touches[0];
      lbPanBy(imgRef.current, zoomRef.current, t.clientX - px, t.clientY - py);
      px = t.clientX;
      py = t.clientY;
      if (e.cancelable) e.preventDefault();
    };
    const onTe = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      // double-tap: toggle zoom (only when the tap didn't move much)
      const now = Date.now();
      const moved = sx == null || sy == null ? 99 : Math.hypot(t.clientX - sx, t.clientY - sy);
      if (
        moved < LB_TAP_MAX_MOVE &&
        now - lastTapT < LB_TAP_MAX_DELAY &&
        Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < LB_TAP_MAX_DIST
      ) {
        lbZoomToggle(imgRef.current, zoomRef.current, t.clientX, t.clientY);
        lastTapT = 0;
        sx = null;
        return;
      }
      if (moved < LB_TAP_MAX_MOVE) {
        lastTapT = now;
        lastTapX = t.clientX;
        lastTapY = t.clientY;
      }
      // swipe switches photos only at normal size (when zoomed, drag pans)
      if (sx != null && zoomRef.current.z <= 1) {
        const dx = t.clientX - sx;
        if (Math.abs(dx) > LB_SWIPE_MIN) lbShow(dx > 0 ? -1 : 1);
      }
      sx = null;
      panning = false;
    };
    ov?.addEventListener('touchstart', onTs, { passive: true });
    ov?.addEventListener('touchmove', onTm, { passive: false });
    ov?.addEventListener('touchend', onTe, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      ov?.removeEventListener('touchstart', onTs);
      ov?.removeEventListener('touchmove', onTm);
      ov?.removeEventListener('touchend', onTe);
      document.body.style.overflow = prevOverflow;
      try {
        if (openerRef.current && document.contains(openerRef.current)) openerRef.current.focus();
      } catch {
        /* focus return is best-effort */
      }
    };
  }, [lbOpen, all.length, lbShow, closeLightbox, zoomReset]);

  if (!all.length) {
    return (
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="w-full aspect-[4/3] flex items-center justify-center text-zinc-300 text-6xl bg-zinc-100">
          📷
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => openLightbox(sel)}
        aria-label={t('openPhotoViewer')}
        className="block w-full cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shownSrc}
          alt={`${title} — ${t('photo')} ${sel + 1}/${all.length}`}
          className={
            'w-full aspect-[4/3] object-cover g-hero' + (shownSharp ? '' : ' blurred')
          }
          fetchPriority="high"
          decoding="async"
        />
      </button>
      {all.length > 1 && (
        <div className="flex gap-2 p-3 overflow-x-auto">
          {all.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSel(i)}
              aria-label={`${title} — ${t('photo')} ${i + 1}/${all.length}`}
              aria-pressed={i === sel}
              className={
                'shrink-0 rounded-lg overflow-hidden transition ' +
                (i === sel ? 'ring-2 ring-emerald-700' : 'opacity-70 hover:opacity-100')
              }
            >
              {/* 11 Oct 2026: only first thumb eager — 8 high-priority requests
                  competed with hero on weak connections. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbs[i] || p}
                alt=""
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : "low"}
                decoding="async"
                className="w-20 h-20 object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {lbOpen && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLightbox();
          }}
        >
          <button
            type="button"
            className="lb-close absolute top-4 right-4 text-white text-2xl px-3 py-1 rounded hover:bg-white/20"
            aria-label={t('close')}
            onClick={closeLightbox}
          >
            ✕
          </button>
          {all.length > 1 && (
            <>
              <button
                type="button"
                className="absolute left-2 sm:left-4 text-white text-3xl px-3 py-6 rounded hover:bg-white/20"
                aria-label={t('prevPhoto')}
                onClick={(e) => {
                  e.stopPropagation();
                  lbShow(-1);
                }}
              >
                ◀
              </button>
              <button
                type="button"
                className="absolute right-2 sm:right-4 text-white text-3xl px-3 py-6 rounded hover:bg-white/20"
                aria-label={t('nextPhoto')}
                onClick={(e) => {
                  e.stopPropagation();
                  lbShow(1);
                }}
              >
                ▶
              </button>
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={all[lbIdx]}
            alt={`${title} — ${t('photo')} ${lbIdx + 1}/${all.length}`}
            className="max-w-full max-h-full object-contain"
            decoding="async"
            // LBZ-1: double-click (desktop) toggles zoom at the pointer.
            onDoubleClick={(e) => {
              e.stopPropagation();
              lbZoomToggle(imgRef.current, zoomRef.current, e.clientX, e.clientY);
            }}
          />
          {all.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/60 px-3 py-1 rounded-full">
              {lbIdx + 1} / {all.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
