'use client';

// Records a listing view for the on-device taste personalization.
//
// Mirrors js/listing.js -> js/taste.js tasteRecordView(): called on every
// non-owner listing view. Owner views are excluded inside tasteRecordView
// via the dlala_uid mirror (they say nothing about taste).
// Fire-and-forget: a taste failure must never break the listing page.

import { useEffect } from 'react';
import { tasteRecordView } from '@/lib/taste';

export default function TasteViewRecorder({
  listing,
}: {
  listing: {
    id: string;
    categoryId?: string;
    category?: string;
    price?: number;
    wilayaCode?: number;
    sellerId?: string;
  };
}) {
  const listingId = listing.id;
  useEffect(() => {
    try {
      tasteRecordView({
        id: listingId,
        categoryId: listing.categoryId,
        category: listing.category,
        price: listing.price,
        wilayaCode: listing.wilayaCode,
        sellerId: listing.sellerId,
      });
    } catch {
      /* taste must never break the listing page */
    }
    // Intentionally keyed on the id only: one view signal per listing open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);
  return null;
}
