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
// Note: LBZ-1 double-tap/dblclick 2.5x zoom + pan is NOT ported here
// (follow-up block).

import { useCallback, useEffect, useRef, useState } from 'react';

const AR_CLOSE = 'إغلاق';
const AR_PREV = 'الصورة السابقة';
const AR_NEXT = 'الصورة التالية';
const AR_OPEN_VIEWER = 'فتح عارض الصور';

export default function Gallery({
  photos,
  fallback,
  title,
}: {
  photos: string[];
  fallback: string;
  title: string;
}) {
  const all = photos.length ? photos : fallback ? [fallback] : [];
  const [sel, setSel] = useState(0);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbIdx, setLbIdx] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

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
      setLbIdx((i) => {
        const n = (i + d + all.length) % all.length;
        setSel(n); // keep the gallery selection in sync behind the lightbox
        return n;
      });
    },
    [all.length]
  );

  // Focus return + scroll lock + keyboard nav while open.
  useEffect(() => {
    if (!lbOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
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
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      try {
        if (openerRef.current && document.contains(openerRef.current)) openerRef.current.focus();
      } catch {
        /* focus return is best-effort */
      }
    };
  }, [lbOpen, all.length, lbShow, closeLightbox]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchRef.current;
    touchRef.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && all.length > 1) {
      lbShow(dx > 0 ? -1 : 1);
    }
  };

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
        aria-label={AR_OPEN_VIEWER}
        className="block w-full cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={all[sel]}
          alt={`${title} — صورة ${sel + 1}/${all.length}`}
          className="w-full aspect-[4/3] object-cover"
        />
      </button>
      {all.length > 1 && (
        <div className="flex gap-2 p-3 overflow-x-auto">
          {all.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSel(i)}
              aria-label={`${title} — صورة ${i + 1}/${all.length}`}
              aria-pressed={i === sel}
              className={
                'shrink-0 rounded-lg overflow-hidden transition ' +
                (i === sel ? 'ring-2 ring-emerald-700' : 'opacity-70 hover:opacity-100')
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p}
                alt=""
                loading="lazy"
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
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <button
            type="button"
            className="lb-close absolute top-4 right-4 text-white text-2xl px-3 py-1 rounded hover:bg-white/20"
            aria-label={AR_CLOSE}
            onClick={closeLightbox}
          >
            ✕
          </button>
          {all.length > 1 && (
            <>
              <button
                type="button"
                className="absolute left-2 sm:left-4 text-white text-3xl px-3 py-6 rounded hover:bg-white/20"
                aria-label={AR_PREV}
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
                aria-label={AR_NEXT}
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
            src={all[lbIdx]}
            alt={`${title} — صورة ${lbIdx + 1}/${all.length}`}
            className="max-w-full max-h-full object-contain"
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
