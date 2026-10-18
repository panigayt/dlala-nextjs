// Minimal GA4 event helper (Round 19 BO-D2, 18 Oct 2026).
//
// Fires only when window.gtag exists (GA4 loaded via layout.tsx);
// never throws — analytics must never break the page.

/** Fire a GA4 custom event. No-op when gtag isn't loaded. */
export function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean>
): void {
  try {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void })
      .gtag;
    if (typeof gtag === 'function') gtag('event', name, params || {});
  } catch {
    /* analytics must never break the page */
  }
}
