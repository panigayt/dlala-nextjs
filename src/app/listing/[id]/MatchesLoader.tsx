'use client';

// Round 17 T11 (initial-JS audit): same split fix as ActionsLoader —
// next/dynamic() in the Server Component did not code-split, so the whole
// MatchingOffers module (ListingCardView + FavoriteToggle + matching lib)
// shipped in the listing page's initial JS. This tiny client wrapper
// restores the separate chunk; SSR still renders the real section.

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type MatchingOffers from './MatchingOffers';

function MatchesSkeleton() {
  return (
    <div className="mt-4 rounded-xl bg-white shadow-sm p-5" aria-hidden="true">
      <div className="h-6 w-40 bg-zinc-100 rounded animate-pulse mb-4" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl bg-zinc-100 aspect-[4/3] animate-pulse" />
        ))}
      </div>
    </div>
  );
}

const MatchingOffersLazy = dynamic(() => import('./MatchingOffers'), {
  loading: () => <MatchesSkeleton />,
});

export default function MatchesLoader(
  props: ComponentProps<typeof MatchingOffers>
) {
  return <MatchingOffersLazy {...props} />;
}
