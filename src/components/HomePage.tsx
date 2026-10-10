'use client';

// Home page client shell — Round 107.
//
// The server (src/app/page.tsx) fetches the feed; this client component
// owns everything language-dependent: text direction, the section heading,
// the error/empty states, and the feed itself. On a language switch every
// mounted useLang() consumer re-renders (Round 106 app-wide store), so the
// whole home page flips AR/FR/EN without a reload — js/i18n.js
// onLangChange() parity.

import HomeHeader from '@/components/HomeHeader';
import FeedWithLoadMore from '@/components/FeedWithLoadMore';
import { resultsCountText, type ListingCard } from '@/lib/firestore';
import { useLang } from '@/lib/i18n';

export interface HomeFeedData {
  cards: ListingCard[];
  wantedPool: ListingCard[];
  regularOffset: number;
  wantedOffset: number;
  hasMore: boolean;
}

export default function HomePage({
  feed,
  error,
}: {
  feed: HomeFeedData | null;
  error: string | null;
}) {
  const { t, lang } = useLang();
  const cards = feed?.cards || [];

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <HomeHeader />
        <h2 className="text-lg font-semibold text-zinc-800 mb-4">{t('latestAds')}</h2>

        {error ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
            ⚠️ {t('errorGeneric')} ({error}){' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-bold underline"
            >
              {t('retry')}
            </button>
          </div>
        ) : cards.length === 0 ? (
          <>
            {/* FIX-WEB-014 parity: legacy still paints resultsMeta with
                the zero-count above the empty state. */}
            <div
              role="status"
              aria-live="polite"
              className="text-[13px] text-zinc-500 px-0.5 py-1.5 min-h-[1.2em]"
            >
              {resultsCountText(0, lang)}
            </div>
            <div className="rounded-xl bg-white p-6 text-center text-zinc-500">
              {t('feedEmpty')}
            </div>
          </>
        ) : (
          feed && (
            <FeedWithLoadMore
              initialCards={cards}
              wantedPool={feed.wantedPool}
              initialRegularOffset={feed.regularOffset}
              initialWantedOffset={feed.wantedOffset}
              initialHasMore={feed.hasMore}
            />
          )
        )}

        <p className="mt-8 text-center text-xs text-zinc-400">
        </p>
      </main>
    </div>
  );
}
