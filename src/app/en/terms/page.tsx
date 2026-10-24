// Terms of Use (English) — /en/terms.
//
// Same terms as the unprefixed /terms (src/app/terms/page.tsx), with the
// UI locale forced to English for the whole page subtree (ForcedLang +
// UrlLangSync, the /en/publish pattern) and English metadata + the
// hreflang cluster. R28-2 (24 Oct 2026): this pinned route did not
// exist — /en/terms 404'd while sibling footer content (guides) had
// pinned /en routes.
import type { Metadata } from 'next';
import { ForcedLang } from '@/lib/i18n';
import { t } from '@/lib/i18n-strings';
import TermsPage from '@/app/terms/page';
import UrlLangSync from '@/components/UrlLangSync';

export function generateMetadata(): Metadata {
  const title = t('title_terms', 'en');
  const description = 'Terms of use for the DLALA website and app';
  return {
    title,
    description,
    alternates: {
      canonical: 'https://www.dzdlala.com/en/terms',
      languages: {
        ar: 'https://www.dzdlala.com/terms',
        fr: 'https://www.dzdlala.com/fr/terms',
        en: 'https://www.dzdlala.com/en/terms',
        'x-default': 'https://www.dzdlala.com/terms',
      },
    },
    openGraph: {
      type: 'website',
      siteName: 'DLALA',
      locale: 'en_DZ',
      title,
      description,
      url: 'https://www.dzdlala.com/en/terms',
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

export default function TermsEnPage() {
  return (
    <ForcedLang value="en">
      <UrlLangSync lang="en" />
      <TermsPage />
    </ForcedLang>
  );
}
