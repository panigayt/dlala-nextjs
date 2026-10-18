// Follow boost + «جديد من متابَعيك» strip (TEST ROUND 56).
//
// Verbatim ports of applyFollowBoost() and newFromFollows() from
// ~/workspace/dlala-040/js/home.js (v101, Zak-approved 16 Sep 2026).
// Pure functions — unit-tested in legacy, safe on server and client.
//
// Composition (js/home.js buildFeed, sort === 'recent', default filter):
//   tasteRankDefault(pool) → applyFollowBoost(pool, followedSet())
//   → interleaveWanted(pool, wanted)
// The «جديد من متابَعيك» strip renders from the SAME default/recent
// regular pool (no extra queries) and sits above the main feed.

export const FOLLOW_BOOST_EVERY = 4;

export interface FollowBoostListing {
  id?: string;
  sellerId?: string;
  isWanted?: boolean;
  createdAt?: unknown;
}

// Listings from stores the user follows are "suggested" in the default
// home feed. Pure. Diversity cap (no filter bubble): at most 1 followed
// card in every 4 consecutive cards, followed cards never back-to-back,
// recency order preserved inside each group.
export function applyFollowBoost<T extends FollowBoostListing>(
  regular: T[],
  followed: Set<string>
): T[] {
  if (!Array.isArray(regular) || regular.length < 2) return regular;
  if (!followed || !followed.size) return regular;
  const fol: T[] = [];
  const rest: T[] = [];
  for (const d of regular) {
    const sid = String((d && d.sellerId) || '');
    (sid && followed.has(sid) ? fol : rest).push(d);
  }
  if (!fol.length || !rest.length) return regular;
  const out: T[] = [];
  let fi = 0;
  let ri = 0;
  let sinceFollow = 0; // recency leads: R R R F R R R F …
  while (fi < fol.length || ri < rest.length) {
    if (fi < fol.length && (sinceFollow >= FOLLOW_BOOST_EVERY - 1 || ri >= rest.length)) {
      out.push(fol[fi++]);
      sinceFollow = 0;
    } else if (ri < rest.length) {
      out.push(rest[ri++]);
      sinceFollow++;
    } else break;
  }
  return out;
}

export const FOLLOWS_NEW_DAYS = 7;
export const FOLLOWS_PER_USER = 3;

// createdAt → ms. Handles Date, ISO strings (Next.js serializes props),
// numeric ms, and Firestore Timestamp-likes. Legacy used
// DlalaMarket.dateToMs (guarded); this is the standalone equivalent.
function createdMs(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) {
    const t = v.getTime();
    return isNaN(t) ? 0 : t;
  }
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  if (typeof v === 'object') {
    const o = v as { seconds?: unknown; nanoseconds?: unknown; toMillis?: unknown };
    if (typeof o.toMillis === 'function') {
      try {
        const t = (o.toMillis as () => number)();
        return typeof t === 'number' && isFinite(t) ? t : 0;
      } catch {
        return 0;
      }
    }
    if (typeof o.seconds === 'number') {
      return (
        o.seconds * 1000 +
        (typeof o.nanoseconds === 'number' ? Math.floor(o.nanoseconds / 1e6) : 0)
      );
    }
  }
  return 0;
}

// «جديد من متابَعيك» — the latest listings from followed users.
// Pure selector: only listings from the last 7 days, at most 3 per
// followed user (a hyperactive seller cannot flood the section),
// newest first. Wanted ads are excluded (legacy parity).
export function newFromFollows<T extends FollowBoostListing>(
  regular: T[],
  followed: Set<string>,
  nowMs?: number
): T[] {
  if (!Array.isArray(regular) || !followed || !followed.size) return [];
  const cutoff = (nowMs || Date.now()) - FOLLOWS_NEW_DAYS * 86400000;
  const per: Record<string, number> = {};
  const out: T[] = [];
  const fresh = regular
    .filter((d) => {
      if (!d || d.isWanted) return false;
      const sid = String(d.sellerId || '');
      if (!sid || !followed.has(sid)) return false;
      const ms = createdMs(d.createdAt) || 0;
      return ms >= cutoff;
    })
    .sort((a, b) => (createdMs(b.createdAt) || 0) - (createdMs(a.createdAt) || 0));
  for (const d of fresh) {
    const sid = String(d.sellerId);
    per[sid] = per[sid] || 0;
    if (per[sid] < FOLLOWS_PER_USER) {
      per[sid]++;
      out.push(d);
    }
  }
  return out;
}

// Followed-set localStorage cache — the legacy key (js/app.js
// FOLLOWED_CACHE_KEY = 'dlala_followed_v1'). Synchronously seeded at
// first paint, refreshed in the background once auth settles
// (js/home.js followedSet() pattern).
const FOLLOWED_CACHE_KEY = 'dlala_followed_v1';

export function loadFollowedCache(): Set<string> {
  try {
    const raw = localStorage.getItem(FOLLOWED_CACHE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x) => typeof x === 'string' && x.length > 0));
  } catch {
    return new Set();
  }
}

export function saveFollowedCache(set: Set<string>): void {
  try {
    localStorage.setItem(FOLLOWED_CACHE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore — best-effort cache
  }
}

export function setsEqual(a: Set<string> | null, b: Set<string>): boolean {
  if (!a || a.size !== b.size) return false;
  for (const x of b) if (!a.has(x)) return false;
  return true;
}

// Round 29 D3 (18 Oct 2026): follow/unfollow must update the
// 'dlala_followed_v1' first-paint cache IMMEDIATELY, otherwise the
// homepage follow boost stays stale until the auth-settled refresh
// self-heals. Only bumps when a seeded cache exists — never fabricate
// a partial set (a direct landing on a seller page has no full set;
// the homepage always re-seeds + refreshes from the server).
// Best-effort, never throws.
export function bumpFollowedCache(uid: string, following: boolean): void {
  try {
    if (!localStorage.getItem(FOLLOWED_CACHE_KEY)) return;
    const set = loadFollowedCache();
    if (following) set.add(uid);
    else set.delete(uid);
    saveFollowedCache(set);
  } catch {
    // ignore — best-effort cache
  }
}
