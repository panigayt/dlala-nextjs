'use client';

// Round 69: wraps the seller tabs so the listings tab count stays honest as
// the "Show more" button loads more ads. (Legacy tabs show no count; the
// count is a Next.js addition, and a stale count would be a visible defect.)

import { useState, type ReactNode } from 'react';
import SellerTabs from './SellerTabs';
import StoreListingsGrid from './StoreListingsGrid';
import type { ListingCard } from '@/lib/firestore';

export default function SellerTabsSection({
  uid,
  isPro,
  initialListings,
  initialLimit,
  infos,
}: {
  uid: string;
  isPro: boolean;
  initialListings: ListingCard[];
  initialLimit: number;
  infos: ReactNode;
}) {
  const [loadedCount, setLoadedCount] = useState(initialListings.length);

  return (
    <SellerTabs
      uid={uid}
      isPro={isPro}
      listingsCount={loadedCount}
      listings={
        <StoreListingsGrid
          uid={uid}
          initialListings={initialListings}
          initialLimit={initialLimit}
          isPro={isPro}
          onCountChange={setLoadedCount}
        />
      }
      infos={infos}
    />
  );
}
