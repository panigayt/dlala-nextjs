// src/lib/taste.ts — Round 53.
//
// Verbatim TypeScript port of ~/workspace/dlala-040/js/taste.js (0.0.0.43).
// 0.0.0.26 (Zak, 18 Sep 2026): invisible on-device taste ranking for the
// home feed. Zak's rules:
//   - NO visual change — no badges, no sections, no new UI. Only the ORDER
//     of the default/recent feed changes.
//   - 25% taste / 75% exploration. The taste quarter holds ads SIMILAR to
//     the user's signals, NEVER the signal ads themselves (recommending an
//     ad the user already opened/favorited is noise).
//   - "It appears when you interact, it disappears when you ignore": if the
//     taste picks were visibly rendered and the user refreshes after 60s+
//     with no new signal, the taste quarter bows out completely (0%) until
//     a new signal (view/favorite) arrives. Persisted across sessions.
//   - Every refresh shows a new arrangement (rotation, never a pure
//     shuffle): fresh ads (<1h) first, then unseen-first, then seen.
//     "Show more" appends — it never reorders what is already visible.
//   - Price sorts, filters, search and the wanted interleave are untouched.
//
// Signals (all on-device, nothing sent to any server):
//   - favorites (weight 3 each) — from the favorites localStorage snapshot;
//   - listing views (weight 1 each, last 60) — tasteRecordView() (owner
//     views excluded); guests: sessionStorage (dies with the tab).
// This file has zero DOM and zero network by construction.

export const TASTE_VIEWS_CAP = 60;
const TASTE_FAV_WEIGHT = 3;
const TASTE_VIEW_WEIGHT = 1;
const TASTE_MIN_SCORE = 0.35; // below this a "taste match" is too weak — the slot goes to exploration
const TASTE_MIN_SEEN_MS = 60000; // the taste picks must have been visible this long before a refresh counts as "ignored"
const TASTE_FRESH_MS = 3600000; // <1h old = genuinely new: always leads the exploration pool
const FEED_SEEN_CAP = 300; // rendered listing ids remembered for unseen-first
const TASTE_FAVIDS_CAP = 20;

// Minimal doc shape the algorithm needs. ListingCard satisfies this.
// (No index signature: it would break assignability both ways.)
export interface TasteDoc {
  id?: string;
  categoryId?: string;
  category?: string;
  price?: number | string;
  wilayaCode?: number | string;
  createdAt?: unknown;
  sellerId?: string;
  isWanted?: boolean;
}

interface ViewSignal {
  i: string;
  c: string;
  p: number;
  w: number;
  t: number;
}

interface FavSignal {
  c: string;
  p: number;
  w: number;
  id: string;
}

interface TasteProfile {
  cats: Record<string, number>;
  wilayas: Record<string, number>;
  priceMed: Record<string, number>;
  n: number;
}

// Normalize every timestamp shape to millis (mirrors DlalaMarket.dateToMs).
function tasteMs(ts: unknown): number {
  if (ts == null) return 0;
  if (typeof ts === 'number') return ts;
  try {
    const o = ts as { toMillis?: unknown; toDate?: unknown };
    if (typeof o.toMillis === 'function')
      return (o.toMillis as () => number)();
    if (typeof o.toDate === 'function')
      return ((o.toDate as () => Date)()).getTime();
  } catch {
    /* fall through */
  }
  if (ts instanceof Date) return ts.getTime();
  const n = new Date(ts as string).getTime();
  return isNaN(n) ? 0 : n;
}

