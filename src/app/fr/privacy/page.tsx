// Politique de confidentialité (français) — /fr/privacy.
//
// Same privacy policy as the unprefixed /privacy (src/app/privacy/page.tsx),
// with the UI locale forced to French for the whole page subtree
// (ForcedLang + UrlLangSync, the /fr/publish pattern) and French metadata
// + the hreflang cluster. R28-2 (24 Oct 2026): this pinned route did not
// exist — /fr/privacy 404'd while sibling footer content (guides) had
// pinned /fr routes.
import type { Metadata } from 'next';
import { ForcedLang } from '@/lib/i18n';
import { t } from '@/lib/i18n-strings';
import PrivacyPage from '@/app/privacy/page';
import UrlLangSync from '@/components/UrlLangSync';

export function generateMetadata(): Metadata {
  const title = t('title_privacy', 'fr');
  const description = "Politique de confidentialité de l'application et du site DLALA";
  return {
    title,
    description,
    alternates: {
      canonical: 'https://www.dzdlala.com/fr/privacy',
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
      locale: 'fr_DZ',
      title,
      description,
      url: 'https://www.dzdlala.com/fr/privacy',
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

export default function PrivacyFrPage() {
  return (
    <ForcedLang value="fr">
      <UrlLangSync lang="fr" />
      <PrivacyPage />
    </ForcedLang>
  );
}
