// GET /api/vitrine-showcases — vitrine showcase candidates for the home feed.
//
// Returns: { showcases: VitrineShowcaseData[] }
//
// Each showcase: { seller: {...}, products: ListingCard[] }.
// The client applies the R17 no-repeat filter (localStorage) and selects
// up to 3 showcases via selectVitrineShowcases() from @/lib/vitrine.
//
// Best-effort by design: a failure here must never break the home feed
// (legacy insertVitrineCards is wrapped in try/catch for the same reason).

import { NextResponse } from 'next/server';
import { fetchVitrineShowcases } from '@/lib/firestore';

export async function GET() {
  try {
    const showcases = await fetchVitrineShowcases();
    return NextResponse.json(
      { showcases },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch (e) {
    return NextResponse.json(
      { showcases: [], error: e instanceof Error ? e.message : 'vitrine-error' },
      { status: 200 } // 200 with empty list: never break the feed
    );
  }
}
