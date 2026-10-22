// Favorite-write teardown rescue (Round 14, 22 Oct 2026).
//
// A favorite toggle's Firestore commit is only durable once the server
// acks it. If the page is torn down while the commit is still in flight
// (tab close, reload, full navigation within the first moments after the
// tap), the SDK's in-memory mutation queue dies with the page and the
// toggle is silently lost — the UI already showed it applied
// (round-13b cross-session unfavorite loss; A/B-proven in round 14).
//
// This module is the platform-standard durability pattern for that
// window (the fetch-keepalive family, as used for analytics beacons):
// a toggle arms a pending record BEFORE dispatching its batch; a
// pagehide listener re-fires the same mutation over the Firestore REST
// API with keepalive if — and only if — the record is still armed at
// teardown (the commit path disarms it on ack). The mutation is
// idempotent by construction (deterministic doc ids: delete of an
// absent doc is a no-op, PATCH replaces the same content), so if the
// SDK write ALSO reached the server, the rescue is a harmless repeat.
// During normal operation the rescue never fires: zero extra writes.

import { FIREBASE_CONFIG } from '@/lib/firebase';

export interface FavRescueData {
  title: string;
  price: number;
  photoUrl: string;
  sellerId: string;
}

interface PendingFav {
  uid: string;
  listingId: string;
  /** true = the tap intends the listing to END UP favorited. */
  target: boolean;
  /** Denormalized favorite-doc fields (target === true only). */
  data: FavRescueData | null;
  /** ID token captured at tap time (valid ~1h; the rescue window is seconds). */
  token: string | null;
}

let pending: PendingFav | null = null;
let listening = false;

export function armFavRescue(p: Omit<PendingFav, 'token'>): void {
  pending = { ...p, token: null };
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('pagehide', flushFavRescue);
  }
}

export function setFavRescueToken(token: string): void {
  if (pending) pending.token = token;
}

export function disarmFavRescue(listingId: string): void {
  if (pending && pending.listingId === listingId) pending = null;
}

function restDocUrl(path: string): string {
  return (
    'https://firestore.googleapis.com/v1/projects/' +
    FIREBASE_CONFIG.projectId +
    '/databases/(default)/documents/' +
    path
  );
}

function flushFavRescue(): void {
  const p = pending;
  pending = null;
  if (!p || !p.token) return;
  const headers = { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' };
  const favPath = `favorites/${p.uid}/items/${p.listingId}`;
  const trackPath = `listingFavoriters/${p.listingId}/users/${p.uid}`;
  try {
    if (!p.target) {
      // Unfavorite: delete both docs (mirrors the toggle's batch).
      void fetch(restDocUrl(favPath), { method: 'DELETE', headers, keepalive: true }).catch(() => {});
      void fetch(restDocUrl(trackPath), { method: 'DELETE', headers, keepalive: true }).catch(() => {});
    } else if (p.data) {
      // Favorite: PATCH replaces the whole doc — same semantics as the
      // toggle's batch.set. createdAt uses the tap-time clock (the rules
      // for favorites impose no request.time equality).
      const iso = new Date().toISOString();
      const favBody = {
        fields: {
          listingId: { stringValue: p.listingId },
          title: { mapValue: { fields: { ar: { stringValue: p.data.title } } } },
          price: { integerValue: String(Math.trunc(p.data.price || 0)) },
          photoUrl: { stringValue: p.data.photoUrl || '' },
          sellerId: { stringValue: p.data.sellerId || '' },
          createdAt: { timestampValue: iso },
        },
      };
      const trackBody = { fields: { createdAt: { timestampValue: iso } } };
      void fetch(restDocUrl(favPath), {
        method: 'PATCH',
        headers,
        body: JSON.stringify(favBody),
        keepalive: true,
      }).catch(() => {});
      void fetch(restDocUrl(trackPath), {
        method: 'PATCH',
        headers,
        body: JSON.stringify(trackBody),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* teardown path — nothing sensible left to do */
  }
}
