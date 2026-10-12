// Vitrine showcase selection — ported from ~/workspace/dlala-040/js/home.js
// (insertVitrineCards, selectVitrineShowcases, recordVitrineShown).
//
// R17 no-repeat model (Zak):
//   - Per-viewer persisted state (localStorage): dlala_vitrine_no_repeat
//   - 2-day exclusion: a showcase shown within 2 days is excluded
//   - Max 3 cards/load: after card 2, then every 8 (VITRINE_EVERY)
//   - Boosted/pro prioritized: boosted showcases first, then the rest
//   - 2 chances: a showcase gets 2 chances; after 2 shows with no tap, it's dead
//   - Any tap counts as interaction (exempts from the 2-chance rule)

import type { ListingCard } from './firestore';

export const VITRINE_EVERY = 8;
export const VITRINE_MAX = 3;
export const VITRINE_MIN_LISTINGS = 3;
export const VITRINE_NO_REPEAT_MS = 2 * 24 * 3600 * 1000;
export const VITRINE_MAX_CHANCES = 2;
export const VITRINE_NR_KEY = 'dlala_vitrine_no_repeat';
export const VITRINE_ROT_KEY = 'dlala_vitrine_rot';

export interface VitrineSeller {
  id: string;
  name?: string;
  storeName?: string;
  storeTier?: string;
  verified?: boolean;
  emailVerified?: boolean;
  rating?: number;
  ratingCount?: number;
  followerCount?: number;
  vitrineIds?: string[];
  vitrineBoostUntil?: unknown;
}

export interface VitrineShowcase {
  seller: VitrineSeller;
  products: ListingCard[];
  boosted: boolean;
  isPro: boolean;
}

interface NoRepeatRecord {
  chances?: number;
  lastShownAt?: number;
  lastSig?: string;
  interacted?: boolean;
}

type NoRepeatState = Record<string, NoRepeatRecord>;

// Content signature — changes reset the no-repeat counter (legacy parity).
export function vitrineContentSig(v: VitrineShowcase): string {
  const pids = v.products.map((p) => String(p.id)).join(',');
  let newest = 0;
  for (const p of v.products) {
    const ms = dateToMs(p.createdAt);
    if (ms > newest) newest = ms;
  }
  return ((v.seller && v.seller.vitrineIds) || []).join(',') + '|' + pids + '|' + newest;
}

function dateToMs(t: unknown): number {
  if (t == null) return 0;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  try {
    const d = t as { toMillis?: () => number; toDate?: () => Date };
    if (typeof d.toMillis === 'function') return d.toMillis();
    if (typeof d.toDate === 'function') return d.toDate().getTime();
  } catch {
    /* fall through */
  }
  const n = Date.parse(String(t));
  return isNaN(n) ? 0 : n;
}

// Client-only: localStorage. Guards for SSR (returns {} on server).
// 11 Oct 2026: per-uid keys — was cross-user leakage on shared devices.
export function vitrineNoRepeatLoad(uid?: string): NoRepeatState {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return {};
  try {
    const key = uid ? `${VITRINE_NR_KEY}_${uid}` : VITRINE_NR_KEY;
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch {
    return {};
  }
}

export function vitrineNoRepeatSave(st: NoRepeatState, uid?: string): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const key = uid ? `${VITRINE_NR_KEY}_${uid}` : VITRINE_NR_KEY;
    localStorage.setItem(key, JSON.stringify(st));
  } catch {
    /* storage full or unavailable: non-fatal */
  }
}

// Is this seller's vitrine currently boosted?
export function vitrineSellerBoosted(seller: VitrineSeller | undefined, nowMs: number): boolean {
  if (!seller) return false;
  if (seller.storeTier === 'verified') return true; // pro: unlimited
  const ms = dateToMs(seller.vitrineBoostUntil);
  return !!(ms && ms > nowMs);
}

// Is this seller eligible for vitrine discovery?
export function vitrineDiscoveryEligible(u: VitrineSeller | undefined, nowMs: number): boolean {
  if (!u) return false;
  const now = nowMs || Date.now();
  if (u.storeTier === 'verified') return true; // pro: unlimited
  const ms = dateToMs(u.vitrineBoostUntil);
  const picks = Array.isArray(u.vitrineIds) ? u.vitrineIds : [];
  return !!(ms && ms > now && picks.length > 0);
}

// Partition candidates: boosted/pro first (legacy vitrinePartitionCandidates).
export function vitrinePartitionCandidates(
  ranked: string[],
  usersById: Record<string, VitrineSeller>,
  nowMs: number,
  budget = 8
): string[] {
  const boosted: string[] = [];
  const rest: string[] = [];
  for (const sid of ranked) {
    (vitrineSellerBoosted(usersById[sid], nowMs) ? boosted : rest).push(sid);
  }
  return boosted.concat(rest).slice(0, budget);
}

