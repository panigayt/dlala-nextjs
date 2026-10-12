// Instant-paint snapshots for auth-gated pages — port of js/snapshot.js
// (0.0.0.22, Zak-ordered). Same recipe as home's paintCachedFeed,
// generalized: each gated page saves its last good render to localStorage;
// on boot the page paints the snapshot synchronously (no SDK download, no
// auth restore, no network), then refreshes silently in the background.
// Keys are per-user; entries expire after SNAP_TTL. The uid is mirrored to
// localStorage on every auth event (dlala_uid) so a page can find its
// snapshot before Auth is ready; the mirror and the snapshots are cleared
// on sign-out (the mirror is maintained by tasteMirrorUid in @/lib/taste,
// which already drops per-user snapshots on sign-out — same as legacy
// js/app.js attachAuth + dropSnapshotMirror).
//
// Pure/DOM-free: safe to import from Server Components; every function is
// a no-op when localStorage is unavailable (private mode, SSR).

const SNAP_TTL = 10 * 60 * 1000; // 10 minutes, same as the home feed cache

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function snapUid(): string {
  try {
    return storage()?.getItem('dlala_uid') || '';
  } catch {
    return '';
  }
}

export function snapKey(page: string, uid: string): string {
  return 'dlala_snap_' + page + '_' + uid;
}

export interface Snapshot<T> {
  uid: string;
  data: T;
}

// Returns { uid, data } or null (no snapshot, expired, corrupt, or no uid).
// ttlMs overrides SNAP_TTL for pages whose state changes rarely (e.g. the
// Vitrine, where a day-old snapshot still beats an error box).
export function snapshotRead<T>(page: string, ttlMs?: number): Snapshot<T> | null {
  try {
    const uid = snapUid();
    if (!uid) return null;
    const raw = storage()?.getItem(snapKey(page, uid));
    if (!raw) return null;
    const s = JSON.parse(raw) as { v?: number; ts?: number; data?: T } | null;
    const ttl = ttlMs || SNAP_TTL;
    // 11 Oct 2026: reject missing/NaN ts — was treated as fresh forever.
    if (!s || s.v !== 1 || !s.data || !Number.isFinite(s.ts) || Date.now() - (s.ts as number) > ttl) return null;
    return { uid, data: s.data };
  } catch {
    return null;
  }
}

export function snapshotWrite<T>(page: string, uid: string, data: T): void {
  try {
    if (!uid || data === undefined) return;
    storage()?.setItem(
      snapKey(page, uid),
      JSON.stringify({ v: 1, ts: Date.now(), data })
    );
  } catch {
    /* quota / private mode — the live path still works */
  }
}

export function snapshotClearUser(uid: string): void {
  try {
    if (!uid) return;
    const st = storage();
    if (!st) return;
    for (let i = st.length - 1; i >= 0; i--) {
      let k: string | null = null;
      try {
        k = st.key(i);
      } catch {
        /* ignore */
      }
      if (k && k.indexOf('dlala_snap_') === 0 && k.slice(-uid.length - 1) === '_' + uid) {
        try {
          st.removeItem(k);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

// Normalize every Firestore timestamp shape to millis so snapshots
// JSON-round-trip cleanly. Mirrors DlalaMarket.dateToMs semantics.
export function snapMs(ts: unknown): number {
  if (ts == null) return 0;
  if (typeof ts === 'number') return ts;
  try {
    const o = ts as { toMillis?: () => number; toDate?: () => Date };
    if (typeof o.toMillis === 'function') return o.toMillis();
    if (typeof o.toDate === 'function') return o.toDate().getTime();
  } catch {
    /* fall through */
  }
  const n = new Date(ts as string).getTime();
  return isNaN(n) ? 0 : n;
}
