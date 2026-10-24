'use client';

// GA4 loader — deferred (Fix Round 3, 22 Oct 2026; R32-3 GA fuse,
// 24 Oct 2026; Zak's خفف priority: speed on very weak internet is #1).
//
// Before: layout.tsx loaded gtag/js (159.8 KB — the single largest
// payload on every page) via next/script strategy="afterInteractive",
// so it competed with first paint and hydration on every cold load.
// Fix Round 3 moved it to window `load` + idle time, or the first
// user interaction — but the idle fuse cannot hold under throttle:
// the main thread is idle while waiting on network, so the idle
// callback fires immediately after load, inside the first-content
// window (measured 24 Oct 2026, R32 profile: gtag/js 163 KB in
// flight from ~0.7 s while first content lands at ~8.7 s throttled
// locally, ~30 s in production where load itself is pipe-late).
// Now the library loads ONLY on the first user interaction
// (pointer/key/touch/scroll) or 20,000 ms after the window `load`
// event, whichever comes first. A wall-clock fuse puts gtag past
// first content in both cases; an idle-based fuse cannot.
// The measurement ID (G-VTX14GJMFL), the dataLayer stub, and the
// 'js' + 'config' calls are exactly the ones the old inline init ran,
// so GA4 event behavior is unchanged; custom events fired before the
// trigger stay no-ops (src/lib/analytics.ts guards on window.gtag),
// the same as a slow afterInteractive load.
// No imports beyond react: the lazy Firebase boundary is untouched and
// nothing here is on the critical path (the effect runs post-hydration).

import { useEffect } from 'react';

const GA_SRC = 'https://www.googletagmanager.com/gtag/js?id=G-VTX14GJMFL';
// Wall-clock fuse: gtag may only load 20 s after window load (or on
// interaction). 20 s clears local first content (~8.7 s throttled)
// and production first content (~30 s is pipe-late load, so the fuse
// starts late there too) with margin on both sides.
const GA_FUSE_MS = 20000;

type GaWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

export default function GaLoader() {
  useEffect(() => {
    let done = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    let loadHandler: (() => void) | null = null;
    const INTERACTIONS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

    const cleanup = () => {
      for (const e of INTERACTIONS) window.removeEventListener(e, trigger);
      if (loadHandler) window.removeEventListener('load', loadHandler);
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

    // Wall-clock fuse: the 20 s timer starts at window load — or
    // immediately if load already fired before this effect ran. No
    // requestIdleCallback path: under throttle the thread is idle
    // while waiting on network, so an idle fuse fires inside the
    // first-content window instead of past it.
    const startFuse = () => {
      if (timerId === undefined) timerId = setTimeout(load, GA_FUSE_MS);
    };

    for (const e of INTERACTIONS) {
      window.addEventListener(e, trigger, { passive: true });
    }
    if (document.readyState === 'complete') {
      startFuse();
    } else {
      loadHandler = startFuse;
      window.addEventListener('load', loadHandler);
    }
    return () => {
      done = true;
      cleanup();
    };
  }, []);

  return null;
}
