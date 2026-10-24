'use client';

// Service-worker registration — image cache only (Zak ordered 14 Oct 2026).
// Registers /sw.js (public/sw.js): listing-photo cache-first
// (dlala-next-img-v1) + R24-3 offline navigation (previously visited
// pages served from cache when offline; /_next/static chunks
// cache-first). API/Firestore/gstatic still pass through untouched.
// - No firebase import here: the lazy gstatic boundary stays intact
//   (0 bundle bytes for Firebase; the SW itself imports nothing).
// - Registration waits for window load so it never contends with first paint.

import { useEffect } from 'react';

export default function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Non-fatal: the site works fully without the image cache.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
