// Card trust/ownership markers — js/app.js markOwnCards (HOM-4) + markProCards
// (16 Sep 2026) parity.
//
// Legacy paints the feed BEFORE auth resolves, then patches two markers onto
// the painted cards:
//   1. "yours" badge (✓ إعلانك, .badge.badge-own) on cards whose data-sid ==
//      the viewer's uid — markOwnCards(), idempotent, no-op for guests.
//   2. gold "pro" badge (★ تاجر محترف, .pro-badge) appended inside .card-title
//      for cards whose seller is a verified pro merchant — markProCards().
//      Verdicts are seeded by prefetchFeedSellers' ONE :batchGet (feedUserCache
//      → proSellerCache); the deferred tail falls back to batched `in`
//      queries, chunked at 10 (Firestore `in` limit), best-effort.
//
// The port renders cards declaratively (React), so the markers are React
// state with the same visual end-state:
//   - the own badge renders once auth resolves (no DOM patching),
//   - pro verdicts resolve through the module cache below + ONE batched REST
//     :batchGet on users_public (guest-safe public read, same as
//     fetchVerifiedStores) with mask=storeTier — no Firestore SDK download,
//     preserving the 0.0.0.1w R1 win (no 101KB SDK on every home visit).
// Never throws: failures fail closed (no badges), exactly like legacy.

import { FIREBASE_API_KEY, FIRESTORE_RESOURCE_BASE, FIRESTORE_REST_BASE } from './firestore';

// js/app.js — proSellerCache parity: uid -> isVerifiedPro. Session-scoped.
export const proVerdictCache = new Map<string, boolean>();

// Legacy `in`-query chunking was 10; :batchGet has no such limit, but we
// keep chunks modest.
export const PRO_VERDICT_CHUNK = 50;

type Listener = () => void;
const listeners = new Set<Listener>();
function notifyProVerdicts(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore — one bad listener must not break the others
    }
  });
}

export function subscribeProVerdicts(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getProVerdict(uid: string): boolean | undefined {
  if (!uid) return undefined;
  return proVerdictCache.get(uid);
}

// Pure: unique seller ids that still have no verdict (legacy: `unknown`).
export function uniqueUnknownSids(
  sids: (string | undefined | null)[],
  cache: Map<string, boolean>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of sids) {
    const sid = String(raw || '');
    if (!sid || seen.has(sid) || cache.has(sid)) continue;
    seen.add(sid);
    out.push(sid);
  }
  return out;
}

// Pure: verdict from one :batchGet row (legacy: storeTier === 'verified').
export function verdictFromBatchRow(row: unknown): boolean {
  try {
    const found = (row as Record<string, unknown> | null)?.found as
      | Record<string, unknown>
      | undefined;
    const fields = (found?.fields || {}) as Record<string, unknown>;
    const tier = fields.storeTier as Record<string, unknown> | undefined;
    const v =
      tier && typeof tier === 'object' && 'stringValue' in tier
        ? tier.stringValue
        : tier;
    return v === 'verified';
  } catch {
    return false;
  }
}

// Pure: chunk a list (legacy chunked `in` queries at 10).
export function chunkSids(sids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < sids.length; i += size) out.push(sids.slice(i, i + size));
  return out;
}

let pendingSids = new Set<string>();
let flushScheduled = false;
let inFlight: Promise<void> | null = null;

// One microtask-debounced flush per tick: every card mounted in the same
// tick shares a single :batchGet (legacy: one prefetch per feed paint).
function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const run = () => {
    flushScheduled = false;
    if (inFlight) return; // the in-flight flush's finally() re-triggers us
    inFlight = flushProVerdicts().finally(() => {
      inFlight = null;
      if (pendingSids.size) scheduleFlush();
    });
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(run);
  else setTimeout(run, 0);
}

async function flushProVerdicts(): Promise<void> {
  const sids = uniqueUnknownSids([...pendingSids], proVerdictCache);
  pendingSids = new Set();
  if (!sids.length) return;
  const url =
    FIRESTORE_REST_BASE + ':batchGet?key=' + encodeURIComponent(FIREBASE_API_KEY);
  try {
    for (const chunk of chunkSids(sids, PRO_VERDICT_CHUNK)) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: chunk.map(
            (id) =>
              `${FIRESTORE_RESOURCE_BASE}/users_public/${encodeURIComponent(id)}`,
          ),
          mask: { fieldPaths: ['storeTier'] },
        }),
        cache: 'no-store',
      });
      if (!res.ok) {
        // Fail closed like legacy's best-effort catch — but do NOT cache the
        // failure, so a later paint retries (0.0.0.1n semantics).
        continue;
      }
      const body = (await res.json().catch(() => null)) as unknown;
      const rows = Array.isArray(body) ? body : [];
      const seen = new Set<string>();
      for (const row of rows) {
        const found = (row as Record<string, unknown> | null)?.found as
          | Record<string, unknown>
          | undefined;
        const name = String(found?.name || '');
        const uid = name.split('/').pop() || '';
        if (!uid) continue;
        seen.add(uid);
        proVerdictCache.set(uid, verdictFromBatchRow(row));
      }
      // Cache misses (deleted users) as non-pro — legacy parity.
      for (const uid of chunk) {
        if (!seen.has(uid) && !proVerdictCache.has(uid)) {
          proVerdictCache.set(uid, false);
        }
      }
    }
  } catch {
    // best-effort: fail closed, no badges
  } finally {
    notifyProVerdicts();
  }
}

// Queue verdict fetches for these seller ids; one microtask-debounced flush
// batches every card mounted in the same tick into a single :batchGet.
export function ensureProVerdicts(sids: (string | undefined | null)[]): void {
  let added = false;
  for (const raw of sids) {
    const sid = String(raw || '');
    if (sid && !proVerdictCache.has(sid) && !pendingSids.has(sid)) {
      pendingSids.add(sid);
      added = true;
    }
  }
  if (added) scheduleFlush();
}

// Test seam: reset module state between tests.
export function __resetCardMarkersForTest(): void {
  proVerdictCache.clear();
  pendingSids = new Set();
  flushScheduled = false;
  inFlight = null;
  listeners.clear();
}
