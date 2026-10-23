// DLALA — siteStats reads (22 Oct 2026, reads-incident root fix).
//
// The scheduled Cloud Function `siteStats` recomputes every aggregate /
// landing-window / sitemap dataset from ONE listings pass every 6h and
// writes ready-made documents into the `siteStats` collection. The web
// fetchers (price-stats, model-pages, category-pages, sitemap) read those
// documents here — a handful of reads instead of re-scanning the whole
// listings collection on every cache regeneration — and fall back to their
// original scan implementations ONLY when a document is missing or
// unparseable (rollout safety: before the function is deployed, and if it
// ever stops, the site keeps working exactly as it did).
//
// Doc layout (written by dlala-app/functions/siteStats):
//   priceStats      { computedAt, sourceCount, runId, rows, totalAds }
//   categoryCounts  { computedAt, sourceCount, runId, counts: {cat: n} }
//   <base>          head { computedAt, sourceCount, runId, count, chunks }
//   <base>__<runId>_<i>  { items: [...] }   (chunk docs, runId-versioned)
// Bases: cars, live, all, cat_<categoryId>.

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

// GET one siteStats doc by id and decode its fields to a plain object.
// Returns null on ANY problem (HTTP error, malformed payload) — callers
// treat null as "fall back to the scan path".
export async function readStatsDoc(docId: string): Promise<Record<string, unknown> | null> {
  try {
    const url = `${FIRESTORE_REST_BASE}/siteStats/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const doc = (await res.json()) as RestDocument;
    if (!doc || typeof doc !== 'object' || !doc.fields) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc.fields)) out[k] = decodeRestValue(v);
    return out;
  } catch {
    return null;
  }
}

export interface StatsArray {
  items: Record<string, unknown>[];
  computedAt: Date | null;
  sourceCount: number;
}

// Read a chunked array via its head doc. Chunks are fetched by the exact
// runId stored in the head (the CF writes chunks first and the head last,
// so a reader following the head never sees a half-written run). Any
// missing/malformed chunk, or a total item-count mismatch against the
// head's `count`, yields null → the caller falls back to its scan.
export async function readStatsArray(base: string): Promise<StatsArray | null> {
  const head = await readStatsDoc(base);
  if (!head) return null;
  const runId = head.runId;
  const chunks = head.chunks;
  const count = head.count;
  if (
    typeof runId !== 'string' || runId === '' ||
    typeof chunks !== 'number' || !Number.isInteger(chunks) || chunks < 0 ||
    typeof count !== 'number' || !Number.isInteger(count) || count < 0
  ) {
    return null;
  }
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < chunks; i++) {
    const chunk = await readStatsDoc(`${base}__${runId}_${i}`);
    if (!chunk || !Array.isArray(chunk.items)) return null;
    for (const it of chunk.items as unknown[]) {
      if (it == null || typeof it !== 'object' || Array.isArray(it)) return null;
      items.push(it as Record<string, unknown>);
    }
  }
  if (items.length !== count) return null;
  return {
    items,
    computedAt: head.computedAt instanceof Date ? head.computedAt : null,
    sourceCount: typeof head.sourceCount === 'number' ? head.sourceCount : 0,
  };
}
