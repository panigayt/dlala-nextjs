// Privacy policy — server shell (metadata) + PrivacyClient (app-wide language store).
//
// Content is VERBATIM from ~/workspace/dlala-040/js/privacy.js (the PRIVACY map).
// Legacy parity: js/privacy.js renderPrivacy() injects only PRIVACY[LANG] and
// onLangChange() re-renders on the header language switch — the client
// component below does the same via useLang(). No app-only features.

import type { Metadata } from 'next';

import { t } from '@/lib/i18n-strings';
import { getServerLang } from '@/lib/server-lang';
import PrivacyClient from './PrivacyClient';

// Round 133: <title> follows the reader's language (dlala_lang cookie;
// localStorage is client-only). Description stays Arabic (title-only scope).
export async function generateMetadata(): Promise<Metadata> {
  const title = t('title_privacy', await getServerLang());
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
