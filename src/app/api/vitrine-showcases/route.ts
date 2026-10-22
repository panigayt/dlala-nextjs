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
import { cacheLife } from 'next/cache';
import { fetchVitrineShowcases, type VitrineShowcaseData } from '@/lib/firestore';

// Guest shield (22 Oct 2026): the showcase payload is identical for
// every visitor and the client fetches it on every home mount with
// no-store, so each home view used to re-run the registry query plus
// the per-seller profile/batchGet fan-out. Cache it for the same 60s
// window the response Cache-Control header already promises.
async function getShowcasesCached(): Promise<VitrineShowcaseData[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchVitrineShowcases();
}

export async function GET() {
  try {
    const showcases = await getShowcasesCached();
    return NextResponse.json(
      { showcases },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch {
    // Round 26 (BH-4): stable error code — echoing e.message leaked
    // internal identifiers (vitrine-registry-<status>). Matches
    // feed ('feed-unavailable') / search ('search-failed') convention.
    return NextResponse.json(
      { showcases: [], error: 'vitrine-error' },
      { status: 200 } // 200 with empty list: never break the feed
    );
  }
}

// Round 6 (18 Oct 2026): 405 with Allow header for wrong methods.
// Next.js auto-405 omits the Allow header; RFC 9110 requires it.
const METHOD_NOT_ALLOWED_GET = () =>
  NextResponse.json({ error: 'method-not-allowed' }, { status: 405, headers: { Allow: 'GET' } });
export async function POST() { return METHOD_NOT_ALLOWED_GET(); }
export async function PUT() { return METHOD_NOT_ALLOWED_GET(); }
export async function DELETE() { return METHOD_NOT_ALLOWED_GET(); }
export async function PATCH() { return METHOD_NOT_ALLOWED_GET(); }