function tasteId(d: TasteDoc | null | undefined): string {
  return String((d && d.id) || '');
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function hasSessionStorage(): boolean {
  return typeof sessionStorage !== 'undefined';
}

function tasteUid(): string {
  try {
    if (hasLocalStorage()) return localStorage.getItem('dlala_uid') || '';
  } catch {
    /* ignore */
  }
  return '';
}

// Registered -> persistent localStorage; guest -> sessionStorage (dies with
// the tab: the "session taste" Zak approved, no account, no tracking).
function tasteStore(): { s: Storage; k: string } | null {
  try {
    const uid = tasteUid();
    if (uid && hasLocalStorage()) {
      return { s: localStorage, k: 'dlala_taste_views_' + uid };
    }
    if (hasSessionStorage()) {
      return { s: sessionStorage, k: 'dlala_taste_views_anon' };
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Feed-level state (seen set, rotation, dismissal). Same store split.
function feedStateStore(): { s: Storage; k: string } | null {
  try {
    const uid = tasteUid();
    if (hasLocalStorage() && uid) {
      return { s: localStorage, k: 'dlala_feed_state_' + uid };
    }
    if (hasSessionStorage()) {
      return { s: sessionStorage, k: 'dlala_feed_state_anon' };
    }
  } catch {
    /* ignore */
  }
  return null;
}

interface FeedState {
  stamp?: string;
  dismissed?: boolean;
  shownAt?: number;
  rot?: number;
  seen?: string[];
  favN?: number;
  favT?: number;
  favIds?: string[];
  [k: string]: unknown;
}

function feedStateRead(): FeedState {
  try {
    const st = feedStateStore();
    if (!st) return {};
    const raw = st.s.getItem(st.k);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    return o && typeof o === 'object' ? (o as FeedState) : {};
  } catch {
    return {};
  }
}

function feedStateWrite(patch: FeedState): void {
  try {
    const st = feedStateStore();
    if (!st) return;
    const cur = feedStateRead();
    for (const k in patch) cur[k] = patch[k];
    st.s.setItem(st.k, JSON.stringify(cur));
  } catch {
    /* taste must never break the feed */
  }
}

function tasteReadViews(): ViewSignal[] {
  try {
    const st = tasteStore();
    if (!st) return [];
    const raw = st.s.getItem(st.k);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? (arr.filter((v) => v && (v as ViewSignal).c) as ViewSignal[])
      : [];
  } catch {
    return [];
  }
}

// Called on every non-owner listing view. Own listings are never recorded
// (they say nothing about taste).
export function tasteRecordView(listing: TasteDoc | null | undefined): void {
  try {
    if (!listing) return;
    const uid = tasteUid();
    if (uid && listing.sellerId && listing.sellerId === uid) return;
    const st = tasteStore();
    if (!st) return;
    const c = listing.categoryId || listing.category || '';
    if (!c) return;
    let arr = tasteReadViews();
    arr.push({
      i: String(listing.id || ''),
      c: String(c),
      p: Number(listing.price || 0),
      w: Number(listing.wilayaCode || 0),
      t: Date.now(),
    });
    if (arr.length > TASTE_VIEWS_CAP)
      arr = arr.slice(arr.length - TASTE_VIEWS_CAP);
    st.s.setItem(st.k, JSON.stringify(arr));
  } catch {
    /* taste must never break the listing page */
  }
}

// Called on every successful favorite toggle — a new favorite IS new
// behavior, even before the favorites snapshot refreshes.
export function tasteNoteFav(listingId: string): void {
  try {
    const st = feedStateStore();
    if (!st) return;
    const cur = feedStateRead();
    cur.favN = (cur.favN || 0) + 1;
    cur.favT = Date.now();
    const ids = Array.isArray(cur.favIds) ? cur.favIds : [];
    if (listingId) ids.unshift(String(listingId));
    cur.favIds = ids.slice(0, TASTE_FAVIDS_CAP);
    st.s.setItem(st.k, JSON.stringify(cur));
  } catch {
    /* never break the favorite toggle */
  }
}

// Favorites from the local snapshot — the projection carries
// categoryId/price/wilayaCode. The id lets the picker exclude ads the user
// already favorited ("similar, not the same").
// Key/envelope format mirrors js/snapshot.js: dlala_snap_<page>_<uid>,
// {v:1, ts, data}, 10-minute TTL.
function tasteReadFavs(): FavSignal[] {
  try {
    const uid = tasteUid();
    if (!uid || !hasLocalStorage()) return [];
    let raw: string | null = null;
    try {
      raw = localStorage.getItem('dlala_snap_favorites_' + uid);
    } catch {
      return [];
    }
    if (!raw) return [];
    let s: {
      v?: number;
      ts?: number;
      data?: { cards?: { live?: Record<string, unknown>; fav?: Record<string, unknown> }[] };
    } | null = null;
    try {
      s = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!s || s.v !== 1 || !s.data || Date.now() - (s.ts || 0) > 10 * 60 * 1000)
      return [];
    const cards = s.data.cards;
    if (!Array.isArray(cards)) return [];
    return cards
      .map((c) => {
        const live = (c && c.live) || {};
        const fav = (c && c.fav) || {};
        return {
          c: String(live.categoryId || ''),
          p: Number(live.price || 0),
          w: Number(live.wilayaCode || 0),
          id: String(live.id || fav.listingId || ''),
        };
      })
      .filter((f) => f.c);
  } catch {
    return [];
  }
}

// The taste profile: per-category affinity weights, per-category habitual
// price (median), per-wilaya weights, and the total signal count.
function tasteProfile(): TasteProfile {
  const cats: Record<string, number> = {};
  const wilayas: Record<string, number> = {};
  const prices: Record<string, number[]> = {};
  let n = 0;
  const add = (c: string, p: number, w: number, wt: number) => {
    if (!c) return;
    cats[c] = (cats[c] || 0) + wt;
    if (w) wilayas[String(w)] = (wilayas[String(w)] || 0) + wt;
    if (p > 0) {
      (prices[c] = prices[c] || []).push(p);
    }
    n += wt;
  };
  tasteReadFavs().forEach((f) => add(f.c, f.p, f.w, TASTE_FAV_WEIGHT));
  tasteReadViews().forEach((v) => add(v.c, v.p, v.w, TASTE_VIEW_WEIGHT));
  const priceMed: Record<string, number> = {};
  for (const c in prices) {
    const arr = prices[c].slice().sort((a, b) => a - b);
    priceMed[c] = arr[Math.floor(arr.length / 2)];
  }
  return { cats, wilayas, priceMed, n };
}

// 0..1 — how much a listing matches the profile. Conservative: no category
// affinity, no score at all.
function tasteScore(d: TasteDoc, profile: TasteProfile): number {
  if (!d || !profile || !profile.n) return 0;
  const c = String(d.categoryId || d.category || '');
  const cw = profile.cats[c] || 0;
  if (!cw) return 0;
  let topW = 0;
  for (const k in profile.cats) if (profile.cats[k] > topW) topW = profile.cats[k];
  if (!topW) return 0;
  let s = 0.6 * (cw / topW);
  const med = profile.priceMed[c];
  const p = Number(d.price || 0);
  if (med && p > 0) {
    const ratio = Math.min(p, med) / Math.max(p, med);
    if (ratio >= 0.5) s += 0.25 * ratio; // within 2x of the habitual price
  }
  const w = String(d.wilayaCode || '');
  if (w && profile.wilayas[w]) s += 0.15;
  return Math.min(1, s);
}

// Ids that must never be recommended back: the ads the signals came from
// (viewed + favorited). "Similar, not the same."
function tasteSignalIds(): Set<string> {
  const ids = new Set<string>();
  try {
    for (const v of tasteReadViews()) if (v.i) ids.add(String(v.i));
    for (const f of tasteReadFavs()) if (f.id) ids.add(f.id);
    const st = feedStateRead();
    for (const id of st.favIds || []) ids.add(String(id));
  } catch {
    /* ignore */
  }
  return ids;
}

// Fingerprint of "has the user done anything new". Views are immediate;
// favorites arrive via tasteNoteFav() (the snapshot refreshes later).
function tasteSignalStamp(): string {
  try {
    const views = tasteReadViews();
    const favs = tasteReadFavs();
    const st = feedStateRead();
    return [
      views.length,
      views.length ? views[views.length - 1].t : 0,
      favs.length,
      st.favN || 0,
      st.favT || 0,
    ].join(':');
  } catch {
    return '0:0:0:0:0';
  }
}

// The taste quarter: top similar ads (never the signal ads themselves),
// strongest first. Weak matches (< TASTE_MIN_SCORE) are left out — their
// slots go to exploration instead of forcing bad recommendations.
// Generic: the pipeline is order-only, so the input doc type is preserved.
function tastePicks<T extends TasteDoc>(
  regular: T[],
  profile: TasteProfile,
  excludeIds: Set<string>,
  quota: number
): T[] {
  if (!Array.isArray(regular) || !profile || !profile.n || !(quota > 0))
    return [];
  const scored: { d: T; s: number }[] = [];
  for (const d of regular) {
    if (!d) continue;
    const id = tasteId(d);
    if (!id || (excludeIds && excludeIds.has(id))) continue;
    const s = tasteScore(d, profile);
    if (s >= TASTE_MIN_SCORE) scored.push({ d, s });
  }
  scored.sort(
    (a, b) =>
      b.s - a.s || tasteMs(b.d.createdAt) - tasteMs(a.d.createdAt)
  );
  return scored.slice(0, quota).map((x) => x.d);
}

// Deterministic rotation (not a shuffle): same input + same rot = same
// output. Every refresh starts at a different point, order otherwise kept.
function tasteRotate<T>(arr: T[], offset: number): T[] {
  const n = arr.length;
  if (n < 2) return arr.slice();
  const k = ((offset % n) + n) % n;
  return arr.slice(k).concat(arr.slice(0, k));
}

// The exploration 75%: genuinely fresh ads (<1h) lead by recency, then
// unseen-before-seen, each group rotated per refresh. No pure shuffle —
// the order stays legible, just never identical.
function exploreOrder<T extends TasteDoc>(
  regular: T[],
  seenSet: Set<string>,
  rot: number,
  nowMs?: number
): T[] {
  const now = nowMs || Date.now();
  const fresh: T[] = [];
  const unseen: T[] = [];
  const seen: T[] = [];
  const byNew = (a: T, b: T) =>
    tasteMs(b && b.createdAt) - tasteMs(a && a.createdAt);
  for (const d of regular) {
    if (!d) continue;
    const age = now - tasteMs(d.createdAt);
    if (age >= 0 && age < TASTE_FRESH_MS) {
      fresh.push(d);
      continue;
    }
    (seenSet && seenSet.has(tasteId(d)) ? seen : unseen).push(d);
  }
  fresh.sort(byNew);
  unseen.sort(byNew);
  seen.sort(byNew);
  return fresh.concat(tasteRotate(unseen, rot), tasteRotate(seen, rot * 2 + 1));
}

// Blend: every 4th slot (index 3, 7, 11, …) is a taste pick — exactly 25%.
// Picks already exclude signal ads; belt-and-braces: never show a doc twice.
function interleaveTasteExplore<T extends TasteDoc>(
  explore: T[],
  picks: T[]
): T[] {
  const ex = Array.isArray(explore) ? explore.slice() : [];
  if (!picks || !picks.length) return ex;
  const pickIds = new Set(picks.map(tasteId));
  const rest = ex.filter((d) => !pickIds.has(tasteId(d)));
  const out: T[] = [];
  let pi = 0,
    ei = 0,
    i = 0;
  while (ei < rest.length || pi < picks.length) {
    if (i % 4 === 3 && pi < picks.length) out.push(picks[pi++]);
    else if (ei < rest.length) out.push(rest[ei++]);
    else out.push(picks[pi++]); // quota math makes this unreachable; safety
    i++;
  }
  return out;
}

// In-memory: the exact doc order of the last full (non-append) build, so
// "show more" extends it instead of reshuffling it.
let tasteFrozenOrder: TasteDoc[] | null = null;
let tasteArrangedIds: Set<string> | null = null;
function tasteFrozenSet(ranked: TasteDoc[]): void {
  tasteFrozenOrder = (ranked || []).slice();
  tasteArrangedIds = new Set(tasteFrozenOrder.map(tasteId));
}

export interface TasteRankOpts {
  // Advance the rotation for the NEXT build (a real refresh).
  bump?: boolean;
  // Extend the frozen arrangement with fresh docs only.
  append?: boolean;
}

// Full pipeline for the default/recent feed. Returns the ranked pool.
// Generic over the doc type: the pipeline only reorders/filters, so every
// returned doc is one of the input docs (same references).
export function tasteRankDefault<T extends TasteDoc>(
  regular: T[],
  opts?: TasteRankOpts
): T[] {
  opts = opts || {};
  const pool = Array.isArray(regular) ? regular : [];
  const nowMs = Date.now();
  if (opts.append && tasteArrangedIds) {
    const st = feedStateRead();
    const stamp = tasteSignalStamp();
    const dismissed = stamp !== st.stamp ? false : !!st.dismissed;
    const fresh = pool.filter((d) => !tasteArrangedIds!.has(tasteId(d)));
    const poolIds = new Set(pool.map(tasteId));
    // The frozen docs are the same T references stored by the previous
    // (non-append) call on this page session.
    const base = (tasteFrozenOrder || []).filter((d) =>
      poolIds.has(tasteId(d))
    ) as T[];
    if (!fresh.length) {
      tasteAfter(base, [], dismissed, stamp);
      return base;
    }
    const profile = tasteProfile();
    const picks = dismissed
      ? []
      : tastePicks(fresh, profile, tasteSignalIds(), Math.floor(fresh.length / 4));
    const rankedFresh = interleaveTasteExplore(
      exploreOrder(fresh, new Set(st.seen || []), st.rot || 0, nowMs),
      picks
    );
    const out = base.slice();
    const outIds = new Set(out.map(tasteId));
    for (const d of rankedFresh) {
      const id = tasteId(d);
      if (id && !outIds.has(id)) {
        out.push(d);
        outIds.add(id);
      }
    }
    tasteFrozenSet(out);
    tasteAfter(out, picks, dismissed, stamp);
    return out;
  }
  const st = feedStateRead();
  const stamp = tasteSignalStamp();
  const newBehavior = stamp !== st.stamp;
  let dismissed = newBehavior ? false : !!st.dismissed;
  const profile = tasteProfile();
  const exclude = tasteSignalIds();
  let picks: T[] = [];
  if (!dismissed && profile.n) {
    picks = tastePicks(pool, profile, exclude, Math.floor(pool.length / 4));
  }
  // "It disappears when you ignore it": the picks were visibly rendered,
  // the user refreshed after a fair look, and nothing new happened since.
  if (
    !dismissed &&
    !newBehavior &&
    picks.length &&
    st.shownAt &&
    nowMs - st.shownAt > TASTE_MIN_SEEN_MS
  ) {
    dismissed = true;
    picks = [];
  }
  const rot = st.rot || 0;
  const ranked = interleaveTasteExplore(
    exploreOrder(pool, new Set(st.seen || []), rot, nowMs),
    picks
  );
  // Persist: rotation advances only on a real refresh (bump) — never on the
  // instant cache paint, the background wanted-merge, or "show more".
  const patch: FeedState = { stamp, dismissed };
  if (picks.length) patch.shownAt = nowMs;
  else patch.shownAt = 0;
  if (opts.bump) patch.rot = rot + 1;
  const seen = Array.isArray(st.seen) ? st.seen.slice() : [];
  const have = new Set(seen);
  for (const d of ranked) {
    const id = tasteId(d);
    if (id && !have.has(id)) {
      have.add(id);
      seen.push(id);
    }
  }
  while (seen.length > FEED_SEEN_CAP) seen.shift();
  patch.seen = seen;
  feedStateWrite(patch);
  tasteFrozenSet(ranked);
  return ranked;
}

// Bookkeeping shared by the append path (no dismissal evaluation there —
// "show more" is not a refresh).
function tasteAfter(
  ranked: TasteDoc[],
  picks: TasteDoc[],
  dismissed: boolean,
  stamp: string
): void {
  try {
    const st = feedStateRead();
    const patch: FeedState = { stamp, dismissed: !!dismissed };
    if (picks && picks.length) patch.shownAt = Date.now();
    const seen = Array.isArray(st.seen) ? st.seen.slice() : [];
    const have = new Set(seen);
    for (const d of ranked || []) {
      const id = tasteId(d);
      if (id && !have.has(id)) {
        have.add(id);
        seen.push(id);
      }
    }
    while (seen.length > FEED_SEEN_CAP) seen.shift();
    patch.seen = seen;
    feedStateWrite(patch);
  } catch {
    /* ignore */
  }
}

// Next.js integration helper (no legacy equivalent — legacy kept this in
// js/app.js attachAuth): maintain the dlala_uid localStorage mirror so the
// taste stores split registered/persistent vs guest/session correctly.
// On sign-out the mirror AND this device's per-user snapshots are dropped
// so the next account never flashes the previous user's private lists
// (mirrors js/app.js dropSnapshotMirror).
export function tasteMirrorUid(uid: string | null): void {
  try {
    if (!hasLocalStorage()) return;
    if (uid) {
      try {
        localStorage.setItem('dlala_uid', uid);
      } catch {
        /* ignore */
      }
      return;
    }
    let prev = '';
    try {
      prev = localStorage.getItem('dlala_uid') || '';
    } catch {
      /* ignore */
    }
    if (prev) {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        let k: string | null = null;
        try {
          k = localStorage.key(i);
        } catch {
          /* ignore */
        }
        if (
          k &&
          k.indexOf('dlala_snap_') === 0 &&
          k.slice(-prev.length - 1) === '_' + prev
        ) {
          try {
            localStorage.removeItem(k);
          } catch {
            /* ignore */
          }
        }
      }
    }
    try {
      localStorage.removeItem('dlala_uid');
    } catch {
      /* ignore */
    }
  } catch {
    /* never break auth on a cache helper */
  }
}
