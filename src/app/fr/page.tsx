// Dlala home (French) — /fr/.
//
// Same server-rendered feed as the Arabic homepage (src/app/page.tsx —
// getHomeFeed is the verbatim shared fetcher), with the UI locale forced to
// French for the whole page subtree (ForcedLang), French metadata, and the
// full hreflang cluster (ar default unprefixed + fr + en + x-default).

import type { Metadata } from 'next';
import { getHomeFeed } from '@/lib/home-feed';
import { t, type Lang } from '@/lib/i18n-strings';
import { ForcedLang } from '@/lib/i18n';
import HomePage, { type HomeFeedData } from '@/components/HomePage';
import FeedPreloadHints from '@/components/FeedPreloadHints';

const LANG: Lang = 'fr';
const CANONICAL = 'https://www.dzdlala.com/fr';

export function generateMetadata(): Metadata {
  const title = t('title_home', LANG);
  const desc = t('meta_home_desc', LANG);
  return {
    title,
    description: desc,
    alternates: {
      canonical: CANONICAL,
      languages: {
        ar: 'https://www.dzdlala.com',
        fr: 'https://www.dzdlala.com/fr',
        en: 'https://www.dzdlala.com/en',
        'x-default': 'https://www.dzdlala.com',
      },
    },
    openGraph: {
      title,
      description: desc,
      type: 'website',
      url: CANONICAL,
      images: [{ url: 'https://www.dzdlala.com/icon-512.png' }],
    },
    twitter: {
      card: 'summary',
      title,
      description: desc,
    },
  };
}

export default async function HomeFr() {
  let feed: HomeFeedData | null = null;
  let error: string | null = null;
  try {
    feed = await getHomeFeed();
  } catch (e) {
    error = e instanceof Error ? e.message : 'feed-error';
  }

  return (
    <div lang="fr" dir="ltr">
      {/* Same preload-hint bands as src/app/page.tsx (Round 20 T4/T11). */}
      <FeedPreloadHints cards={feed ? feed.cards.slice(4, 6) : []} />
      <FeedPreloadHints cards={feed ? feed.cards.slice(6, 12) : []} priority="low" />
      <ForcedLang value={LANG}>
        <HomePage feed={feed} error={error} />
      </ForcedLang>
    </div>
  );
}
