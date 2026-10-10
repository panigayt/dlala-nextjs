'use client';

// Tips ticker — auto-rotating safety tips at the top of home.
// Ported verbatim from js/home.js initTipsTicker() in ~/workspace/dlala-040
// (15 Sep 2026 — itself ported from the Android app's _TipsTicker).
//
// Legacy behavior, mirrored exactly:
// - Cycles tip1..tip6 every 4s with a 350ms fade-out/fade-in swap.
// - Tap/click on the ticker advances to the next tip.
// - Auto-rotation pauses on hover/focus, resumes on leave/blur.
// - A keyboard-accessible pause/play toggle (WCAG 2.2.2, A-09 0.0.0.21):
//   ⏸/▶ glyphs visible, localized words as the accessible name, and a
//   pause tap never advances the tip (stopPropagation).
// - Never auto-rotates under prefers-reduced-motion.
// - The visible strings follow the UI language via useLang()
//   (js/i18n.js onLangChange parity); the current tip index is kept
//   across language switches.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLang } from '@/lib/i18n';

const TIP_COUNT = 6;
const ROTATE_MS = 4000;
const SWAP_MS = 350;

export default function TipsTicker() {
  const { t, lang } = useLang();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const timer = useRef<number | null>(null);
  const swapTimer = useRef<number | null>(null);
  const idxRef = useRef(0);
  const pausedRef = useRef(false);

  const stopAuto = useCallback(() => {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  // show(i): fade out, swap the text after 350ms, fade in — verbatim
  // the legacy show() closure.
  const show = useCallback((i: number) => {
    const next = ((i % TIP_COUNT) + TIP_COUNT) % TIP_COUNT;
    if (swapTimer.current) window.clearTimeout(swapTimer.current);
    setPhase('out');
    swapTimer.current = window.setTimeout(() => {
      idxRef.current = next;
      setIdx(next);
      setPhase('in');
    }, SWAP_MS);
  }, []);

  const startAuto = useCallback(() => {
    if (timer.current || pausedRef.current) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    timer.current = window.setInterval(() => show(idxRef.current + 1), ROTATE_MS);
  }, [show]);

  // Mount: paint tip1 and start auto-rotation; unmount: clear everything.
  useEffect(() => {
    startAuto();
    return () => {
      stopAuto();
      if (swapTimer.current) window.clearTimeout(swapTimer.current);
    };
  }, [startAuto, stopAuto]);

  // box.onclick parity: a tap advances one tip.
  const advance = useCallback(() => show(idxRef.current + 1), [show]);

  // Pause toggle parity: pause → stop; resume → advance one tip + restart.
  const togglePause = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // a pause tap must not also advance the tip
      setPaused((p) => {
        const next = !p;
        pausedRef.current = next;
        if (next) stopAuto();
        else {
          show(idxRef.current + 1);
          startAuto();
        }
        return next;
      });
    },
    [show, startAuto, stopAuto]
  );

  // Legacy: rotation pauses while hovered/focused, resumes on leave/blur.
  return (
    <div
      className="tips-ticker"
      tabIndex={0}
      role="region"
      aria-label={t('safetyTips')}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      onClick={advance}
      onMouseEnter={stopAuto}
      onMouseLeave={startAuto}
      onFocus={stopAuto}
      onBlur={startAuto}
    >
      <span className="tips-icon" aria-hidden="true">
        💡
      </span>
      <span className={`tips-text tips-${phase}`}>{t(`tip${idx + 1}`)}</span>
      <button
        type="button"
        className="tips-pause-btn"
        onClick={togglePause}
        aria-pressed={paused}
        aria-label={t(paused ? 'tipsPlay' : 'tipsPause')}
      >
        {paused ? '▶' : '⏸'}
      </button>
    </div>
  );
}
