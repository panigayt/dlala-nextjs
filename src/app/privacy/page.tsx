// Privacy policy — server shell (metadata) + PrivacyClient (app-wide language store).
//
// Content is VERBATIM from ~/workspace/dlala-040/js/privacy.js (the PRIVACY map).
// Legacy parity: js/privacy.js renderPrivacy() injects only PRIVACY[LANG] and
// onLangChange() re-renders on the header language switch — the client
// component below does the same via useLang(). No app-only features.

import type { Metadata } from 'next';

import PrivacyClient from './PrivacyClient';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية — دلالة DLALA',
  description: 'سياسة الخصوصية لتطبيق وموقع دلالة',
  openGraph: {
    type: 'website',
    siteName: 'DLALA',
    locale: 'ar_DZ',
    title: 'سياسة الخصوصية — دلالة DLALA',
    description: 'سياسة الخصوصية لتطبيق وموقع دلالة',
    url: 'https://dzdlala.com/privacy',
    images: ['https://dzdlala.com/icon-512.png'],
  },
  twitter: {
    card: 'summary',
    title: 'سياسة الخصوصية — دلالة DLALA',
    description: 'سياسة الخصوصية لتطبيق وموقع دلالة',
    images: ['https://dzdlala.com/icon-512.png'],
  },
};

export default function PrivacyPage() {
  return <PrivacyClient />;
}
