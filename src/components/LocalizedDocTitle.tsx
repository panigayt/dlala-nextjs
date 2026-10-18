// LocalizedDocTitle — 17 Oct 2026 (audit H2 fix), R54 rework.
//
// Pages whose <title> metadata is intentionally STATIC (Arabic) so it
// lands in <head> still owe the READER a localized tab title (Round 133).
// This null-rendering client component sets document.title on hydration.
//
// R54 (18 Oct 2026): the server no longer pre-localizes the title via the
// dlala_lang cookie — cookie-dependent SSR poisons the edge cache (K-M1:
// Vary: Cookie and Cache-Control: private both verified ineffective live).
// The server computes all three SEO titles (Arabic default for crawlers)
// and the client picks the reader's language via useLang().

'use client';

import { useEffect } from 'react';
import { useLang, type Lang } from '@/lib/i18n';

export default function LocalizedDocTitle({
  titles,
}: {
  titles: Record<Lang, string>;
}) {
  const { lang } = useLang();
  useEffect(() => {
    try {
      const title = titles[lang] || titles.ar;
      if (title) document.title = title;
    } catch {
      // a title must never break the page
    }
  }, [titles, lang]);
  return null;
}
