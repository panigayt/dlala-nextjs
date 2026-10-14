'use client';

// Service-worker registration — image cache only (Zak ordered 14 Oct 2026).
// Registers /sw.js (public/sw.js) which cache-firsts listing photos from
// firebasestorage.googleapis.com + img.dzdlala.com (dlala-next-img-v1).
// - No firebase import here: the lazy gstatic boundary stays intact
//   (0 bundle bytes for Firebase; the SW itself imports nothing).
// - Images only: HTML/_next/API/Firestore all pass through untouched.
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
