// Publier une annonce (French) — /fr/publish.
//
// Same publish form as the Arabic /publish (src/app/publish/page.tsx),
// with the UI locale forced to French for the whole page subtree
// (ForcedLang). French metadata + hreflang cluster.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ForcedLang } from '@/lib/i18n';
import PublishPage from '@/app/publish/page';
import UrlLangSync from '@/components/UrlLangSync';

export function generateMetadata(): Metadata {
  return {
    title: 'Publier une annonce | Dlala',
    description: 'Publiez votre annonce gratuitement sur Dlala.',
    alternates: {
      canonical: 'https://www.dzdlala.com/fr/publish',
      languages: {
        ar: 'https://www.dzdlala.com/publish',
        fr: 'https://www.dzdlala.com/fr/publish',
        en: 'https://www.dzdlala.com/en/publish',
        'x-default': 'https://www.dzdlala.com/publish',
      },
    },
    robots: { index: false, follow: false },
  };
}

export default function FrPublishPage() {
  return (
    <ForcedLang value="fr">
      {/* R23-4: sync the language store to the URL language so the
          auth-gate detour through /auth also renders French. */}
      <UrlLangSync lang="fr" />
      <Suspense>
        <PublishPage />
      </Suspense>
    </ForcedLang>
  );
}
