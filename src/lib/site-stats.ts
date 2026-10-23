// DLALA — siteStats reads (22 Oct 2026, reads-incident root fix).
//
// The scheduled Cloud Function `siteStats` recomputes every aggregate /
// landing-window / sitemap dataset from ONE listings pass (every 12h
// since 23 Oct 2026) and writes ready-made documents into the
// `siteStats` collection. The web fetchers (price-stats, model-pages,
// category-pages, sitemap, the default feed, the listing similar rail)
// read those documents here — a handful of reads instead of re-scanning
// the whole listings collection on every cache regeneration.
//
// Fallback policy (23 Oct 2026 hardening — see the detailed readers and
// claimStatsScan below): the two full-collection scans (getPriceStats,
// fetchAvailableCars) may now run ONLY when their document is genuinely
// MISSING (HTTP 404), and at most once per dataset per process per
// cooldown window. A transient failure (network, 5xx, malformed doc)
// serves the caller's safe empty result instead of a 1,356-doc scan —
// two such scans were observed in a Query Insights window on 23 Oct.
// The bounded fetchers (category windows ≤500, counts, feed pages,
// similar windows) keep their original null → live-query fallback:
// their live paths are small and are the cold-start correctness path.
//
// Doc layout (written by dlala-app/functions/siteStats):
//   priceStats      { computedAt, sourceCount, runId, rows, totalAds }
//   categoryCounts  { computedAt, sourceCount, runId, counts: {cat: n} }
//   <base>          head { computedAt, sourceCount, runId, count, chunks }
//   <base>__<runId>_<i>  { items: [...] }   (chunk docs, runId-versioned)
// Bases: cars, live, all, feed (+ head.truncated), related (items are
// [listingId, cards] pairs; head carries chunkFirstIds), search (every
// live listing as a card-projection entry; head carries boost verdict
// inputs), cat_<categoryId>.

import { FIREBASE_API_KEY, FIRESTORE_REST_BASE } from './firestore';

// Full Firestore REST → native value decoder (same mapping as the one in
// model-pages.ts / category-pages.ts: timestamps become Date objects,
// integers/doubles become numbers — summaries built from stats docs are
// indistinguishable from summaries built by the live scans).
function decodeRestValue(v: unknown): unknown {
  if (v == null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if ('stringValue' in o) return o.stringValue;
  if ('integerValue' in o) return Number(o.integerValue);
  if ('doubleValue' in o) return Number(o.doubleValue);
  if ('booleanValue' in o) return o.booleanValue;
  if ('nullValue' in o) return null;
  if ('timestampValue' in o) return new Date(o.timestampValue as string);
  if ('arrayValue' in o) {
    const av = o.arrayValue as { values?: unknown[] } | undefined;
    return (av?.values ?? []).map(decodeRestValue);
  }
  if ('mapValue' in o) {
    const mv = o.mapValue as { fields?: Record<string, unknown> } | undefined;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(mv?.fields ?? {})) out[k] = decodeRestValue(val);
    return out;
  }
  return null;
}

interface RestDocument {
  fields?: Record<string, unknown>;
}

// Discriminated read result — the fallback policy hinges on WHY a read
// failed, which a bare null cannot express:
//   ok      — document fetched and decoded.
//   missing — HTTP 404: the document genuinely does not exist (the CF
//             has never written it, or the collection is absent).
//   error   — anything else: network failure, non-404 HTTP status, or a
//             malformed payload. Potentially transient; NEVER a licence
//             to run a full-collection scan.
export type StatsRead<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'missing' }
  | { kind: 'error' };

