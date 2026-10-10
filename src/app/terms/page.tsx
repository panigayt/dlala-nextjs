// Terms of Use — server shell (metadata) + TermsClient (app-wide language store).
//
// Content is VERBATIM from ~/workspace/dlala-040/js/terms.js (the TERMS map).
// Legacy parity: js/terms.js renderTerms() injects only TERMS[LANG] and
// onLangChange() re-renders on the header language switch — the client
// component below does the same via useLang(). No app-only features.

import type { Metadata } from 'next';

import { t } from '@/lib/i18n-strings';
import { getServerLang } from '@/lib/server-lang';
import TermsClient from './TermsClient';

// Round 133: <title> follows the reader's language (dlala_lang cookie;
// localStorage is client-only). Description stays Arabic (title-only scope).
export async function generateMetadata(): Promise<Metadata> {
  const title = t('title_terms', await getServerLang());
  return {
    title,
    description: 'شروط استخدام موقع وتطبيق دلالة',
    openGraph: {
      type: 'website',
      siteName: 'DLALA',
      locale: 'ar_DZ',
      title,
      description: 'شروط استخدام موقع وتطبيق دلالة',
      url: 'https://dzdlala.com/terms',
      images: ['https://dzdlala.com/icon-512.png'],
    },
    twitter: {
      card: 'summary',
      title,
      description: 'شروط استخدام موقع وتطبيق دلالة',
      images: ['https://dzdlala.com/icon-512.png'],
    },
  };
}

export default function TermsPage() {
  return <TermsClient />;
}
