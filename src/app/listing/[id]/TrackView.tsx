'use client';

// Round 19 BO-D2 (18 Oct 2026): GA4 listing-view event.
// Fires once per page mount; analytics-only, never affects rendering.

import { useEffect } from 'react';
import { trackEvent } from '@/lib/analytics';

export default function TrackView({ id }: { id: string }) {
  useEffect(() => {
    trackEvent('view_item', { item_id: id });
  }, [id]);
  return null;
}
