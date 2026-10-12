'use client';

// Round 11 (12 Oct 2026): `ssr: false` is not allowed with next/dynamic in
// Server Components, so the two fire-and-forget view recorders live behind
// this tiny client wrapper. Both recorders are client-only by nature (they
// use useEffect + localStorage); nothing renders on the server and hydration
// is never blocked.

import dynamic from 'next/dynamic';

const TasteViewRecorder = dynamic(() => import('./TasteViewRecorder'), {
  ssr: false,
});
const ViewRecorder = dynamic(() => import('./ViewRecorder'), { ssr: false });

export default function RecordersClient({
  listing,
  sellerId,
}: {
  listing: {
    id: string;
    categoryId?: string;
    price?: number;
    wilayaCode?: number;
    sellerId?: string;
  };
  sellerId?: string;
}) {
  return (
    <>
      <TasteViewRecorder listing={listing} />
      {sellerId && <ViewRecorder listingId={listing.id} sellerId={sellerId} />}
    </>
  );
}
