// Post an ad (English) — /en/publish.
//
// Same publish form as the Arabic /publish (src/app/publish/page.tsx),
// with the UI locale forced to English for the whole page subtree
// (ForcedLang). English metadata + hreflang cluster.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ForcedLang } from '@/lib/i18n';
import PublishPage from '@/app/publish/page';

export function generateMetadata(): Metadata {
  return {
    title: 'Post an ad | Dlala',
    description: 'Post your ad for free on Dlala.',
    alternates: {
      canonical: 'https://www.dzdlala.com/en/publish',
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

export default function EnPublishPage() {
  return (
    <ForcedLang value="en">
      <Suspense>
        <PublishPage />
      </Suspense>
    </ForcedLang>
  );
}
