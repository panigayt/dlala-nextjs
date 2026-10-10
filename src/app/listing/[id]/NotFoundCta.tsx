'use client';

// Dead-listing 404 CTA (Round 131).
//
// The server-rendered NotFoundView in src/app/listing/[id]/page.tsx shows
// its heading/description in all three languages statically (404.html
// pattern), but its "browse ads" link was hardcoded Arabic. This client
// island renders the label in the active UI language via the shared store
// (js/i18n.js browseAds parity).

import Link from 'next/link';
import { useLang } from '@/lib/i18n';

export default function NotFoundCta() {
  const { t } = useLang();
  return (
    <Link
      href="/"
      className="inline-block rounded-lg bg-emerald-700 text-white px-6 py-3 font-medium"
    >
      {t('browseAds')}
    </Link>
  );
}
