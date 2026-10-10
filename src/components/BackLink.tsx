'use client';

// Back link for the listing page (LIS-7, 16 Sep 2026, js/listing.js parity).
//
// Legacy renders:
//   <p class="backrow"><a href="index.html" id="backLink"
//     style="color:var(--emerald)"><span class="flip-rtl"
//     aria-hidden="true"></span> <span data-i18n="back">رجوع</span></a></p>
//
// and on click:
//   if (window.history.length > 1) { e.preventDefault(); window.history.back(); }
//
// The back link returns to the previous page (feed with its filters/scroll
// intact) instead of dumping to home; the › chevron reads correctly in RTL
// (legacy .flip-rtl::before content '›' in RTL, '‹' in LTR). The href="/"
// is the no-history fallback (legacy: index.html).

import { useCallback } from 'react';
import Link from 'next/link';

export default function BackLink() {
  const onClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    try {
      if (window.history && window.history.length > 1) {
        e.preventDefault();
        window.history.back();
      }
      // No history (deep link / new tab): let href="/" navigate home.
    } catch {
      /* best-effort — fall through to href */
    }
  }, []);

  return (
    <p className="mb-[10px]">
      <Link
        href="/"
        id="backLink"
        onClick={onClick}
        className="text-emerald-700 hover:underline"
      >
        <span aria-hidden="true" className="inline-block min-w-[0.6em] text-center">
          ›
        </span>{' '}
        <span>رجوع</span>
      </Link>
    </p>
  );
}
