// Privacy Policy (English) — /en/privacy.
//
// Same privacy policy as the unprefixed /privacy (src/app/privacy/page.tsx),
// with the UI locale forced to English for the whole page subtree
// (ForcedLang + UrlLangSync, the /en/publish pattern) and English metadata
// + the hreflang cluster. R28-2 (24 Oct 2026): this pinned route did not
// exist — /en/privacy 404'd while sibling footer content (guides) had
// pinned /en routes.
import type { Metadata } from 'next';
import { ForcedLang } from '@/lib/i18n';
import { t } from '@/lib/i18n-strings';
import PrivacyPage from '@/app/privacy/page';
import UrlLangSync from '@/components/UrlLangSync';

export function generateMetadata(): Metadata {
  const title = t('title_privacy', 'en');
  const description = 'Privacy policy for the DLALA app and website';
  return {
    title,
    description,
    alternates: {
      canonical: 'https://www.dzdlala.com/en/privacy',
      languages: {
        ar: 'https://www.dzdlala.com/privacy',
        fr: 'https://www.dzdlala.com/fr/privacy',
        en: 'https://www.dzdlala.com/en/privacy',
        'x-default': 'https://www.dzdlala.com/privacy',
      },
    },
    openGraph: {
      type: 'website',
      siteName: 'DLALA',
      locale: 'en_DZ',
      title,
      description,
      url: 'https://www.dzdlala.com/en/privacy',
      images: ['https://www.dzdlala.com/icon-512.png'],
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: ['https://www.dzdlala.com/icon-512.png'],
    },
  };
}

export default function PrivacyEnPage() {
  return (
    <ForcedLang value="en">
      <UrlLangSync lang="en" />
      <PrivacyPage />
    </ForcedLang>
  );
}
