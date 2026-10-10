'use client';

// Scroll-restore armer (QA 16 Sep 2026 #4, js/app.js parity).
//
// Legacy armed restoreFeedScroll() on every page's DOMContentLoaded (1200ms
// deferred, one-shot). In the SPA there is no full page load on the return
// trip through /auth — the return target arrives via client-side navigation,
// so this arms on every pathname change instead. Mounted once in the root
// layout, next to PendingActionApplier.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { armScrollRestore } from '@/lib/scroll-restore';

export default function ScrollRestoreArmer() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      armScrollRestore();
    } catch {
      /* best-effort */
    }
  }, [pathname]);
  return null;
}
