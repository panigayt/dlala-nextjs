// Ratings data layer — pure logic behind the "★ قيّم هذا المستخدم" entry
// point (src/components/RateCta.tsx). Mirrors js/market.js verbatim:
//
// - rateableDeals(otherUid): the 50 most recent of MY conversations
//   (participants array-contains me, orderBy updatedAt desc, limit 50),
//   filtered client-side to buyer-confirmed deals with the other user,
//   excluding conversations I already rated. The per-deal rating-existence
//   + listing-title reads run in parallel (P1-1, 16 Sep 2026).
// - submitRating: deterministic id {conversationId}_{raterId}; stars 1-5;
//   comment mandatory (Zak: only buyer-confirmed deals — mutual 5-star +
//   mandatory written comment, not saved/shown otherwise). The client writes
//   only the rating document; the public rating/ratingCount counters are
//   owned by the recalcRating Cloud Function (rules deny counter writes).
//
// Kept DOM-free and React-free so the logic is unit-testable (node harness).

import type { CompatUser, FirebaseClient } from './firebase-client';
import { withTimeout } from './timeout';

export interface RateableDeal {
  conversationId: string;
  listingId: string;
  rateeId: string;
  listingTitle: string;
}

export function localizedTitle(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['ar', 'fr', 'en']) {
      if (typeof o[k] === 'string' && (o[k] as string).trim())
        return (o[k] as string).trim();
    }
  }
  return '';
}

// js/market.js rateableDeals verbatim parity.
export async function fetchRateableDeals(
  client: FirebaseClient,
  me: string,
  otherUid: string
): Promise<RateableDeal[]> {
  const snap = await withTimeout(
    client.db
      .collection('conversations')
      .where('participants', 'array-contains', me)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get(),
    15000
  );
  const candidates: Array<{
    id: string;
    c: Record<string, unknown>;
    rateeId: string;
  }> = [];
  snap.forEach((d) => {
    const c = (d.data() || {}) as Record<string, unknown>;
    if (c.dealConfirmedByBuyer !== true) return;
    const parts = c.participants;
    if (!Array.isArray(parts) || !parts.includes(otherUid)) return;
    if (c.buyerId !== me && c.sellerId !== me) return;
    const rateeId = c.buyerId === me ? c.sellerId : c.buyerId;
    if (typeof rateeId !== 'string' || rateeId !== otherUid) return;
    candidates.push({ id: d.id, c, rateeId });
  });
  const results = await Promise.all(
    candidates.map(async ({ id, c, rateeId }) => {
      const r = await withTimeout(
        client.db.doc(`ratings/${id}_${me}`).get(),
        15000
      );
      if (r.exists) return null;
      let listingTitle = '';
      try {
        const listingId = c.listingId;
        if (typeof listingId === 'string' && listingId) {
          const ld = await withTimeout(
            client.db.doc(`listings/${listingId}`).get(),
            15000
          );
          if (ld.exists)
            listingTitle = localizedTitle((ld.data() || {}).title);
        }
      } catch {
        /* sold listing may be unreadable — title stays blank */
      }
      return {
        conversationId: id,
        listingId: typeof c.listingId === 'string' ? c.listingId : '',
        rateeId,
        listingTitle,
      };
    })
  );
  return results.filter((x): x is RateableDeal => x !== null);
}

// js/market.js submitRating verbatim parity.
export async function submitRating({
  client,
  user,
  conversationId,
  listingId,
  rateeId,
  stars,
  comment,
}: {
  client: FirebaseClient;
  user: CompatUser;
  conversationId: string;
  listingId: string;
  rateeId: string;
  stars: number;
  comment: string;
}): Promise<void> {
  const clean = String(comment || '').trim();
  if (!(stars >= 1 && stars <= 5)) throw new Error('stars');
  if (!clean) throw new Error('comment');
  const ratingId = `${conversationId}_${user.uid}`;
  let raterName = '';
  try {
    const me = await withTimeout(
      client.db.doc(`users/${user.uid}`).get(),
      15000
    );
    raterName = (me.data()?.name as string) || '';
  } catch {
    /* name stays blank */
  }
  const existing = await withTimeout(
    client.db.doc(`ratings/${ratingId}`).get(),
    15000
  );
  if (existing.exists) {
    const err = new Error('already') as Error & { code?: string };
    err.code = 'already-rated';
    throw err;
  }
  await withTimeout(
    client.db.doc(`ratings/${ratingId}`).set({
      conversationId,
      listingId,
      raterId: user.uid,
      raterName,
      rateeId,
      stars,
      comment: clean,
      createdAt: client.FieldValue.serverTimestamp(),
    }),
    15000
  );
}