// Pure selection — ported from selectVitrineShowcases (js/home.js).
// listings: feed listing objects; usersById: {uid: userDoc}.
export function selectVitrineShowcases(o: {
  listings: ListingCard[];
  usersById: Record<string, VitrineSeller>;
  maxShowcases?: number;
  nowMs?: number;
  rotation?: number;
  noRepeat?: NoRepeatState;
}): { shown: VitrineShowcase[]; fallback: VitrineShowcase[] } {
  const listings = o.listings || [];
  const usersById = o.usersById || {};
  const maxShowcases = o.maxShowcases || VITRINE_MAX;
  const nowMs = o.nowMs || Date.now();
  const rotation = o.rotation || 0;
  const noRepeat = o.noRepeat || {};

  const bySeller: Record<string, ListingCard[]> = {};
  const byId: Record<string, ListingCard> = {};
  for (const l of listings) {
    if (!l || l.isWanted) continue;
    if (l.status !== 'available' && l.status !== 'negotiating') continue;
    const sid = String(l.sellerId || '');
    if (!sid) continue;
    byId[String(l.id)] = l;
    (bySeller[sid] = bySeller[sid] || []).push(l);
  }

  const all: VitrineShowcase[] = [];
  const sellerIds = Object.keys(bySeller).sort((a, b) => bySeller[b].length - bySeller[a].length);

  for (const sid of sellerIds) {
    const seller = usersById[sid];
    if (!seller) continue;
    const isPro = seller.storeTier === 'verified';
    const picks = Array.isArray(seller.vitrineIds) ? seller.vitrineIds : [];
    // Ordinary sellers must have picks; pro stores fall back to latest products.
    if (!picks.length && !isPro) continue;
    const own = bySeller[sid];
    if (!(seller.verified === true || seller.emailVerified === true) && own.length < VITRINE_MIN_LISTINGS)
      continue;

    const products: ListingCard[] = [];
    const seenP = new Set<string>();
    for (const pid of picks) {
      const l = byId[String(pid)];
      if (l && String(l.sellerId) === sid && !seenP.has(String(l.id))) {
        products.push(l);
        seenP.add(String(l.id));
      }
      if (products.length >= 8) break;
    }
    // Top-up from seller's latest products (recency order, stable).
    if (products.length < 8) {
      const byNewest = own.slice().sort(
        (a, b) =>
          dateToMs(b.createdAt) - dateToMs(a.createdAt) ||
          (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)
      );
      for (const l of byNewest) {
        if (products.length >= 8) break;
        const lid = String(l.id);
        if (!seenP.has(lid)) {
          products.push(l);
          seenP.add(lid);
        }
      }
    }
    if (!products.length) continue;
    const boosted = vitrineSellerBoosted(seller, nowMs);
    all.push({ seller: { ...seller, id: sid }, products, boosted, isPro });
  }

  const withinWindow = (rec: NoRepeatRecord | undefined) =>
    !!(rec && rec.lastShownAt && nowMs < rec.lastShownAt + VITRINE_NO_REPEAT_MS);

  const eligible: VitrineShowcase[] = [];
  const excludedTemp: VitrineShowcase[] = [];
  for (const sh of all) {
    const rec = noRepeat[sh.seller.id];
    const sig = vitrineContentSig(sh);
    if (!rec || !rec.lastShownAt || (rec.lastSig && rec.lastSig !== sig)) {
      eligible.push(sh);
      continue;
    }
    if (withinWindow(rec)) {
      excludedTemp.push(sh);
      continue;
    }
    if ((rec.chances || 0) >= VITRINE_MAX_CHANCES && !rec.interacted) continue; // dead
    eligible.push(sh);
  }

  const rot = (items: VitrineShowcase[]) => {
    if (items.length <= 1) return items;
    const off = ((rotation % items.length) + items.length) % items.length;
    return items.slice(off).concat(items.slice(0, off));
  };

  const shown = rot(eligible.filter((s) => s.boosted))
    .concat(rot(eligible.filter((s) => !s.boosted)))
    .slice(0, maxShowcases);

  // Tiny pool: temporarily-excluded sellers come back rather than showing nothing.
  const fallback =
    shown.length < maxShowcases && excludedTemp.length
      ? rot(excludedTemp).slice(0, maxShowcases - shown.length)
      : [];

  return { shown, fallback };
}

// Record shown showcases in the no-repeat state (legacy recordVitrineShown).
// 12 Oct 2026: uid parameter for per-user isolation (was global key only).
export function recordVitrineShown(
  showcases: VitrineShowcase[],
  fallbackShown: VitrineShowcase[],
  noRepeat: NoRepeatState,
  uid?: string
): NoRepeatState {
  const nowMs = Date.now();
  const next: NoRepeatState = { ...noRepeat };
  for (const s of showcases) {
    const id = s.seller.id;
    const sig = vitrineContentSig(s);
    const prev = next[id] || {};
    const fresh = !prev.lastSig || prev.lastSig !== sig;
    next[id] = {
      chances: fresh ? 1 : Math.min(VITRINE_MAX_CHANCES, (prev.chances || 0) + 1),
      lastShownAt: nowMs,
      lastSig: sig,
      interacted: fresh ? false : !!prev.interacted,
    };
  }
  for (const s of fallbackShown) {
    const id = s.seller.id;
    const prev = next[id] || {};
    next[id] = { ...prev, lastShownAt: nowMs, lastSig: vitrineContentSig(s) };
  }
  vitrineNoRepeatSave(next, uid);
  return next;
}

// Mark a showcase as interacted (any tap inside the card).
// 12 Oct 2026: uid parameter for per-user isolation (was global key only).
export function markVitrineInteracted(sellerId: string, uid?: string): void {
  if (typeof window === 'undefined') return;
  const nr = vitrineNoRepeatLoad(uid);
  if (nr[sellerId] && !nr[sellerId].interacted) {
    nr[sellerId] = { ...nr[sellerId], interacted: true };
    vitrineNoRepeatSave(nr, uid);
  }
}

// Slot positions: after card 2, then every 8. Max VITRINE_MAX cards.
// Returns the indices (0-based) in the card array after which to insert.
export function vitrineSlotIndices(cardCount: number, showcaseCount: number): number[] {
  if (cardCount < 2 || showcaseCount === 0) return [];
  const slots: number[] = [2];
  for (let k = VITRINE_EVERY; k <= cardCount; k += VITRINE_EVERY) {
    if (k !== 2) slots.push(k);
  }
  return slots.slice(0, Math.min(showcaseCount, VITRINE_MAX));
}
