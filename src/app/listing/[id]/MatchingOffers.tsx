'use client';

// js/listing.js loadMatches parity (wanted branch): the «عروض مطابقة لطلبك»
// section on a wanted (مطلوب) listing page. The server fetches the
// unfiltered 40-doc category window; this component applies
// DlalaMarket.matchingOffers (js/market.js) client-side with the viewer's
// uid — same as legacy (myUid = currentUser?.uid ?? '').

import { useAuthState } from '@/lib/firebase';
import { matchingOffers } from '@/lib/matching';
import { type ListingCard } from '@/lib/firestore';
import ListingCardView from '@/components/ListingCardView';
import { useLang } from '@/lib/i18n';

// Server-serializable card (createdAt as ISO string — Date is not
// serializable across the server/client boundary).
export interface MatchOfferDoc
  extends Omit<ListingCard, 'createdAt' | 'title'> {
  title: unknown;
  createdAt?: string | null;
}

function MatchesSkeleton() {
  const { t } = useLang();
  return (
    <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
      <h2 className="text-lg font-semibold mb-4">{t('matchingOffers')}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl bg-zinc-100 aspect-[4/3] animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

export default function MatchingOffers({
  windowDocs,
  wanted,
}: {
  windowDocs: MatchOfferDoc[];
  wanted: { title: unknown; categoryId?: string };
}) {
  const auth = useAuthState();
  // Round 108: trilingual AR/FR/EN (js/i18n.js parity).
  const { t } = useLang();
  if (auth.status === 'loading') return <MatchesSkeleton />;
  const myUid = auth.status === 'signed-in' ? auth.user.uid : '';
  const matches = matchingOffers(wanted, windowDocs, myUid);
  return (
    <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
      <h2 className="text-lg font-semibold mb-4">{t('matchingOffers')}</h2>
      {matches.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {matches.map((m) => {
            const doc = m as MatchOfferDoc;
            // The shared card expects a Date; the server boundary gives an
            // ISO string — convert here (client-side, once per render).
            const l = {
              ...(doc as unknown as ListingCard),
              createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
            };
            return <ListingCardView key={doc.id} l={l} />;
          })}
        </div>
      ) : (
        <p className="text-zinc-500">{t('noMatchingOffers')}</p>
      )}
    </div>
  );
}
