'use client';

// js/listing.js loadMatches parity (wanted branch): the «عروض مطابقة لطلبك»
// section on a wanted (مطلوب) listing page. The server fetches the
// unfiltered 40-doc category window; this component applies
// DlalaMarket.matchingOffers (js/market.js) client-side with the viewer's
// uid — same as legacy (myUid = currentUser?.uid ?? '').

import Link from 'next/link';
import { useAuthState } from '@/lib/firebase-client';
import { matchingOffers } from '@/lib/matching';
import {
  cardImage,
  cardTitle,
  formatPrice,
  type ListingCard,
} from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import TimeAgo from '@/components/TimeAgo';
import BlurUpImage from '@/components/BlurUpImage';

// Server-serializable card (createdAt as ISO string — Date is not
// serializable across the server/client boundary).
export interface MatchOfferDoc
  extends Omit<ListingCard, 'createdAt' | 'title'> {
  title: unknown;
  createdAt?: string | null;
}

function wilayaName(code: number | undefined): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string }[]).find(
    (x) => x.code === Number(code)
  );
  return w ? `${w.code} - ${w.ar}` : '';
}

// Card for the matching-offers grid — mirrors the page's SimilarCard
// (same markup, same styling).
function MatchOfferCard({ l }: { l: MatchOfferDoc }) {
  const lc = l as unknown as ListingCard;
  const img = cardImage(lc);
  return (
    <Link
      href={`/listing/${l.id}`}
      className="block rounded-xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      dir="rtl"
    >
      <div className="relative aspect-[4/3] bg-zinc-100">
        {img ? (
          <BlurUpImage
            listing={lc}
            img={img}
            alt={cardTitle(lc)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">
            📷
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="font-bold text-emerald-700 text-lg">
          {formatPrice(Number(l.price) || 0)}
        </p>
        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">
          {cardTitle(lc)}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          {wilayaName(l.wilayaCode)}
          {l.createdAt ? (
            <>
              {' · '}
              <TimeAgo iso={l.createdAt} />
            </>
          ) : (
            ''
          )}
        </p>
      </div>
    </Link>
  );
}

function MatchesSkeleton() {
  return (
    <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
      <h2 className="text-lg font-semibold mb-4">عروض مطابقة لطلبك</h2>
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
  if (auth.status === 'loading') return <MatchesSkeleton />;
  const myUid = auth.status === 'signed-in' ? auth.user.uid : '';
  const matches = matchingOffers(wanted, windowDocs, myUid);
  return (
    <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
      <h2 className="text-lg font-semibold mb-4">عروض مطابقة لطلبك</h2>
      {matches.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {matches.map((m) => (
            <MatchOfferCard key={(m as MatchOfferDoc).id} l={m as MatchOfferDoc} />
          ))}
        </div>
      ) : (
        <p className="text-zinc-500">لا توجد عروض مطابقة حالياً.</p>
      )}
    </div>
  );
}
