'use client';

// GA4 loader — deferred (Fix Round 3, 22 Oct 2026; Zak's خفف priority:
// speed on very weak internet is #1).
//
// Before: layout.tsx loaded gtag/js (159.8 KB — the single largest
// payload on every page) via next/script strategy="afterInteractive",
// so it competed with first paint and hydration on every cold load.
// Now the library loads ONLY after the window `load` event + idle time,
// or on the first user interaction (pointer/key/touch/scroll) —
// whichever comes first. The measurement ID (G-VTX14GJMFL), the
// dataLayer stub, and the 'js' + 'config' calls are exactly the ones
// the old inline init ran, so GA4 event behavior is unchanged; custom
// events fired before the trigger stay no-ops (src/lib/analytics.ts
// guards on window.gtag), the same as a slow afterInteractive load.
// No imports beyond react: the lazy Firebase boundary is untouched and
// nothing here is on the critical path (the effect runs post-hydration).

import { useEffect } from 'react';

const GA_SRC = 'https://www.googletagmanager.com/gtag/js?id=G-VTX14GJMFL';

type GaWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

export default function GaLoader() {
  useEffect(() => {
    let done = false;
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    let loadHandler: (() => void) | null = null;
    const INTERACTIONS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

    const cleanup = () => {
      for (const e of INTERACTIONS) window.removeEventListener(e, trigger);
      if (loadHandler) window.removeEventListener('load', loadHandler);
      if (idleId !== undefined && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== undefined) clearTimeout(timerId);
    };

    const load = () => {
      if (done) return;
      done = true;
      cleanup();
      const w = window as GaWindow;
      // The official gtag stub + init, verbatim semantics.
      w.dataLayer = w.dataLayer || [];
      const dataLayer = w.dataLayer;
      w.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        dataLayer.push(arguments);
      };
      w.gtag('js', new Date());
      w.gtag('config', 'G-VTX14GJMFL');
      const s = document.createElement('script');
      s.async = true;
      s.src = GA_SRC;
      document.head.appendChild(s);
    };

    function trigger() {
      load();
    }

    const scheduleIdle = () => {
      if ('requestIdleCallback' in window) {
        idleId = window.requestIdleCallback(() => load(), { timeout: 3000 });
      } else {
        timerId = setTimeout(load, 1200);
      }
    };

    for (const e of INTERACTIONS) {
      window.addEventListener(e, trigger, { passive: true });
    }
    if (document.readyState === 'complete') {
      scheduleIdle();
    } else {
      loadHandler = scheduleIdle;
      window.addEventListener('load', loadHandler);
    }
    return () => {
      done = true;
      cleanup();
    };
  }, []);

  return null;
}
