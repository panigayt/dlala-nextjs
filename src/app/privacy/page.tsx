// Privacy policy — server shell (metadata) + PrivacyClient (app-wide language store).
//
// Content is VERBATIM from ~/workspace/dlala-040/js/privacy.js (the PRIVACY map).
// Legacy parity: js/privacy.js renderPrivacy() injects only PRIVACY[LANG] and
// onLangChange() re-renders on the header language switch — the client
// component below does the same via useLang(). No app-only features.

import type { Metadata } from 'next';

import { t } from '@/lib/i18n-strings';
import PrivacyClient from './PrivacyClient';

// 17 Oct 2026 (audit H2 — root-cause fix): generateMetadata is STATIC — no
// dlala_lang cookie read (awaiting cookies() streamed the tags into <body>).
// Crawlers get the Arabic fallback; the tab re-localizes on hydration via
// lib/i18n updateDocTitle (titleKeyForPath '/privacy' → 'title_privacy').
export function generateMetadata(): Metadata {
  const title = t('title_privacy', 'ar');
  return {
    title,
    description: 'سياسة الخصوصية لتطبيق وموقع دلالة',
    alternates: { canonical: 'https://www.dzdlala.com/privacy' },
    openGraph: {
      type: 'website',
      siteName: 'DLALA',
      locale: 'ar_DZ',
      title,
      description: 'سياسة الخصوصية لتطبيق وموقع دلالة',
      url: 'https://www.dzdlala.com/privacy',
      images: ['https://www.dzdlala.com/icon-512.png'],
    },
    twitter: {
      card: 'summary',
      title,
      description: 'سياسة الخصوصية لتطبيق وموقع دلالة',
      images: ['https://www.dzdlala.com/icon-512.png'],
    },
  };
}

export default function PrivacyPage() {
  return <PrivacyClient />;
}