// GET one siteStats doc by id and decode its fields to a plain object,
// classifying the outcome for the fallback policy.
export async function readStatsDocDetailed(
  docId: string
): Promise<StatsRead<Record<string, unknown>>> {
  try {
    const url = `${FIRESTORE_REST_BASE}/siteStats/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return { kind: 'missing' };
    if (!res.ok) return { kind: 'error' };
    const doc = (await res.json().catch(() => null)) as RestDocument | null;
    if (!doc || typeof doc !== 'object' || !doc.fields) return { kind: 'error' };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc.fields)) out[k] = decodeRestValue(v);
    return { kind: 'ok', value: out };
  } catch {
    return { kind: 'error' };
  }
}

// GET one siteStats doc by id and decode its fields to a plain object.
// Returns null on ANY problem (HTTP error, malformed payload) — kept for
// the bounded fetchers whose fallback policy is unchanged (see header).
export async function readStatsDoc(docId: string): Promise<Record<string, unknown> | null> {
  const r = await readStatsDocDetailed(docId);
  return r.kind === 'ok' ? r.value : null;
}

export interface StatsArray {
  items: Record<string, unknown>[];
  computedAt: Date | null;
  sourceCount: number;
  head: Record<string, unknown>;
}

// Read a chunked array via its head doc, classifying failure for the
// fallback policy. Chunks are fetched by the exact runId stored in the
// head (the CF writes chunks first and the head last, so a reader
// following the head never sees a half-written run). A missing HEAD is
// a genuine absence ('missing'); a missing/malformed chunk under a
// committed head, a malformed head shape, or a total item-count
// mismatch against the head's `count` is 'error' (corruption/transient
// — never a scan licence for the hardened callers).
export async function readStatsArrayDetailed(
  base: string
): Promise<StatsRead<StatsArray>> {
  const headR = await readStatsDocDetailed(base);
  if (headR.kind !== 'ok') return headR;
  const head = headR.value;
  const runId = head.runId;
  const chunks = head.chunks;
  const count = head.count;
  if (
    typeof runId !== 'string' || runId === '' ||
    typeof chunks !== 'number' || !Number.isInteger(chunks) || chunks < 0 ||
    typeof count !== 'number' || !Number.isInteger(count) || count < 0
  ) {
    return { kind: 'error' };
  }
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < chunks; i++) {
    const chunkR = await readStatsDocDetailed(`${base}__${runId}_${i}`);
    if (chunkR.kind !== 'ok' || !Array.isArray(chunkR.value.items)) {
      return { kind: 'error' };
    }
    for (const it of chunkR.value.items as unknown[]) {
      if (it == null || typeof it !== 'object' || Array.isArray(it)) {
        return { kind: 'error' };
      }
      items.push(it as Record<string, unknown>);
    }
  }
  if (items.length !== count) return { kind: 'error' };
  return {
    kind: 'ok',
    value: {
      items,
      computedAt: head.computedAt instanceof Date ? head.computedAt : null,
      sourceCount: typeof head.sourceCount === 'number' ? head.sourceCount : 0,
      head,
    },
  };
}

// Null-collapsing wrapper (original behavior) for the bounded fetchers.
export async function readStatsArray(base: string): Promise<StatsArray | null> {
  const r = await readStatsArrayDetailed(base);
  return r.kind === 'ok' ? r.value : null;
}

// ---------------------------------------------------------------------------
// Scan circuit breaker (23 Oct 2026 hardening).
//
// The full-collection scans behind getPriceStats / fetchAvailableCars
// cost ~1,356 reads EACH. They may now run only when the precomputed
// document is genuinely missing (404) — and even then at most once per
// dataset per process instance per cooldown window. Rationale: a
// genuine cold start (CF never deployed / collection wiped) deserves
// exactly one scan to keep the site correct; a persistent absence
// (CF broken) or a fleet of warm instances must not turn that into a
// scan storm — the Next data cache already memoizes the one scan's
// result for the callers' cacheLife('days') window, so repeat in-body
// executions are almost always revalidation races, not new demand.
// The cooldown defaults to 6h (half the CF cadence) so a process that
// outlives the CF's recovery re-arms automatically. Tests may override
// via DLALA_STATS_SCAN_COOLDOWN_MS.
// ---------------------------------------------------------------------------
const scanLastClaim = new Map<string, number>();
const SCAN_COOLDOWN_DEFAULT_MS = 6 * 3600 * 1000;

export function claimStatsScan(dataset: string): boolean {
  const override = Number(process.env.DLALA_STATS_SCAN_COOLDOWN_MS);
  const cooldown =
    Number.isFinite(override) && override >= 0 ? override : SCAN_COOLDOWN_DEFAULT_MS;
  const now = Date.now();
  const last = scanLastClaim.get(dataset) || 0;
  if (now - last < cooldown) return false;
  scanLastClaim.set(dataset, now);
  return true;
}

// Test-only: the parity harness drives the breaker through its phases
// (missing → suppressed → re-armed) within one process.
export function __resetStatsScanBreakerForTests(): void {
  scanLastClaim.clear();
}

// ---------------------------------------------------------------------------
// Feed (23 Oct 2026, reads-reduction 2 — hybrid per Zak's correction).
//
// The CF precomputes the newest 240 live listings (CARD_FIELDS
// projection, feed order) into siteStats/feed. Page 1 of the default
// feed MERGES those items with a small live sliver (firestore.ts owns
// the merge + the sliver query); pages ≥2 are served from the doc
// alone. This module owns the doc side: the whole array for page 1,
// and cursor paging over it for later pages.
// ---------------------------------------------------------------------------

export interface StatsFeedArray {
  items: Record<string, unknown>[];
  truncated: boolean;
  computedAt: Date | null;
}

export async function readStatsFeedArray(): Promise<StatsFeedArray | null> {
  const arr = await readStatsArray('feed');
  if (!arr) return null;
  return {
    items: arr.items,
    truncated: arr.head.truncated === true,
    computedAt: arr.computedAt,
  };
}

export interface FeedCursorLike {
  t: string;
  id: string;
}

export interface StatsFeedPage {
  docs: Record<string, unknown>[];
  nextCursor: FeedCursorLike | null;
}

// Cursor paging over the precomputed feed items (pages ≥2, and the
// doc-only degradation of page 1 when the live sliver is unavailable).
// Semantics mirror the live query exactly: the cursor addresses the
// last returned item; nextCursor is emitted ⟺ a full page was
// returned. Returns null when the request cannot be served from the
// doc alone (cursor not in the window, or the page would straddle the
// window's end while the corpus continues past it) — the caller then
// uses the live cursor query, which continues the same stream.
export function pageStatsFeed(
  feed: StatsFeedArray,
  limit: number,
  cursor: FeedCursorLike | null
): StatsFeedPage | null {
  const items = feed.items;
  let start = 0;
  if (cursor) {
    const idx = items.findIndex(
      (it) => it.id === cursor.id && it.createdAtRaw === cursor.t
    );
    if (idx < 0) return null;
    start = idx + 1;
  }
  const remaining = items.length - start;
  const strip = (it: Record<string, unknown>): Record<string, unknown> => {
    const { createdAtRaw: _raw, ...rest } = it;
    return rest;
  };
  if (remaining >= limit) {
    const docs = items.slice(start, start + limit).map(strip);
    const last = items[start + limit - 1];
    return {
      docs,
      nextCursor: { t: String(last.createdAtRaw), id: String(last.id) },
    };
  }
  if (!feed.truncated) {
    // The doc holds the WHOLE corpus: a short page is the stream's end
    // (or the empty page after an exact-fit final page), as live.
    const docs = items.slice(start).map(strip);
    return { docs, nextCursor: null };
  }
  return null; // straddle past the precomputed window → live path
}

// ---------------------------------------------------------------------------
// Related (23 Oct 2026, reads-reduction 2).
//
// siteStats/related holds [listingId, trimmedCards] pairs sorted by id
// and packed into chunks; the head carries chunkFirstIds (the first
// listing id of each chunk). A lookup reads the head + exactly ONE
// chunk. Returns the listing's precomputed similar cards, an EMPTY
// array when the CF computed an empty rail (distinguishable from
// "not computed"), or null when the listing has no entry / the dataset
// is absent or malformed → the caller falls back to the bounded live
// similar queries.
// ---------------------------------------------------------------------------
export async function readStatsRelated(
  listingId: string
): Promise<Record<string, unknown>[] | null> {
  const headR = await readStatsDocDetailed('related');
  if (headR.kind !== 'ok') return null;
  const head = headR.value;
  const runId = head.runId;
  const chunks = head.chunks;
  const count = head.count;
  const firstIds = head.chunkFirstIds;
  if (
    typeof runId !== 'string' || runId === '' ||
    typeof chunks !== 'number' || !Number.isInteger(chunks) || chunks < 1 ||
    typeof count !== 'number' || !Number.isInteger(count) || count < 0 ||
    !Array.isArray(firstIds) || firstIds.length !== chunks
  ) {
    return null;
  }
  if (count === 0) return null;
  // Binary search: the chunk whose [firstId, nextFirstId) range holds
  // the id (ids compare in code-unit order on both sides).
  let lo = 0;
  let hi = chunks - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const first = firstIds[mid];
    if (typeof first !== 'string') return null;
    if (listingId < first) {
      hi = mid - 1;
    } else {
      idx = mid;
      lo = mid + 1;
    }
  }
  if (idx < 0) return null;
  const chunk = await readStatsDoc(`related__${runId}_${idx}`);
  if (!chunk || !Array.isArray(chunk.items)) return null;
  for (const pair of chunk.items as unknown[]) {
    if (Array.isArray(pair) && pair[0] === listingId && Array.isArray(pair[1])) {
      const cards = pair[1] as unknown[];
      for (const c of cards) {
        if (c == null || typeof c !== 'object' || Array.isArray(c)) return null;
      }
      return cards as Record<string, unknown>[];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Search index (23 Oct 2026, reads-reduction 3).
//
// siteStats/search holds EVERY live listing (status available /
// negotiating) as a CARD_FIELDS-projection entry (+ createdAtRaw), in
// the same chunked layout as the other array datasets. The head also
// carries `boost`: per-seller boost verdict inputs { t: storeTier,
// u: vitrineBoostUntilMs } for the sellers of live listings — only
// sellers WITH at least one input are present; an absent seller is
// not boosted, exactly as a users doc without those fields reads in
// the live pipeline's fetchSellerBoostMap. src/lib/search-pool.ts
// routes the /search pool through these entries (the pipeline itself
// is reproduced in memory in src/lib/firestore.ts); the live pipeline
// remains the fallback for a genuinely missing dataset, governed by
// the claimStatsScan('search') circuit breaker.
// ---------------------------------------------------------------------------

export interface StatsSearchIndex {
  entries: Record<string, unknown>[];
  boost: Record<string, { t?: string; u?: number }>;
  computedAt: Date | null;
}

export async function readStatsSearchIndexDetailed(): Promise<StatsRead<StatsSearchIndex>> {
  const r = await readStatsArrayDetailed('search');
  if (r.kind !== 'ok') return r;
  const raw = r.value.head.boost;
  const boost: Record<string, { t?: string; u?: number }> = {};
  if (raw !== undefined && raw !== null) {
    // A present-but-malformed boost map is corruption, not absence:
    // classify 'error' so the caller serves its safe empty instead of
    // silently partitioning with wrong verdicts.
    if (typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'error' };
    for (const [uid, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v == null || typeof v !== 'object' || Array.isArray(v)) {
        return { kind: 'error' };
      }
      const rec = v as Record<string, unknown>;
      const out: { t?: string; u?: number } = {};
      if (typeof rec.t === 'string') out.t = rec.t;
      if (typeof rec.u === 'number') out.u = rec.u;
      boost[uid] = out;
    }
  }
  return {
    kind: 'ok',
    value: { entries: r.value.items, boost, computedAt: r.value.computedAt },
  };
}
