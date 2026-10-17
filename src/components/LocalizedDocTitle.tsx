// LocalizedDocTitle — 17 Oct 2026 (audit H2 fix).
//
// Pages whose <title> metadata is intentionally STATIC (Arabic) so it
// lands in <head> (see the audit-H2 comments in src/app/page.tsx and
// src/app/listing/[id]/page.tsx) still owe the READER a localized tab
// title (Round 133). This null-rendering client component sets
// document.title from the server-computed, cookie-localized title on
// hydration — the same division the /search route already uses
// (static metadata + lib/i18n updateDocTitle), but for dynamic content
// titles that no static i18n key can express.

'use client';

import { useEffect } from 'react';

export default function LocalizedDocTitle({ title }: { title: string }) {
  useEffect(() => {
    try {
      if (title) document.title = title;
    } catch {
      // a title must never break the page
    }
  }, [title]);
  return null;
}
