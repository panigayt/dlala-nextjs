// Terms of Use — server shell (metadata) + TermsClient (app-wide language store).
//
// Content is VERBATIM from ~/workspace/dlala-040/js/terms.js (the TERMS map),
// except the R28-1 factual correction noted in TermsClient.tsx.
// Legacy parity: js/terms.js renderTerms() injects only TERMS[LANG] and
// onLangChange() re-renders on the header language switch — the client
// component below does the same via useLang(). No app-only features.

import type { Metadata } from 'next';

import { t } from '@/lib/i18n-strings';
import TermsClient from './TermsClient';

// 17 Oct 2026 (audit H2 — root-cause fix): generateMetadata is STATIC — no
// dlala_lang cookie read (awaiting cookies() streamed the tags into <body>).
// Crawlers get the Arabic fallback; the tab re-localizes on hydration via
// lib/i18n updateDocTitle (titleKeyForPath '/terms' → 'title_terms').
export function generateMetadata(): Metadata {
  const title = t('title_terms', 'ar');
  return {
    title,
    description: 'شروط استخدام موقع وتطبيق دلالة',
    alternates: { canonical: 'https://www.dzdlala.com/terms' },
    openGraph: {
      type: 'website',
      siteName: 'DLALA',
      locale: 'ar_DZ',
      title,
      description: 'شروط استخدام موقع وتطبيق دلالة',
      url: 'https://www.dzdlala.com/terms',
      images: ['https://www.dzdlala.com/icon-512.png'],
    },
    twitter: {
      card: 'summary',
      title,
      description: 'شروط استخدام موقع وتطبيق دلالة',
      images: ['https://www.dzdlala.com/icon-512.png'],
    },
  };
}

export default function TermsPage() {
  return <TermsClient />;
}
