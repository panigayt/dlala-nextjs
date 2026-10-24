// Server-side Firestore REST client — exact replica of the production
// vanilla-JS logic (js/app.js + js/home.js). Zero behavior drift by design.
//
// Every constant below is copied verbatim from the source of truth:
//   ~/workspace/dlala-040/js/config.js  (FIREBASE_CONFIG)
//   ~/workspace/dlala-040/js/app.js     (FIRESTORE_REST_BASE, CARD_REST_FIELDS,
//                                        restValue, restDocToObj, cardSelectClause)
//   ~/workspace/dlala-040/js/home.js    (buildFeedRestQuery default branch)

import type { Lang } from './i18n';
import {
  pageStatsFeed,
  readStatsFeedArray,
  readStatsRelated,
} from './site-stats';

// Round 16 T6: env-first (deploy source of truth). Fallback = production
// key from dlala-040/js/config.js (0.0.0.39). Keep in sync with src/proxy-404.ts.
export const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCcW4X5IvCTi5ujyaBzQl7aJVeYd-A5mcg';
export const FIRESTORE_REST_BASE =
  'https://firestore.googleapis.com/v1/projects/dlala-85cea/databases/(default)/documents';

// Round 11 Team 8 (12 Oct 2026): Firestore :batchGet `documents` entries must
// be RESOURCE NAMES ("projects/{p}/databases/{db}/documents/{coll}/{id}"),
// NOT full REST URLs. The API rejects full URLs with 400 INVALID_ARGUMENT
// ("Document name ... lacks 'projects' at index 0") — this 400 fired on
// every home-page load via card-markers' pro-verdict batchGet (and silently
// broke the two server-side batchGets the same way).
export const FIRESTORE_RESOURCE_BASE = FIRESTORE_REST_BASE.replace(
  /^https:\/\/firestore\.googleapis\.com\/v1\//,
  ''
);

// js/app.js — CARD_REST_FIELDS (verbatim, same order)
const CARD_REST_FIELDS = [
  'title', 'description', 'price', 'previousPrice',
  'priceReduced', 'photoUrls', 'thumbUrls', 'photo_thumbs', 'categoryId', 'wilayaCode',
  'createdAt', 'updatedAt', 'status', 'isWanted', 'isWholesale', 'sellerId', 'favoriteCount',
  'answers', 'condition', 'negotiable', 'views', 'photoVariants',
];

// js/app.js — restValue (verbatim logic, typed)
type RestValue = unknown;

function restValue(v: RestValue): unknown {
  if (v == null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if ('stringValue' in o) return o.stringValue;
  if ('integerValue' in o) return Number(o.integerValue);
  if ('doubleValue' in o) return Number(o.doubleValue);
  if ('booleanValue' in o) return !!o.booleanValue;
  if ('nullValue' in o) return null;
  if ('timestampValue' in o) return new Date(o.timestampValue as string);
  if ('arrayValue' in o) {
    const av = o.arrayValue as { values?: unknown[] };
    return (av.values || []).map(restValue);
  }
  if ('mapValue' in o) {
    const out: Record<string, unknown> = {};
    const fs = (o.mapValue as { fields?: Record<string, unknown> }).fields || {};
    for (const k in fs) out[k] = restValue(fs[k]);
    return out;
  }
  return null;
}

export interface ListingCard {
  id: string;
  title: Record<string, string>;
  description?: Record<string, string>;
  price: number;
  previousPrice?: number;
  priceReduced?: boolean;
  photoUrls?: string[];
  thumbUrls?: string[];
  photo_thumbs?: (string | null)[];
  categoryId?: string;
  wilayaCode?: number;
  createdAt?: Date;
  updatedAt?: Date;
  status?: string;
  isWanted?: boolean;
  isWholesale?: boolean;
  sellerId?: string;
  favoriteCount?: number;
  answers?: Record<string, unknown>;
  condition?: string;
  negotiable?: boolean;
  views?: number;
  photoVariants?: boolean;
  // Round 62: canonical card image (trimFeedCard) — the single URL the card
  // renders. Preferred by renderers; cardImage(l) stays the fallback for
  // paths that still send the photo arrays (/api/feed, /api/search).
  img?: string;
}

function restDocToObj(doc: { name: string; fields?: Record<string, unknown> }): ListingCard {
  const o: Record<string, unknown> = { id: doc.name.split('/').pop() as string };
  const fs = doc.fields || {};
  for (const k in fs) o[k] = restValue(fs[k]);
  return o as unknown as ListingCard;
}

// js/home.js — buildFeedRestQuery, DEFAULT branch only (no filters):
// status IN [available, negotiating], orderBy createdAt DESC, limit 24,
// select card fields. This is the guest home feed — the SSR fast path.
// offset is for the "load more" pagination (Round 39).
function buildDefaultFeedQuery(limit: number, offset = 0) {
  const q: Record<string, unknown> = {
    from: [{ collectionId: 'listings' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'status' },
        op: 'IN',
        value: {
          arrayValue: {
            values: [{ stringValue: 'available' }, { stringValue: 'negotiating' }],
          },
        },
      },
    },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    select: { fields: CARD_REST_FIELDS.map((f) => ({ fieldPath: f })) },
    limit,
  };
  if (offset > 0) q.offset = offset;
  return q;
}

// js/market.js — interleaveWanted (verbatim logic, Round 39):
// Wanted ads rotate fairly through the feed — never pinned at the top.
// After every 4th regular card, insert the next wanted card. The first
// wanted slot opens only after the 4th regular card. Leftover wanted
// cards (when regular runs out) are appended at the end.
export function interleaveWanted<T extends { isWanted?: boolean }>(
  regular: T[],
  wanted: T[]
): T[] {
  if (!wanted.length) return regular;
  const out: T[] = [];
  let wi = 0;
  regular.forEach((r, i) => {
    out.push(r);
    // first wanted slot opens only after the 4th regular card
    if ((i + 1) % 4 === 0 && wi < wanted.length) out.push(wanted[wi++]);
  });
  while (wi < wanted.length) out.push(wanted[wi++]);
  return out;
}

export async function fetchFeed(limit = 24, offset = 0): Promise<ListingCard[]> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: buildDefaultFeedQuery(limit, offset) }),
    // ISR handles caching at the route level; this fetch must always
    // hit the network when the route revalidates.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`feed-rest-${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const rawDocs = (Array.isArray(body) ? body : [])
    .filter((r) => r.document)
    .map((r) => r.document);
  return rawDocs.map(restDocToObj);
}

// --- Cursor pagination (22 Oct 2026, reads-incident root fix) -------------
//
// Firestore bills an OFFSET query for every document it SKIPS, so feed
// page N cost offset+limit reads (measured: 226 executions of
// OFFSET 800/LIMIT 200 = 303,822 reads in 24h — Query Insights). A cursor
// (startAt on the last document's [createdAt, __name__] position) bills
// only the documents RETURNED. Verified empirically 22 Oct 2026 against
// production data: orderBy [createdAt DESC, __name__ DESC] reproduces the
// legacy single-orderBy sequence EXACTLY (250-doc window), and
// startAt{values:[ts, name], before:false} continues it with zero
// duplicates/gaps. The cursor carries the RAW timestampValue string from
// the REST response (full nanosecond precision — a Date round-trip would
// truncate to milliseconds and could strand a document that shares the
// boundary millisecond).
export interface PageCursor {
  t: string; // raw Firestore timestampValue (RFC 3339, full precision)
  id: string; // document id (last path segment)
}

function b64urlEncode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64url');
  }
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(s, 'base64url').toString('utf8');
  }
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b)));
}

// Opaque transport form of a PageCursor (API query param / RSC payload).
export function encodePageCursor(c: PageCursor | null): string | null {
  if (!c) return null;
  return b64urlEncode(JSON.stringify(c));
}

// Strict parse: anything malformed or off-shape returns null — callers
// distinguish "param absent" (legacy/first page) from "param present but
// undecodable" (400) by checking the raw param themselves.
export function decodePageCursor(s: string | null | undefined): PageCursor | null {
  if (!s) return null;
  try {
    const o = JSON.parse(b64urlDecode(s)) as Partial<PageCursor>;
    if (
      o &&
      typeof o.t === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(o.t) &&
      typeof o.id === 'string' &&
      /^[A-Za-z0-9_-]+$/.test(o.id)
    ) {
      return { t: o.t, id: o.id };
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

function cursorStartAt(collectionId: string, cursor: PageCursor) {
  return {
    values: [
      { timestampValue: cursor.t },
      {
        referenceValue:
          FIRESTORE_RESOURCE_BASE + '/' + collectionId + '/' + cursor.id,
      },
    ],
    before: false, // REST form of the SDK's startAfter()
  };
}

// The default feed query with cursor pagination: identical filters and
// projection to buildDefaultFeedQuery; orderBy gains the __name__
// tiebreaker that makes the stream position addressable.
function buildCursorFeedQuery(limit: number, cursor: PageCursor | null) {
  const q: Record<string, unknown> = {
    from: [{ collectionId: 'listings' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'status' },
        op: 'IN',
        value: {
          arrayValue: {
            values: [{ stringValue: 'available' }, { stringValue: 'negotiating' }],
          },
        },
      },
    },
    orderBy: [
      { field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
    ],
    select: { fields: CARD_REST_FIELDS.map((f) => ({ fieldPath: f })) },
    limit,
  };
  if (cursor) q.startAt = cursorStartAt('listings', cursor);
  return q;
}

// --- Hybrid default feed (23 Oct 2026, reads-reduction 2) ---------------
//
// Zak's correction: the default feed must stay INSTANT for new listings.
// The siteStats CF precomputes the newest 240 live listings into
// siteStats/feed every 12h; page 1 merges that doc with a small LIVE
// sliver — every listing at or newer than the doc's newest item
// (createdAt >= watermark), newest-first, LIMIT 24 — so a just-published
// ad leads the homepage on the next 60s cache regeneration, at the cost
// of the handful of documents the sliver actually returns instead of a
// full page scan. Pages ≥2 are served from the doc alone (zero reads);
// the live cursor query remains for cursors the doc cannot resolve
// (a page-1 cursor minted on a sliver item, a listing sold since the
// last run, pages straddling the 240 window) — it continues the SAME
// stream exactly, because sliver/doc cursors carry the raw timestamp
// + id the live query's startAt consumes.
//
// Exactness of the merge: the sliver predicate is >= the watermark
// (the doc's newest item's createdAt), so the sliver contains the
// ENTIRE boundary tie group; every sliver item is ≥ every doc item,
// both segments are internally in feed order, and dedupe by id (sliver
// copy wins) removes the overlap — the concatenation IS the global
// newest-first stream. The sliver runs only inside the callers'
// existing 'use cache' wrappers (60s home/API, days sitemap) — never
// per-request uncached.
const FEED_SLIVER_LIMIT = 24;

interface SliverDoc {
  doc: ListingCard;
  rawTs: string | null;
}

async function fetchFeedSliver(
  watermarkRaw: string | null,
  limit: number
): Promise<SliverDoc[]> {
  const statusFilter = {
    fieldFilter: {
      field: { fieldPath: 'status' },
      op: 'IN',
      value: {
        arrayValue: {
          values: [{ stringValue: 'available' }, { stringValue: 'negotiating' }],
        },
      },
    },
  };
  const where = watermarkRaw
    ? {
        compositeFilter: {
          op: 'AND',
          filters: [
            statusFilter,
            {
              fieldFilter: {
                field: { fieldPath: 'createdAt' },
                op: 'GREATER_THAN_OR_EQUAL',
                value: { timestampValue: watermarkRaw },
              },
            },
          ],
        },
      }
    : statusFilter;
  const structuredQuery = {
    from: [{ collectionId: 'listings' }],
    where,
    orderBy: [
      { field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
    ],
    select: { fields: CARD_REST_FIELDS.map((f) => ({ fieldPath: f })) },
    limit,
  };
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`feed-sliver-rest-${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const rawDocs = (Array.isArray(body) ? body : [])
    .filter((r) => r.document)
    .map((r) => r.document);
  return rawDocs.map((d) => {
    const ts = (d as { fields?: Record<string, { timestampValue?: unknown }> })
      .fields?.createdAt?.timestampValue;
    return { doc: restDocToObj(d), rawTs: typeof ts === 'string' ? ts : null };
  });
}

// R26-3/R27-1 (24 Oct 2026): sold-eviction overlay — the live status
// check that closes the snapshot staleness cluster. Every
// dataset-derived surface (siteStats feed/search/category windows, 12h
// CF cadence, plus 'use cache' windows on top) renders listings whose
// status froze at compute time, so a listing marked sold after the run
// keeps merchandising as available until the next recompute — in
// /api/search (R26-3), on SEO landing pages with their totals (R27-1),
// and in the home feed's dataset segment. The overlay is ONE bounded
// live query — listings with updatedAt >= watermark (mark-sold bumps
// updatedAt via serverTimestamp, my-listings confirmMarkSold) —
// returning only id/status/hidden/categoryId/wilayaCode, capped at 200
// rows; callers evict ids whose live status is sold or hidden. The
// single-field updatedAt range needs NO new composite index (no
// (status, updatedAt) index exists in firestore.indexes.json). Cost is
// bounded by a 15-minute in-process memo keyed by watermark: at most
// one overlay query per 15 min per watermark per instance (typically a
// handful of rows; pathological cap 200 rows × 96 refreshes/day).
// Fail-open by design: overlay failure returns null and callers render
// the snapshot exactly as today; truncation evicts what was returned
// (strictly better than none) and is console.warned. DELETED-since-
// compute docs are NOT covered (a deleted doc is invisible to this
// query) — that staleness class remains, stated here, not implied fixed.
export interface SoldFlip {
  id: string;
  categoryId: string;
  wilayaCode: number;
}

const SOLD_OVERLAY_LIMIT = 200;
const SOLD_OVERLAY_TTL_MS = 15 * 60 * 1000;
const soldOverlayCache = new Map<
  string,
  { at: number; flips: Map<string, SoldFlip> }
>();

export async function fetchSoldFlipsSince(
  watermark: string | null
): Promise<Map<string, SoldFlip> | null> {
  if (!watermark) return new Map();
  const cached = soldOverlayCache.get(watermark);
  if (cached && Date.now() - cached.at < SOLD_OVERLAY_TTL_MS) return cached.flips;
  try {
    const url =
      FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
    const structuredQuery = {
      from: [{ collectionId: 'listings' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'updatedAt' },
          op: 'GREATER_THAN_OR_EQUAL',
          value: { timestampValue: watermark },
        },
      },
      orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }],
      select: {
        fields: ['status', 'hidden', 'categoryId', 'wilayaCode'].map((f) => ({
          fieldPath: f,
        })),
      },
      limit: SOLD_OVERLAY_LIMIT,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`sold-overlay query failed: ${res.status}`);
      return null;
    }
    const body = await res.json().catch(() => null);
    const rows = (Array.isArray(body) ? body : []).filter((r) => r.document);
    if (rows.length >= SOLD_OVERLAY_LIMIT) {
      console.warn(
        'sold-overlay truncated at limit — flips older than the window may be missed'
      );
    }
    const flips = new Map<string, SoldFlip>();
    for (const row of rows) {
      const d = row.document as { name?: string; fields?: Record<string, unknown> };
      const id = String(d.name || '').split('/').pop() || '';
      if (!id) continue;
      const fs = d.fields || {};
      const status = restValue(fs.status);
      const hidden = restValue(fs.hidden) === true;
      if (status !== 'sold' && !hidden) continue;
      flips.set(id, {
        id,
        categoryId: String(restValue(fs.categoryId) || ''),
        wilayaCode: Number(restValue(fs.wilayaCode) || 0),
      });
    }
    soldOverlayCache.set(watermark, { at: Date.now(), flips });
    return flips;
  } catch (e) {
    console.warn('sold-overlay failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// Pure eviction: drop ids the overlay reports sold/hidden. Null flips =
// overlay unavailable → return the input untouched (fail-open).
export function evictSoldIds<T extends { id?: unknown }>(
  docs: T[],
  flips: Map<string, SoldFlip> | null
): T[] {
  if (!flips || flips.size === 0) return docs;
  return docs.filter((d) => !flips.has(String((d as { id?: unknown }).id || '')));
}

// Newest createdAt in a snapshot list as an RFC3339 watermark. Accepts
// decoded Dates (snapshot items) and raw createdAtRaw strings (feed /
// index entries). The input is deliberately unknown[] — snapshot shapes
// differ (ModelListingSummary carries no createdAt field in its type
// even though decoded items do), so fields are read dynamically. The
// newest item's createdAt is <= the dataset's computedAt, so the overlay
// window [watermark, now] always covers [computedAt, now] — every flip
// since compute is in range.
export function newestCreatedAtIso(docs: readonly unknown[]): string | null {
  let bestMs = -1;
  let bestRaw: string | null = null;
  for (const d0 of docs) {
    const d = d0 as { createdAt?: unknown; createdAtRaw?: unknown };
    const raw = d.createdAtRaw;
    if (typeof raw === 'string' && raw) {
      const ms = Date.parse(raw);
      if (Number.isFinite(ms) && ms > bestMs) {
        bestMs = ms;
        bestRaw = raw;
      }
      continue;
    }
    const c = d.createdAt;
    if (c instanceof Date && !isNaN(c.getTime()) && c.getTime() > bestMs) {
      bestMs = c.getTime();
      bestRaw = c.toISOString();
    } else if (typeof c === 'string' && c) {
      const ms = Date.parse(c);
      if (Number.isFinite(ms) && ms > bestMs) {
        bestMs = ms;
        bestRaw = c;
      }
    }
  }
  return bestRaw;
}

// One page of the default feed. Stats-hybrid first (see above); the
// original live cursor implementation (renamed fetchFeedPageLive) is
// the fallback for every position the precomputed doc cannot serve.
export async function fetchFeedPage(
  limit = 24,
  cursor: PageCursor | null = null
): Promise<{ docs: ListingCard[]; nextCursor: PageCursor | null }> {
  if (cursor) {
    // Pages ≥2: precomputed doc only (+ R26-3/R27-1 sold eviction; the
    // cursor still addresses dataset items, so it is kept as-is).
    const feed = await readStatsFeedArray().catch(() => null);
    if (feed) {
      const page = pageStatsFeed(feed, limit, cursor);
      if (page) {
        const flips = await fetchSoldFlipsSince(
          feed.computedAt
            ? feed.computedAt.toISOString()
            : newestCreatedAtIso(
                feed.items as Array<{ createdAtRaw?: unknown }>
              )
        );
        return {
          docs: evictSoldIds(page.docs, flips) as unknown as ListingCard[],
          nextCursor: page.nextCursor,
        };
      }
    }
    return fetchFeedPageLive(limit, cursor);
  }
  // Page 1: precomputed doc + live sliver merge.
  const feed = await readStatsFeedArray().catch(() => null);
  if (feed) {
    const watermark =
      feed.items.length > 0 ? String(feed.items[0].createdAtRaw || '') : null;
    if (watermark !== null && watermark !== '') {
      const sliver = await fetchFeedSliver(
        watermark,
        Math.min(limit, FEED_SLIVER_LIMIT)
      ).catch(() => null);
      if (sliver) {
        const sliverIds = new Set(sliver.map((s) => s.doc.id));
        const rawTsById = new Map(
          sliver.map((s) => [s.doc.id, s.rawTs] as const)
        );
        const rest = feed.items.filter((it) => !sliverIds.has(String(it.id)));
        const merged: ListingCard[] = [
          ...sliver.map((s) => s.doc),
          ...(rest as unknown as ListingCard[]),
        ];
        // R26-3/R27-1: evict sold-since-compute dataset docs BEFORE
        // slicing, so the page stays full whenever the dataset has room.
        const flips = await fetchSoldFlipsSince(
          feed.computedAt ? feed.computedAt.toISOString() : watermark
        );
        const pageDocs = evictSoldIds(merged, flips).slice(0, limit);
        let nextCursor: PageCursor | null = null;
        if (pageDocs.length === limit && pageDocs.length > 0) {
          const last = pageDocs[pageDocs.length - 1];
          const raw = rawTsById.get(last.id);
          if (raw) {
            nextCursor = { t: raw, id: last.id };
          } else {
            const item = feed.items.find((it) => String(it.id) === last.id);
            if (item && typeof item.createdAtRaw === 'string') {
              nextCursor = { t: item.createdAtRaw, id: last.id };
            }
          }
        }
        // Strip the doc-internal cursor field from doc-sourced cards.
        const docs = pageDocs.map((d) => {
          const rec = d as unknown as Record<string, unknown>;
          if (!('createdAtRaw' in rec)) return d;
          const { createdAtRaw: _raw, ...stripped } = rec;
          return stripped as unknown as ListingCard;
        });
        return { docs, nextCursor };
      }
      // Sliver unavailable (transient): degrade to the doc alone, with
      // R26-3/R27-1 sold eviction (the memoized overlay, not a scan).
      const page = pageStatsFeed(feed, limit, null);
      if (page) {
        const flips0 = await fetchSoldFlipsSince(
          feed.computedAt ? feed.computedAt.toISOString() : watermark
        );
        return {
          docs: evictSoldIds(page.docs, flips0) as unknown as ListingCard[],
          nextCursor: page.nextCursor,
        };
      }
    } else if (watermark === null) {
      // Empty precomputed corpus: the sliver IS the whole live head.
      const sliver = await fetchFeedSliver(null, limit).catch(() => null);
      if (sliver) {
        const pageDocs = sliver.slice(0, limit);
        let nextCursor: PageCursor | null = null;
        if (pageDocs.length === limit && pageDocs.length > 0) {
          const last = pageDocs[pageDocs.length - 1];
          if (last.rawTs) nextCursor = { t: last.rawTs, id: last.doc.id };
        }
        return { docs: pageDocs.map((s) => s.doc), nextCursor };
      }
      const page = pageStatsFeed(feed, limit, null);
      if (page) {
        return {
          docs: page.docs as unknown as ListingCard[],
          nextCursor: page.nextCursor,
        };
      }
    }
  }
  return fetchFeedPageLive(limit, cursor);
}

// One page of the default feed via cursor. nextCursor is built from the
// last RAW document of the window (pre-wanted-filter), so the stream
// position is exact even when the window's tail is a wanted doc the API
// layer filters out of the painted cards. nextCursor is null when the
// window came back short (stream exhausted).
async function fetchFeedPageLive(
  limit = 24,
  cursor: PageCursor | null = null
): Promise<{ docs: ListingCard[]; nextCursor: PageCursor | null }> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: buildCursorFeedQuery(limit, cursor) }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`feed-rest-${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const rawDocs = (Array.isArray(body) ? body : [])
    .filter((r) => r.document)
    .map((r) => r.document);
  let nextCursor: PageCursor | null = null;
  if (rawDocs.length === limit && rawDocs.length > 0) {
    const last = rawDocs[rawDocs.length - 1] as {
      name: string;
      fields?: Record<string, { timestampValue?: unknown }>;
    };
    const ts = last.fields?.createdAt?.timestampValue;
    const id = String(last.name.split('/').pop() || '');
    if (typeof ts === 'string' && id) nextCursor = { t: ts, id };
  }
  return { docs: rawDocs.map(restDocToObj), nextCursor };
}

// js/seller.js — loadRatings (verbatim query shape): ratings where
// rateeId == uid, limit 50, client-side createdAt DESC sort, slice 20.
// No server orderBy: avoids the composite-index requirement (legacy parity).
// Only buyer-confirmed-deal ratings are ever written to this collection,
// so no status filter is needed.
export interface SellerRating {
  id: string;
  stars: number; // 0..5 integer, clamped (XSS hardening, 15 Sep 2026)
  raterName: string;
  comment: string;
  createdAt: Date | null;
}

export async function fetchSellerRatings(uid: string): Promise<SellerRating[]> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const structuredQuery = {
    from: [{ collectionId: 'ratings' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'rateeId' },
        op: 'EQUAL',
        value: { stringValue: String(uid) },
      },
    },
    limit: 50,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`seller-ratings-rest-${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const rawDocs = (Array.isArray(body) ? body : [])
    .filter((r) => r.document)
    .map((r) => r.document);
  const toMs = (d: unknown): number =>
    d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0;
  return rawDocs
    .map((doc: { name: string; fields?: Record<string, unknown> }) => {
      const fs = doc.fields || {};
      // XSS hardening (15 Sep 2026): stars must be a 0..5 integer.
      const st5 = Math.min(5, Math.max(0, Math.round(Number(restValue(fs.stars)) || 0)));
      const c = restValue(fs.createdAt);
      return {
        id: String(doc.name.split('/').pop() || ''),
        stars: st5,
        raterName: String(restValue(fs.raterName) || ''),
        comment: String(restValue(fs.comment) || ''),
        createdAt: c instanceof Date ? c : null,
      };
    })
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
    .slice(0, 20);
}

export interface ListingDetail extends ListingCard {
  description?: Record<string, string>;
  quantity?: number;
  views?: number;
}

// js/app.js — fetchUserRest (public profile doc: {name, username, rating,
// verified, createdAt}, plus optional photoUrl/store fields).
export interface SellerProfile {
  id: string;
  name?: string;
  username?: string;
  rating?: number;
  ratingCount?: number;
  verified?: boolean;
  emailVerified?: boolean;
  photoUrl?: string;
  photoPath?: string;
  storeTier?: string;
  storeName?: string;
  storeBio?: string;
  storeCoverUrl?: string;
  storeLogoUrl?: string;
  confirmedDeals?: number;
  followerCount?: number;
  bio?: string;
  createdAt?: Date;
}

export async function fetchSeller(uid: string): Promise<SellerProfile | null> {
  const url =
    FIRESTORE_REST_BASE + '/users/' + encodeURIComponent(uid) +
    '?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status === 403) return null;
    throw new Error(`user-rest-${res.status}`);
  }
  const doc = await res.json().catch(() => null);
  if (!doc || !doc.fields) return null;
  const o: Record<string, unknown> = { id: doc.name.split('/').pop() as string };
  const fs = (doc.fields as Record<string, unknown>) || {};
  for (const k in fs) o[k] = restValue(fs[k]);
  return o as unknown as SellerProfile;
}

// js/home.js — fetchVerifiedStores (0.0.0.1m, Zak): verified-store cards
// atop search results. The users-list rule allows public listing ONLY of
// storeTier=='verified' docs, so this single-field query works for guests
// too; it fails closed ([]) until the rules/mirror carry the field.
// 0.0.0.1n (Zak): a failed fetch no longer poisons the whole session —
// retry at most every 30s. Server-side analog: module cache (5-min TTL)
// + 30s fail-retry suppression.
export interface VerifiedStore {
  uid: string;
  storeName?: string;
  username?: string;
  storeLogoUrl?: string;
  storeWilaya?: number;
  followerCount?: number;
  storeTier?: string;
}

let verifiedStoresCache: VerifiedStore[] | null = null;
let verifiedStoresCacheAt = 0;
let verifiedStoresFailAt = 0;
const VERIFIED_STORES_TTL_MS = 5 * 60 * 1000;
const VERIFIED_STORES_FAIL_RETRY_MS = 30 * 1000;

export async function fetchVerifiedStores(): Promise<VerifiedStore[]> {
  const now = Date.now();
  if (verifiedStoresCache && now - verifiedStoresCacheAt < VERIFIED_STORES_TTL_MS) {
    return verifiedStoresCache;
  }
  if (now - verifiedStoresFailAt < VERIFIED_STORES_FAIL_RETRY_MS) return [];
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const structuredQuery = {
    from: [{ collectionId: 'users' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'storeTier' },
        op: 'EQUAL',
        value: { stringValue: 'verified' },
      },
    },
    select: {
      fields: [
        { fieldPath: 'storeName' },
        { fieldPath: 'username' },
        { fieldPath: 'storeLogoUrl' },
        { fieldPath: 'storeWilaya' },
        { fieldPath: 'followerCount' },
        { fieldPath: 'storeTier' },
      ],
    },
    limit: 50,
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`verified-stores-${res.status}`);
    const body = await res.json().catch(() => null);
    const out: VerifiedStore[] = [];
    for (const r of Array.isArray(body) ? body : []) {
      const d = r?.document;
      if (!d || !d.fields) continue;
      const f = d.fields as Record<string, unknown>;
      out.push({
        uid: String(d.name.split('/').pop() || ''),
        storeName: restValue(f.storeName) as string | undefined,
        username: restValue(f.username) as string | undefined,
        storeLogoUrl: restValue(f.storeLogoUrl) as string | undefined,
        storeWilaya: restValue(f.storeWilaya) as number | undefined,
        followerCount: restValue(f.followerCount) as number | undefined,
        storeTier: restValue(f.storeTier) as string | undefined,
      });
    }
    verifiedStoresCache = out;
    verifiedStoresCacheAt = now;
    return out;
  } catch {
    verifiedStoresFailAt = now;
    return [];
  }
}

// Seller's active listings — same card projection as the feed, plus a
// sellerId == uid filter. Mirrors the seller.html grid query.
// js/seller.js R3 parity: the seller grid loads 30 ads initially; the
// 'عرض المزيد' (Show more) button adds 30 and re-queries the server.
export const SELLER_LISTINGS_PAGE_SIZE = 30;
export async function fetchSellerListings(
  uid: string,
  limit = SELLER_LISTINGS_PAGE_SIZE
): Promise<ListingCard[]> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const structuredQuery = {
    from: [{ collectionId: 'listings' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: 'sellerId' },
              op: 'EQUAL',
              value: { stringValue: uid },
            },
          },
          {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'IN',
              value: {
                arrayValue: {
                  values: [{ stringValue: 'available' }, { stringValue: 'negotiating' }],
                },
              },
            },
          },
        ],
      },
    },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    select: { fields: CARD_REST_FIELDS.map((f) => ({ fieldPath: f })) },
    limit,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`seller-listings-rest-${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const rawDocs = (Array.isArray(body) ? body : [])
    .filter((r) => r.document)
    .map((r) => r.document);
  return rawDocs.map(restDocToObj);
}

// Cursor-paginated seller listings (22 Oct 2026, reads-incident root
// fix): same filters/projection/order as fetchSellerListings plus the
// __name__ tiebreaker, paged by startAt instead of the legacy
// growing-limit re-query (which re-read every previously shown ad on
// each "show more" click: 30 + 60 + 90 + ... reads).
export async function fetchSellerListingsPage(
  uid: string,
  cursor: PageCursor | null = null,
  limit = SELLER_LISTINGS_PAGE_SIZE
): Promise<{ listings: ListingCard[]; nextCursor: PageCursor | null }> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: 'listings' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: 'sellerId' },
              op: 'EQUAL',
              value: { stringValue: uid },
            },
          },
          {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'IN',
              value: {
                arrayValue: {
                  values: [{ stringValue: 'available' }, { stringValue: 'negotiating' }],
                },
              },
            },
          },
        ],
      },
    },
    orderBy: [
      { field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
    ],
    select: { fields: CARD_REST_FIELDS.map((f) => ({ fieldPath: f })) },
    limit,
  };
  if (cursor) structuredQuery.startAt = cursorStartAt('listings', cursor);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`seller-listings-rest-${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const rawDocs = (Array.isArray(body) ? body : [])
    .filter((r) => r.document)
    .map((r) => r.document);
  let nextCursor: PageCursor | null = null;
  if (rawDocs.length === limit && rawDocs.length > 0) {
    const last = rawDocs[rawDocs.length - 1] as {
      name: string;
      fields?: Record<string, { timestampValue?: unknown }>;
    };
    const ts = last.fields?.createdAt?.timestampValue;
    const id = String(last.name.split('/').pop() || '');
    if (typeof ts === 'string' && id) nextCursor = { t: ts, id };
  }
  return { listings: rawDocs.map(restDocToObj), nextCursor };
}

// R13 AX-F3 (18 Oct 2026): exact count of a seller's ACTIVE listings
// (same sellerId + status semantics as fetchSellerListings) for the
// seller-page meta description. Server-side count aggregation — no docs
// fetched. Fail-soft: null on error (metadata falls back gracefully).
export async function fetchSellerListingCount(
  uid: string
): Promise<number | null> {
  try {
    // Firestore aggregation lives on :runAggregationQuery (NOT :runQuery)
    // with the query nested under structuredAggregationQuery.
    const url =
      FIRESTORE_REST_BASE + ':runAggregationQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
    const structuredQuery = {
      from: [{ collectionId: 'listings' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'sellerId' },
                op: 'EQUAL',
                value: { stringValue: uid },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'status' },
                op: 'IN',
                value: {
                  arrayValue: {
                    values: [
                      { stringValue: 'available' },
                      { stringValue: 'negotiating' },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredAggregationQuery: {
          structuredQuery,
          aggregations: [{ alias: 'total', count: {} }],
        },
      }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const rows = Array.isArray(body) ? body : [];
    const raw =
      rows[0]?.result?.aggregateFields?.total?.integerValue ?? null;
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

// js/listing.js — fetchListingRest (anonymous path; sold docs need auth
// and are handled client-side — SSR renders the public view).
export async function fetchListing(id: string): Promise<ListingDetail | null> {
  const cleanId = id.replace(/\.html$/i, '');
  const url =
    FIRESTORE_REST_BASE + '/listings/' + encodeURIComponent(cleanId) +
    '?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    // 403 on anonymous = sold/hidden doc (per FD-002) → treat as not found
    // for the SSR public view.
    if (res.status === 403) return null;
    throw new Error(`listing-rest-${res.status}`);
  }
  const doc = await res.json().catch(() => null);
  if (!doc || !doc.fields) return null;
  return restDocToObj(doc) as ListingDetail;
}

// js/listing.js — fetchSimilarRest + the LIS-6 client refine (verbatim
// logic, server-side here).
//
// S-39 (0.0.0.21): the unconstrained 40-doc window contained zero docs
// from the viewer's wilaya, so every listing showed the SAME 12 "similar"
// ads. Constrain to the viewer's wilaya first (orderBy createdAt desc,
// limit 12), falling back to recent ads across wilayas when fewer than 12
// match. The wilaya query needs the composite index
// (categoryId, wilayaCode, status, createdAt) — until it exists the
// failure is caught and the old unfiltered window is used instead.
//
// R11-ST31: both queries fire in parallel and merge (dedupe by id, wilaya
// hits first). LIS-6: same category, not this ad, not wanted, not sold;
// same wilaya first, then newest; max 12.
// Shared by fetchSimilarListings and fetchSimilarWindow (js/listing.js
// fetchSimilarRest parity): the raw category/status card-projection query.
// withWilaya adds the wilayaCode constraint (needs the composite index;
// callers catch and fall back when it is missing).
async function runSimilarQuery(
  categoryId: string,
  withWilaya: boolean,
  wilayaCode: number,
  limit: number
): Promise<ListingCard[]> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const baseFilters: Record<string, unknown>[] = [
    {
      fieldFilter: {
        field: { fieldPath: 'categoryId' },
        op: 'EQUAL',
        value: { stringValue: String(categoryId) },
      },
    },
    {
      fieldFilter: {
        field: { fieldPath: 'status' },
        op: 'IN',
        value: {
          arrayValue: {
            values: [{ stringValue: 'available' }, { stringValue: 'negotiating' }],
          },
        },
      },
    },
  ];
  const filters = withWilaya
    ? baseFilters.concat([
        {
          fieldFilter: {
            field: { fieldPath: 'wilayaCode' },
            op: 'EQUAL',
            value: { integerValue: String(Number(wilayaCode)) },
          },
        },
      ])
    : baseFilters.slice();
  const structuredQuery = {
    from: [{ collectionId: 'listings' }],
    where: { compositeFilter: { op: 'AND', filters } },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    select: { fields: CARD_REST_FIELDS.map((f) => ({ fieldPath: f })) },
    limit,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`similar-rest-${res.status}`);
  const body = await res.json().catch(() => null);
  const rawDocs = (Array.isArray(body) ? body : [])
    .filter((r) => r.document)
    .map((r) => r.document);
  return rawDocs.map(restDocToObj);
}

// Round 23: trim SimilarAds payload (85KB HTML → save ~21KB).
// SimilarCard (ListingShell.tsx) only uses: id, title, price,
// photo_thumbs[0]/photoUrls[0]/thumbUrls[0] (via cardImage), wilayaCode,
// createdAt. Everything else (description, answers, extra photos) is
// dropped. The card renders identically. Zak approved 13 Oct 2026.
export function trimSimilarCard(l: ListingCard): ListingCard {
  return {
    id: l.id,
    title: l.title,
    price: l.price,
    negotiable: !!l.negotiable, // R58-FY1 (18 Oct 2026): badge needs this on SSR
    photo_thumbs: Array.isArray(l.photo_thumbs) && l.photo_thumbs[0] ? [l.photo_thumbs[0]] : [],
    photoUrls: Array.isArray(l.photoUrls) && l.photoUrls[0] ? [l.photoUrls[0]] : [],
    thumbUrls: Array.isArray(l.thumbUrls) && l.thumbUrls[0] ? [l.thumbUrls[0]] : [],
    wilayaCode: l.wilayaCode,
    createdAt: l.createdAt,
  };
}

// Round 62: trim the home-feed payload (the home path never got the Round 23
// trimSimilarCard treatment). Measured 14 Oct 2026: each of the 24 feed
// cards carried 3 image arrays — photo_thumbs byte-identical to thumbUrls
// (24/24 cards) and photoUrls never consumed by the home renderer —
// ~31KB of URL bytes per serialization copy. The canonical image is
// resolved server-side ONCE via cardImage() (byte-identical to what every
// card <img> renders today); the arrays are dropped.
//
// Kept verbatim — every field the home-feed consumers read:
//   - ListingCardView: id, title, price, wilayaCode, createdAt, sellerId,
//     status, isWanted, isWholesale, priceReduced, previousPrice,
//     favoriteCount, categoryId, answers{jobType,salary}
//   - client feed logic (taste ranking, follow boost, new-from-followed
//     strip): categoryId, price, wilayaCode, sellerId, isWanted, createdAt
//     — all in the set above.
//   - BlurUpImage: photoVariants + photoUrls[0] — the w32 LQIP and the
//     desktop w640 upgrade are DERIVED from photoUrls[0]; dropping it would
//     change the rendered image (real visual regression for R11+ listings),
//     so the single first element is kept, mirroring trimSimilarCard.
//     photo_thumbs/thumbUrls are fully dropped (cardImage() is pre-resolved
//     into `img`; no home-feed path reads them).
// Applied to both `cards` and `wantedPool` in getFeed() (src/app/page.tsx).
// /api/feed (load-more) and /api/search (filters) intentionally still send
// the full arrays — renderers prefer l.img with cardImage(l) as fallback.
export function trimFeedCard(l: ListingCard): ListingCard {
  const a = (l.answers || {}) as Record<string, unknown>;
  const answers: Record<string, unknown> = {};
  if (typeof a.jobType === 'string') answers.jobType = a.jobType;
  if (typeof a.salary === 'number') answers.salary = a.salary;
  return {
    id: l.id,
    title: l.title,
    price: l.price,
    negotiable: !!l.negotiable, // R58-FY1 (18 Oct 2026): SSR badge on priced-negotiable cards
    wilayaCode: l.wilayaCode,
    createdAt: l.createdAt,
    sellerId: l.sellerId,
    status: l.status,
    isWanted: l.isWanted,
    isWholesale: l.isWholesale,
    priceReduced: l.priceReduced,
    previousPrice: l.previousPrice,
    favoriteCount: l.favoriteCount,
    categoryId: l.categoryId,
    answers: l.answers ? answers : undefined,
    photoUrls: Array.isArray(l.photoUrls) && l.photoUrls[0] ? [l.photoUrls[0]] : [],
    photoVariants: !!l.photoVariants,
    img: cardImage(l),
  };
}

// Similar rail, stats-first (23 Oct 2026, reads-reduction 2): the
// siteStats CF precomputes every live listing's rail verbatim (see
// computeRelatedFor in the CF) into siteStats/related — a head + one
// chunk read instead of the 12+40 live reads below. An entry is used
// only when present (an explicitly EMPTY rail is honored as-is); the
// live implementation remains the fallback for listings the last run
// did not cover (published since, or the dataset absent/malformed).
export async function fetchSimilarListings(
  categoryId: string,
  wilayaCode: number,
  excludeId: string
): Promise<ListingCard[]> {
  const stats = await readStatsRelated(excludeId).catch(() => null);
  if (stats) return stats as unknown as ListingCard[];
  return fetchSimilarListingsLive(categoryId, wilayaCode, excludeId);
}

async function fetchSimilarListingsLive(
  categoryId: string,
  wilayaCode: number,
  excludeId: string
): Promise<ListingCard[]> {
  const w = Number(wilayaCode) || 0;
  const wilayaP = w > 0 ? runSimilarQuery(categoryId, true, w, 12).catch(() => [] as ListingCard[]) : Promise.resolve([] as ListingCard[]);
  const windowP = runSimilarQuery(categoryId, false, 0, 40).catch(() => [] as ListingCard[]);
  const [wilayaDocs, windowDocs] = await Promise.all([wilayaP, windowP]);
  const docs = wilayaDocs.slice();
  const seen = new Set(docs.map((d) => d.id));
  for (const d of windowDocs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    docs.push(d);
    if (docs.length >= 12) break;
  }
  const createdMs = (d: ListingCard): number => {
    const c = d.createdAt;
    if (c instanceof Date) return c.getTime();
    return 0;
  };
  return docs
    .filter((d) => d.id !== excludeId && !d.isWanted)
    .sort(
      (a, b) =>
        (Number(b.wilayaCode) === w ? 1 : 0) - (Number(a.wilayaCode) === w ? 1 : 0) ||
        createdMs(b) - createdMs(a)
    )
    .slice(0, 12)
    .map(trimSimilarCard);
}

// js/listing.js loadMatches parity (wanted branch): the unfiltered 40-doc
// category window — matchingOffers does its own title-word match on the
// client (same category, available/negotiating, newest first).
export async function fetchSimilarWindow(categoryId: string): Promise<ListingCard[]> {
  return runSimilarQuery(categoryId, false, 0, 40);
}

// js/market.js — normSearchText (verbatim logic)
export function normSearchText(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٖ]/g, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .replace(/\s+/g, ' ')
    .trim();
}

// Wanted ads (مطلوب): listings where isWanted == true and status is
// available/negotiating, newest first. Mirrors js/wanted.js loadWanted().
// Public read — no auth needed.
export async function fetchWanted(limit = 120): Promise<ListingCard[]> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const structuredQuery = {
    from: [{ collectionId: 'listings' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: 'isWanted' },
              op: 'EQUAL',
              value: { booleanValue: true },
            },
          },
          {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'IN',
              value: {
                arrayValue: {
                  values: [{ stringValue: 'available' }, { stringValue: 'negotiating' }],
                },
              },
            },
          },
        ],
      },
    },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    select: { fields: CARD_REST_FIELDS.map((f) => ({ fieldPath: f })) },
    limit,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`wanted-rest-${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const rawDocs = (Array.isArray(body) ? body : [])
    .filter((r) => r.document)
    .map((r) => r.document);
  return rawDocs.map(restDocToObj);
}

export interface SearchFilters {
  q?: string;
  cat?: string;
  wilaya?: string;
  min?: string;
  max?: string;
  sort?: string; // 'recent' | 'priceAsc' | 'priceDesc' (legacy home.js fSort)
  // Category facets (js/home.js F.f*): phones OS+brand, cars brand+fuel+gear+year+mileage
  fOs?: string;
  fBrand?: string;
  fCarBrand?: string;
  fFuel?: string;
  fGear?: string;
  fYearMin?: string;
  fYearMax?: string;
  fMilMin?: string;
  fMilMax?: string;
}

// R23-1 fix (24 Oct 2026): the facet brand keys + legacy brand
// normalization moved to ./brand-normalize (pure module, shared with
// lib/seo.ts). Imported here for internal use and re-exported so every
// existing '@/lib/firestore' importer keeps working unchanged.
import {
  FACET_CAR_BRANDS,
  FACET_PHONE_BRANDS,
  LEGACY_CAR_BRAND_MAP,
  LEGACY_PHONE_BRAND_MAP,
  normalizeCarBrand,
  normalizePhoneBrand,
} from './brand-normalize';
export {
  FACET_CAR_BRANDS,
  FACET_PHONE_BRANDS,
  facetPhoneBrandsForOs,
  normalizeCarBrand,
  normalizePhoneBrand,
} from './brand-normalize';

// Maps a canonical cb* brand key to the legacy free-text spellings measured
// in production (24 Sep 2026). The server brand filter is
// answers.brand IN [cbKey, ...legacySpellings] (case-sensitive).
const CB_TO_LEGACY_BRAND: Record<string, string[]> = {
  cbRenault: ['Renault'], cbDacia: ['Dacia'], cbPeugeot: ['Peugeot'],
  cbCitroen: ['Citroen'], cbFiat: ['Fiat'], cbVolkswagen: ['Volkswagen'],
  cbHyundai: ['Hyundai'], cbKia: ['Kia'], cbToyota: ['Toyota'], cbNissan: ['Nissan'],
  cbSkoda: ['Skoda'], cbSeat: ['Seat'], cbOpel: ['Opel'], cbSuzuki: ['Suzuki'],
  cbAudi: ['Audi'], cbBmw: ['Bmw', 'BMW'], cbMercedes: ['Mercedes'],
  cbChery: ['Chery'], cbGeely: ['Geely'], cbByd: ['Byd', 'BYD'],
};


// Round 52 (18 Oct 2026): phone equivalent of CB_TO_LEGACY_BRAND — inverted
// from LEGACY_PHONE_BRAND_MAP so the server-side brand IN filter covers
// docs stored under free-text spellings ('Samsung') as well as pb* keys.
// Capitalized Latin variants included (docs store 'Samsung', the map keys
// are lowercase); Arabic keys pass through verbatim.
const PB_TO_LEGACY_BRAND: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const [spell, key] of Object.entries(LEGACY_PHONE_BRAND_MAP)) {
    (m[key] ||= []).push(spell);
    if (/^[a-z]+$/.test(spell)) {
      const cap = spell[0].toUpperCase() + spell.slice(1);
      if (!m[key].includes(cap)) m[key].push(cap);
    }
  }
  return m;
})();

// R16 (18 Oct 2026): typo tolerance for brand tokens in free-text search.
// A Latin token that maps to no known brand gets ONE conservative
// edit-distance attempt against the known Latin brand spellings
// (peugot → peugeot, samsong → samsung). Thresholds are tight and short
// keys are skipped — unknown values still resolve to '' (no guessing),
// so this only rescues near-misses of real brands.
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      cur[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

export function fuzzyBrandKey(token: string): string {
  const latin = String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Latin-only, min length 4 — shorter tokens are too ambiguous to guess.
  if (!/^[a-z0-9]{4,}$/.test(latin)) return '';
  let best = '';
  let bestDist = Infinity;
  const consider = (map: Record<string, string>) => {
    for (const key of Object.keys(map)) {
      // Skip very short keys (vw, byd...) — distance-1 on a 2-3 char key
      // would match half the dictionary.
      if (!/^[a-z]{4,}$/.test(key)) continue;
      const d = editDistance(latin, key);
      // Tight threshold: 1 typo for short names, 2 for longer ones.
      const maxD = key.length <= 6 ? 1 : 2;
      if (d > 0 && d <= maxD && d < bestDist) {
        bestDist = d;
        best = map[key];
      }
    }
  };
  consider(LEGACY_CAR_BRAND_MAP);
  consider(LEGACY_PHONE_BRAND_MAP);
  return best;
}

// R16 (18 Oct 2026): the main search pipeline hardcoded the .ar title /
// description slots, so .fr/.en description content was never searched
// (the Round 7 all-variants fix only covered saved-search matching).
// Join ALL language variants into the search haystack — same approach as
// matchesSavedSearch in savedSearchMatch.ts.
export function allTextVariants(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>)
      .filter((s): s is string => typeof s === 'string' && !!s)
      .join(' ');
  }
  return '';
}

// Round 52 (18 Oct 2026): resolve a free-text query into an optional brand
// key + remaining text tokens — the same brand mapping the fCarBrand/fBrand
// facets use (R5-1 Arabic brands, AZ-1 phone brands, R16 fuzzy typos).
// Extracted from the inline loop in runSearchPipeline so the server query
// plan can ALSO pre-filter on the brand (answers.brand IN [...]) instead of
// relying on the 120-doc global deep pool — pure brand queries like
// q=samsung returned ZERO while 13 Samsung phones existed, because none
// landed in the 120 newest docs. Verbatim logic, moved unchanged.
// R25-1 (24 Oct 2026): also returns brandText — the normalized query text
// that produced the brand key (the mapped token, or the whole normalized
// query when only the whole-string pass mapped). The stage-5 matcher uses
// it as the title/description fallback for docs whose answers.brand is
// missing (see makeTextMatcher). The Round-52 server IN pre-filter itself
// is gone (R25-1): brand selection is stage 5's alone now.
export function resolveQueryBrand(rawQ: string): {
  qBrand: string;
  textQ: string;
  brandText: string;
} {
  const q = normSearchText(rawQ);
  const tokens = q.split(' ').filter(Boolean);
  let qBrand = '';
  let brandText = '';
  const textTokens: string[] = [];
  for (const t of tokens) {
    // AZ-1 (18 Oct 2026): phone brands had no mapping at all — try the
    // phone map too (q=سامسونج / q=samsung / q=iphone).
    let b = !qBrand ? (normalizeCarBrand(t) || normalizePhoneBrand(t)) : '';
    // R16 (18 Oct 2026): typo tolerance — a Latin token that maps to no
    // known brand gets one conservative edit-distance attempt
    // (peugot → cbPeugeot). Still '' for genuine unknowns.
    if (!b && !qBrand) b = fuzzyBrandKey(t);
    if (b) {
      qBrand = b;
      brandText = t;
    } else textTokens.push(t);
  }
  if (!qBrand) {
    const b = normalizeCarBrand(rawQ.trim()) || normalizePhoneBrand(rawQ.trim())
      || fuzzyBrandKey(rawQ.trim());
    if (b) {
      qBrand = b;
      brandText = q;
    }
  }
  return { qBrand, textQ: textTokens.join(' '), brandText };
}

export function hasFacetFilter(f: SearchFilters): boolean {
  return !!(
    f.fOs || f.fBrand || f.fCarBrand || f.fFuel || f.fGear ||
    (f.fYearMin !== undefined && f.fYearMin !== '') ||
    (f.fYearMax !== undefined && f.fYearMax !== '') ||
    (f.fMilMin !== undefined && f.fMilMin !== '') ||
    (f.fMilMax !== undefined && f.fMilMax !== '')
  );
}

// Verbatim port of js/home.js matchFacets() — the client-side correctness
// layer under the server facet plan. F-13 (0.0.0.21): min/max are ordered
// independently so unswapped ranges can never filter everything out.
export function matchFacets(d: ListingCard, f: SearchFilters): boolean {
  const a = (d.answers || {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const yMin = f.fYearMin || '', yMax = f.fYearMax || '';
  const mMin = f.fMilMin || '', mMax = f.fMilMax || '';
  if (f.cat === 'phones') {
    if (f.fOs && str(a.os) !== f.fOs) return false;
    if (f.fBrand && str(a.brand) !== f.fBrand) return false;
  } else if (f.cat === 'cars') {
    if (f.fCarBrand && normalizeCarBrand(a.brand) !== f.fCarBrand) return false;
    if (f.fFuel && str(a.fuel) !== f.fFuel) return false;
    if (f.fGear && str(a.gear) !== f.fGear) return false;
    const year = Number(a.year);
    const yLo = yMin !== '' && yMax !== '' ? Math.min(Number(yMin), Number(yMax)) : (yMin !== '' ? Number(yMin) : -Infinity);
    const yHi = yMin !== '' && yMax !== '' ? Math.max(Number(yMin), Number(yMax)) : (yMax !== '' ? Number(yMax) : Infinity);
    if ((yMin !== '' || yMax !== '') && !(year >= yLo && year <= yHi)) return false;
    const mil = Number(a.mileage);
    const mLo = mMin !== '' && mMax !== '' ? Math.min(Number(mMin), Number(mMax)) : (mMin !== '' ? Number(mMin) : -Infinity);
    const mHi = mMin !== '' && mMax !== '' ? Math.max(Number(mMin), Number(mMax)) : (mMax !== '' ? Number(mMax) : Infinity);
    if ((mMin !== '' || mMax !== '') && !(mil >= mLo && mil <= mHi)) return false;
  }
  return true;
}

// 0.0.0.31 FIX-WEB-021: client relevance scoring for text search.
// Verbatim port of js/home.js relevanceRank: exact title (100) > title
// prefix (50) > title contains (30) > description contains (10);
// recency breaks ties. Schwartzian transform — each doc normalized once.
// R5-1 (18 Oct 2026): optional brandKey — docs whose answers.brand maps to
// it score 30 (title-contains tier) so pure brand queries (q=بيجو) don't
// all score zero.
function relevanceRank(docs: ListingCard[], q: string, brandKey = ''): ListingCard[] {
  const qn = normSearchText(q);
  const decorated = new Array<{ d: ListingCard; score: number; ts: number }>(docs.length);
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    // R16 (18 Oct 2026): search ALL title/description language variants
    // (was .ar only — .fr/.en descriptions were never matched).
    const title = normSearchText(allTextVariants(d.title));
    const desc = normSearchText(allTextVariants(d.description));
    const answers = (d.answers || {}) as Record<string, unknown>;
    // R5-1 (18 Oct 2026): optional brandKey — docs whose answers.brand maps to
    // it score 30 (title-contains tier) so pure brand queries (q=بيجو) don't
    // all score zero. AZ-1 (18 Oct 2026): phone brandKey support — a pb*
    // brand key matches via the phone map (answers.brand is stored pb*).
    const brandHit = !!brandKey && (normalizeCarBrand(answers.brand) === brandKey ||
      normalizePhoneBrand(answers.brand) === brandKey);
    const c = d.createdAt;
    decorated[i] = {
      d,
      score: title === qn ? 100 : title.startsWith(qn) ? 50
        : title.includes(qn) ? 30 : desc.includes(qn) ? 10
        : brandHit ? 30 : 0,
      ts: c instanceof Date && !isNaN(c.getTime()) ? c.getTime() : 0,
    };
  }
  decorated.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
  const out = new Array<ListingCard>(decorated.length);
  for (let i = 0; i < decorated.length; i++) out[i] = decorated[i].d;
  return out;
}

// R25-1 (24 Oct 2026): the stage-5 text matcher — ONE implementation
// shared verbatim by runSearchPipeline and runSearchPipelineFromIndex
// (the parity harness deep-equals the two pipelines; a single matcher
// makes their text semantics identical by construction). Precondition:
// f.q is a non-empty query (both call sites guard on it).
//
// A doc matches when:
//   - brand: if the query resolved to a brand key, the doc's own brand
//     (same map family — AZ-1) must equal it, OR the doc's
//     title/description names the brand word itself (brandText). The
//     fallback exists because the gate used to consult answers.brand
//     ONLY: an import whose brand answer is missing was invisible even
//     to its own brand query (R25-1 casualty mct69569034bc104, a
//     Samsung-titled phone with no answers.brand, unreachable by
//     q=samsung). relevanceRank already scores such a doc as a title
//     hit; the gate now lets it reach the ranker. A doc of ANOTHER
//     brand whose text merely mentions the word also passes —
//     substring semantics; relevanceRank ranks it below true brand
//     docs (description hit 10 < brand hit 30).
//   - text: the remaining tokens (textQ) as one normalized substring
//     of the title or description, ALL language variants (R16) — the
//     PHRASE class, unchanged.
// R29-1 (24 Oct 2026): multi-token queries additionally match a
// TOKEN class — every remaining token present as a whole word in the
// title. The phrase-only stage made «clio 2019» return ZERO while 13
// listings carry both tokens ("Renault Clio 4 2019" — the generation
// sits between model and year, so the literal phrase never occurs).
// Whole words in the TITLE, deliberately: substring tokens over
// title+description would flood «clio 4» from 34 to 66 (the token "4"
// hides inside "2014", "4 portes" descriptions, …), breaking result
// sets that work today. On the R29 catalog snapshot the token class
// adds exactly the phrase-missed both-token titles («clio 2019» → 13,
// «clio 4 2019» → 13) and nothing to «clio 4» (34), «golf 8» (13),
// «ibiza 2019» (7), «sandero 2017» (8). classify() returns 2 = phrase,
// 1 = token-only, 0 = no match; single-token and brand-only queries
// can only ever produce class 2, byte-identical to before.
export function makeTextMatcher(f: SearchFilters): {
  qBrand: string;
  matches: (d: ListingCard) => boolean;
  phraseMatches: (d: ListingCard) => boolean;
  classify: (d: ListingCard) => 0 | 1 | 2;
} {
  const { qBrand, textQ, brandText } = resolveQueryBrand(f.q || '');
  const textTokens = textQ ? textQ.split(' ').filter(Boolean) : [];
  const classify = (d: ListingCard): 0 | 1 | 2 => {
    const answers = (d.answers || {}) as Record<string, unknown>;
    // AZ-1 (18 Oct 2026): the doc-side brand must use the same map family
    // as the query key — pb* keys (phone brands) normalize via the phone
    // map, cb* via the car map. Either map returns '' for the other
    // family's values, so cross-category docs are correctly excluded.
    const docBrand = qBrand.startsWith('pb')
      ? normalizePhoneBrand(answers.brand)
      : normalizeCarBrand(answers.brand);
    // R16 (18 Oct 2026): search ALL language variants (was .ar only).
    const title = normSearchText(allTextVariants(d.title));
    const desc = normSearchText(allTextVariants(d.description));
    if (qBrand && docBrand !== qBrand) {
      if (!brandText || (!title.includes(brandText) && !desc.includes(brandText))) {
        return 0;
      }
    }
    if (!textQ || title.includes(textQ) || desc.includes(textQ)) return 2;
    if (textTokens.length >= 2) {
      // R29-1 token class: every token a whole word of the title.
      // Word = maximal run of Unicode letters/digits in the normalized
      // title (normSearchText has already collapsed whitespace; the
      // split also strips punctuation glued to words, "4," → "4").
      const words = new Set(title.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
      if (textTokens.every((t) => words.has(t))) return 1;
    }
    return 0;
  };
  const matches = (d: ListingCard): boolean => classify(d) > 0;
  const phraseMatches = (d: ListingCard): boolean => classify(d) === 2;
  return { qBrand, matches, phraseMatches, classify };
}

// R29-2 (24 Oct 2026): model-name typo tolerance — the R16 brand fuzzy
// pass mirrored for model names, with the catalog itself as the
// vocabulary. There is no model dictionary in code (models are free
// text in titles), so the vocabulary is the pool's own title words:
// a query token that occurs in NO pool title/description gets one
// conservative edit-distance attempt against those words, using the
// exact fuzzyBrandKey thresholds (Latin-only, min length 4, 1 typo for
// words ≤6 chars, 2 for longer; deterministic tie-break — smallest
// distance, then alphabetically smallest word — so the live and index
// pipelines agree regardless of pool order). Brand tokens never reach
// this pass (resolveQueryBrand claims them first, fuzzyBrandKey
// included), and tokens that match anything today are never touched —
// so every query that works today returns its identical set and order,
// and the correction only ever rescues a query that returned zero
// ('ibisa' → 'ibiza', 'sandaro' → 'sandero'). The corrected query
// flows through the existing matcher AND ranker, so corrected results
// rank exactly like the correctly-spelled query. The live pipeline's
// early-stop phrase counter still uses the uncorrected matcher — it
// undercounts typo queries, which only scans further (safe direction).
// Saved-search matching is a separate matcher (savedSearchMatch.ts)
// and is deliberately untouched by this search-surface fix.
function correctModelTypos<T extends ListingCard>(docs: T[], f: SearchFilters): SearchFilters {
  const q = (f.q || '').trim();
  if (!q || !docs.length) return f;
  const tokens = normSearchText(q).split(' ').filter(Boolean);
  if (!tokens.length) return f;
  const haystacks: string[] = [];
  const titleWords = new Set<string>();
  for (const d of docs) {
    const title = normSearchText(allTextVariants(d.title));
    const desc = normSearchText(allTextVariants(d.description));
    haystacks.push(title, desc);
    for (const w of title.split(/[^\p{L}\p{N}]+/u)) {
      if (/^[a-z]{4,}$/.test(w)) titleWords.add(w);
    }
  }
  let changed = false;
  const out = tokens.map((t) => {
    // Brand tokens belong to the brand pass — never "corrected".
    if (normalizeCarBrand(t) || normalizePhoneBrand(t) || fuzzyBrandKey(t)) return t;
    if (!/^[a-z]{4,}$/.test(t)) return t;
    // Matches something today → untouched (byte-identical guarantee).
    if (haystacks.some((h) => h.includes(t))) return t;
    let best = '';
    let bestDist = Infinity;
    for (const w of titleWords) {
      const d = editDistance(t, w);
      const maxD = w.length <= 6 ? 1 : 2;
      if (d > 0 && d <= maxD && (d < bestDist || (d === bestDist && w < best))) {
        bestDist = d;
        best = w;
      }
    }
    if (best) {
      changed = true;
      return best;
    }
    return t;
  });
  return changed ? { ...f, q: out.join(' ') } : f;
}

// Stage 5 (both pipelines): collect matches in pool order up to
// SEARCH_MAX_MATCHES, then relevance-rank for the recent sort
// (FIX-WEB-021: relevance leads, recency breaks ties; price sorts keep
// pool order — the legacy renderFeed sort branch). R5-1: the brandKey
// is passed through so brand-matched docs score as title-contains (30)
// and a pure brand query orders by recency instead of all-zero scores.
// R29-1 (24 Oct 2026): selection is phrase-first — the phrase class
// fills up to SEARCH_MAX_MATCHES exactly as the pre-fix stage did (so
// every query that works today returns its identical set and, for the
// recent sort, its identical relevance order), and token-class matches
// take only the slots the phrase class leaves free. For price sorts
// the kept union is emitted in pool order, so the price ordering the
// user asked for stays exact.
export function textMatchStage<T extends ListingCard>(docs: T[], f: SearchFilters): T[] {
  // R29-2: typo-correct model tokens against the pool before matching
  // (no-op for every query that already matches — see correctModelTypos).
  const cf = correctModelTypos(docs, f);
  const { qBrand, classify } = makeTextMatcher(cf);
  const phrase: T[] = [];
  const tokenOnly: T[] = [];
  for (const d of docs) {
    const c = classify(d);
    if (c === 2) phrase.push(d);
    else if (c === 1) tokenOnly.push(d);
  }
  const keptPhrase = phrase.slice(0, SEARCH_MAX_MATCHES);
  const keptToken = tokenOnly.slice(0, SEARCH_MAX_MATCHES - keptPhrase.length);
  if (!cf.sort || cf.sort === 'recent') {
    return relevanceRank(keptPhrase, cf.q || '', qBrand).concat(
      relevanceRank(keptToken, cf.q || '', qBrand)
    ) as T[];
  }
  const keep = new Set<ListingCard>([...keptPhrase, ...keptToken]);
  return docs.filter((d) => keep.has(d));
}

// 0.0.0.31 FIX-WEB-014 (+050): result-count text with proper Arabic plurals.
// Verbatim port of js/home.js resultsCountText — pure, unit-tested there.
export function resultsCountText(n: number, lang = 'ar'): string {
  n = Number(n) || 0;
  lang = lang || 'ar';
  if (lang === 'ar') {
    if (n === 0) return 'لا توجد نتائج';
    if (n === 1) return 'نتيجة واحدة';
    if (n === 2) return 'نتيجتان';
    if (n <= 10) return n + ' نتائج';
    return n + ' نتيجة';
  }
  if (lang === 'fr') return n <= 1 ? n + ' résultat' : n + ' résultats';
  return n === 1 ? '1 result' : n + ' results';
}

// 0.0.0.31 FIX-WEB-025: proper plurals for the views counter
// (AR: مشاهدة واحدة/مشاهدتان/مشاهدات/مشاهدة).
// Verbatim port of js/app.js viewsText — LANG replaced by a lang param
// (default 'ar'), pure and unit-tested like resultsCountText.
export function viewsText(n: number | null | undefined, lang = 'ar'): string {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (lang === 'ar') {
    if (n === 0) return 'لا مشاهدات';
    if (n === 1) return 'مشاهدة واحدة';
    if (n === 2) return 'مشاهدتان';
    if (n <= 10) return `${n} مشاهدات`;
    return `${n} مشاهدة`;
  }
  if (lang === 'fr') return n <= 1 ? `${n} vue` : `${n} vues`;
  return n === 1 ? '1 view' : `${n} views`;
}

// js/home.js paging constants — DEEP_POOL = 60 (single deep fetch when
// client-side refinements need room), MAX_SEARCH_MATCHES = 60 (text-search
// match cap), PAGE_SIZE = 24 (docs per page).
// R16 (18 Oct 2026): raised 60 → 120. Text search could only ever return
// from the 60 newest docs of the filtered set, making older matching
// listings unreachable. 120 doubles reachability with bounded read cost
// (deep-pool mode only: text query, price range, or facet filters).
export const SEARCH_DEEP_POOL = 120;
export const SEARCH_MAX_MATCHES = 120;
export const SEARCH_PAGE_SIZE = 24;

// R25-1 (24 Oct 2026): the live pipeline's text-scan bound. On the
// index path the stage-5 text match runs over the whole catalog in
// memory (zero reads). The live Firestore path cannot substring-match
// server-side, so for a text query it cursor-paginates the filtered
// query in SEARCH_DEEP_POOL pages until the match cap is reached or
// this many docs have been scanned — the newest 600 docs of the
// filtered set. That window is the ONE residual divergence from the
// index path, and it is reachable only on the breaker-gated fallback
// (the index dataset genuinely missing): text matches older than the
// window wait for the index to return. Brand selection semantics
// (makeTextMatcher) are identical on both paths within the window.
export const SEARCH_TEXT_SCAN_CAP = 600;

export interface SearchResult {
  listings: ListingCard[];
  // Count of painted cards — legacy resultsMeta semantics:
  // js/home.js setResultsCount(shown.length).
  total: number;
  // Structured-filter mode only: a further page may exist
  // (legacy: moreAvailable = !deepPool && fresh.length === limit).
  hasMore: boolean;
}

// The full matched pool for a filter set (22 Oct 2026, reads-incident
// root fix). The pipeline ALWAYS deep-fetches the bounded pool
// (SEARCH_DEEP_POOL) — for every mode. The legacy structured mode
// fetched limit+1 per request and the clients re-queried with a growing
// limit on every "show more" click, re-reading the whole prefix plus the
// boost batchGet each time (measured in the baseline session: the same
// filter set executed at limit 25, then 49, then 73...). The pool is
// mode-independent now; the slicing/total/hasMore shaping lives in
// searchListingsWithCount (src/lib/search-pool.ts), which serves every
// page of a filter set from ONE cached pool execution per 60s window —
// the same freshness contract the /search SSR already had.
export async function fetchSearchPool(f: SearchFilters): Promise<ListingCard[]> {
  const usePriceRange =
    (f.min !== undefined && f.min !== '') || (f.max !== undefined && f.max !== '');
  return runSearchPipeline(f, SEARCH_DEEP_POOL, usePriceRange);
}

// HOM-1 (16 Sep 2026, production parity): background fetch of all-wilayas
// wanted ads (wilayaCode 0). Production js/home.js fetchWantedAllWilayas():
// separate query for wilayaCode == 0 + status IN [available, negotiating],
// then client-side filter by isWanted/cat/price. The raw pool is
// filter-independent, so callers merge the filtered subset.
async function fetchWantedZeroWilaya(f: SearchFilters): Promise<ListingCard[]> {
  const url = FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const wilayaEq = {
    fieldFilter: {
      field: { fieldPath: 'wilayaCode' }, op: 'EQUAL',
      value: { integerValue: '0' },
    },
  };
  const statusIn = {
    fieldFilter: {
      field: { fieldPath: 'status' }, op: 'IN',
      value: { arrayValue: { values: [{ stringValue: 'available' }, { stringValue: 'negotiating' }] } },
    },
  };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'listings' }],
          where: { compositeFilter: { op: 'AND', filters: [wilayaEq, statusIn] } },
          select: { fields: CARD_REST_FIELDS.map((x) => ({ fieldPath: x })) },
          limit: 100,
        },
      }),
      cache: 'no-store',
    });
    if (!r.ok) return [];
    const body = await r.json().catch(() => null);
    const docs = (Array.isArray(body) ? body : [])
      .filter((x) => x.document)
      .map((x) => restDocToObj(x.document));
    // fetchWantedAllWilayasFilter (js/home.js, verbatim logic)
    // 22 Oct 2026 (audit R16): raw bounds — the 11 Oct auto-order silently
    // reinterpreted an inverted range, which made the FIX-WEB-009 inverted-
    // range empty state unreachable. An inverted range now matches nothing
    // here too, consistent with runSearchPipeline below.
    const lo = f.min !== undefined && f.min !== '' ? Number(f.min) : -Infinity;
    const hi = f.max !== undefined && f.max !== '' ? Number(f.max) : Infinity;
    return docs.filter((d) => {
      if (!d.isWanted) return false;
      if (f.cat && d.categoryId !== f.cat) return false;
      const p = Number(d.price || 0);
      if (p < lo || p > hi) return false;
      return true;
    });
  } catch {
    return [];
  }
}

// Internal pipeline: server pool → client refinements → matched docs
// (pre-slice; the caller decides how many to paint).
async function runSearchPipeline(
  f: SearchFilters,
  poolLimit: number,
  usePriceRange: boolean
): Promise<ListingCard[]> {
  // Round 52's qBrandKey pre-resolution lived here (it fed the server
  // brand IN filter below). R25-1 (24 Oct 2026) removed that filter —
  // stage 5 resolves the query itself (makeTextMatcher).
  const filters: unknown[] = [{
    fieldFilter: {
      field: { fieldPath: 'status' },
      op: 'IN',
      value: { arrayValue: { values: [{ stringValue: 'available' }, { stringValue: 'negotiating' }] } },
    },
  }];
  if (f.cat) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'categoryId' }, op: 'EQUAL',
        value: { stringValue: f.cat },
      },
    });
  }
  if (f.wilaya) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'wilayaCode' }, op: 'EQUAL',
        value: { integerValue: String(Number(f.wilaya)) },
      },
    });
  }
  // 22 Oct 2026 (audit R16): raw bounds, NO auto-order. The 11 Oct swap
  // silently reinterpreted an inverted range (min>max returned the swapped
  // range's results), which made the FIX-WEB-009 dedicated empty state
  // (HomeFilteredGrid: noResultsPriceRange + hint + reset) unreachable —
  // FIX-WEB-009 mandates "never a silent reinterpretation of the user's
  // bounds". With raw bounds an inverted range matches zero docs and the
  // UI empty state fires as designed.
  const pMin = f.min !== undefined && f.min !== '' ? Number(f.min) : undefined;
  const pMax = f.max !== undefined && f.max !== '' ? Number(f.max) : undefined;
  const lo = pMin;
  const hi = pMax;
  if (lo !== undefined) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'price' }, op: 'GREATER_THAN_OR_EQUAL',
        value: { doubleValue: lo },
      },
    });
  }
  if (hi !== undefined) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'price' }, op: 'LESS_THAN_OR_EQUAL',
        value: { doubleValue: hi },
      },
    });
  }

  // Category facets — server plan (js/home.js facetServerPlan). Eq predicates
  // run on the server when the query shape stays index-friendly (recent sort,
  // no price range — mirrors the legacy eligibility bail); the missing-index
  // fallback below reverts to client-side matching via matchFacets().
  const facetServerEligible = (!f.sort || f.sort === 'recent') && !usePriceRange;
  if (facetServerEligible) {
    if (f.cat === 'phones') {
      if (f.fOs) {
        filters.push({
          fieldFilter: {
            field: { fieldPath: 'answers.os' }, op: 'EQUAL',
            value: { stringValue: f.fOs },
          },
        });
      }
      if (f.fBrand) {
        filters.push({
          fieldFilter: {
            field: { fieldPath: 'answers.brand' }, op: 'EQUAL',
            value: { stringValue: f.fBrand },
          },
        });
      }
    } else if (f.cat === 'cars') {
      if (f.fCarBrand) {
        const legacySpellings = CB_TO_LEGACY_BRAND[f.fCarBrand] || [];
        filters.push({
          fieldFilter: {
            field: { fieldPath: 'answers.brand' }, op: 'IN',
            value: {
              arrayValue: {
                values: [{ stringValue: f.fCarBrand }, ...legacySpellings.map((s) => ({ stringValue: s }))],
              },
            },
          },
        });
      }
      if (f.fFuel) {
        filters.push({
          fieldFilter: {
            field: { fieldPath: 'answers.fuel' }, op: 'EQUAL',
            value: { stringValue: f.fFuel },
          },
        });
      }
      if (f.fGear) {
        filters.push({
          fieldFilter: {
            field: { fieldPath: 'answers.gear' }, op: 'EQUAL',
            value: { stringValue: f.fGear },
          },
        });
      }
    }
  }

  // Round 52's server-side brand IN pre-filter is GONE (R25-1,
  // 24 Oct 2026). It hard-dropped every doc whose answers.brand was
  // absent or spelled outside the IN list before stage 5 could see it
  // — a Samsung-titled phone with no brand answer was invisible to
  // q=samsung — and it bounded brand reach to the fetched pool. Brand
  // selection now lives entirely in stage 5 (makeTextMatcher: brand
  // gate + title fallback), and the paginated fetch below gives stage
  // 5 a bounded-but-deep candidate set (SEARCH_TEXT_SCAN_CAP).

  const url = FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  // Sort: legacy fSort (الأحدث / السعر من الأقل / السعر من الأعلى).
  // 12 Oct 2026: Firestore cannot serve a range filter on price together
  // with orderBy on a DIFFERENT field (createdAt) — the first orderBy must
  // be the range field, and no composite index can fix that shape. When a
  // price range is present without an explicit price sort, order by price
  // server-side (served by the existing index) and restore the newest-first
  // order client-side below.
  const priceDir =
    f.sort === 'priceAsc' ? 'ASCENDING' : f.sort === 'priceDesc' ? 'DESCENDING' : null;
  const orderBy = priceDir
    ? [{ field: { fieldPath: 'price' }, direction: priceDir }]
    : usePriceRange
      ? [{ field: { fieldPath: 'price' }, direction: 'ASCENDING' }]
      : [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }];
  const runQuery = async (
    useFilters: unknown[],
    startAt?: { values: unknown[]; before: boolean }
  ) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'listings' }],
          where: useFilters.length > 1
            ? { compositeFilter: { op: 'AND', filters: useFilters } }
            : useFilters[0],
          orderBy,
          ...(startAt ? { startAt } : {}),
          select: { fields: CARD_REST_FIELDS.map((x) => ({ fieldPath: x })) },
          // Deep-pool shapes scan a fixed pool (js/home.js DEEP_POOL);
          // structured shapes fetch one extra row for the hasMore heuristic.
          limit: poolLimit,
        },
      }),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`search-rest-${r.status}`);
    return r;
  };

  // Round 17 T6: the all-wilayas wanted pool does not depend on the main
  // query's results — fire it in parallel with the main query instead of
  // after it. fetchWantedZeroWilaya never rejects (fails closed to []),
  // so a main-query throw below leaves no unhandled rejection.
  // Same merge point and same merge logic below: identical output.
  const wantedZeroP = f.wilaya ? fetchWantedZeroWilaya(f) : null;

  // R25-1 (24 Oct 2026): text queries paginate. Firestore cannot
  // substring-match server-side, so stage 5 matches client-side — over
  // a single 120-doc pool that made every match older than the 120
  // newest filtered docs unreachable (q=galaxy → 0 with 14 matches in
  // the catalog, q=sandero → 1 of 27). For a text query the fetch now
  // follows startAt cursors (the orderBy field's raw REST value +
  // the page-last doc's reference — strictly-after semantics) until
  // the filtered set is exhausted, SEARCH_TEXT_SCAN_CAP docs have
  // been scanned, or the matches stage 5 could keep are already full.
  // Non-text shapes keep the single-page fetch, byte-identical.
  // The early stop is only sound when stage 5 iterates in fetch
  // order — recent sort (any facet state) or an explicit price sort.
  // The price-RANGE shape re-sorts newest-first after the fetch, so
  // it always scans to the cap/exhaustion. The missing-index fallback
  // re-paginates its status-only query WITHOUT the early stop (its
  // client-side filter runs after the fetch, so a fetched-order match
  // count would not be stage 5's count).
  const isTextQuery = !!(f.q && f.q.trim());
  const textMatcher = isTextQuery ? makeTextMatcher(f) : null;
  // Stage 5's match count over the docs accumulated so far — decoded
  // and facet-refined on the fly, minus the wanted merge (whose docs
  // iterate after the main pool and can never displace a main match).
  // R29-1 (24 Oct 2026): count PHRASE-class matches only. Token-class
  // matches fill only the slots the phrase class leaves free, so the
  // scan may stop early only once SEARCH_MAX_MATCHES phrase matches
  // are in hand — stopping on the combined count could strand deeper
  // phrase matches behind token matches that would be displaced by
  // them. Worst case stays SEARCH_TEXT_SCAN_CAP, as before.
  const countMatchesSoFar = (raw: unknown[]): number => {
    if (!textMatcher) return 0;
    let acc = raw.map((r) => restDocToObj(r as { name: string; fields?: Record<string, unknown> }));
    if (hasFacetFilter(f)) acc = acc.filter((d) => matchFacets(d, f));
    let n = 0;
    for (const d of acc) if (textMatcher.phraseMatches(d)) n++;
    return n;
  };
  const cursorOf = (doc: unknown) => {
    const d = doc as { name?: string; fields?: Record<string, unknown> } | null;
    if (!d || typeof d.name !== 'string') return undefined;
    const v = d.fields?.[priceDir || usePriceRange ? 'price' : 'createdAt'];
    if (!v || typeof v !== 'object') return undefined;
    return { values: [v, { referenceValue: d.name }], before: false };
  };
  const runPagedQuery = async (
    useFilters: unknown[],
    into: unknown[],
    countMatches: ((raw: unknown[]) => number) | null
  ): Promise<void> => {
    let startAt: { values: unknown[]; before: boolean } | undefined;
    for (;;) {
      const r = await runQuery(useFilters, startAt);
      const body = await r.json().catch(() => null);
      const page = (Array.isArray(body) ? body : []).filter((x) => x.document);
      for (const row of page) into.push(row.document);
      if (!isTextQuery || page.length < poolLimit) break;
      if (into.length >= SEARCH_TEXT_SCAN_CAP) break;
      if (countMatches && countMatches(into) >= SEARCH_MAX_MATCHES) break;
      startAt = cursorOf(page[page.length - 1].document);
      if (!startAt) break;
    }
  };

  const rawDocs: unknown[] = [];
  let usedFallback = false;
  const earlyStopOk = !!priceDir || !usePriceRange;
  try {
    await runPagedQuery(
      filters,
      rawDocs,
      isTextQuery && earlyStopOk ? countMatchesSoFar : null
    );
  } catch (e) {
    // Missing composite index: fall back to status-only query + client-side filtering
    // (mirrors js/home.js index-error fallback).
    const msg = e instanceof Error ? e.message : '';
    if (!msg.includes('400') && !msg.includes('FAILED_PRECONDITION')) throw e;
    usedFallback = true;
    rawDocs.length = 0;
    await runPagedQuery([filters[0]], rawDocs, null);
  }
  let docs = rawDocs.map((r) =>
    restDocToObj(r as { name: string; fields?: Record<string, unknown> })
  );

  // Round 17 T6: boost verdicts are per-seller and identical for any subset
  // of this pool, so start fetching them as soon as the main query resolves —
  // they overlap the refinements below (CPU work) instead of running after.
  // Same condition and same final partition as before: identical output.
  const needBoost =
    (!f.sort || f.sort === 'recent') && !(f.q && f.q.trim());
  const boostMapP = needBoost
    ? fetchSellerBoostMap(docs.filter((d) => !d.isWanted)).catch(
        () => new Map<string, boolean>()
      )
    : null;

  // Fallback path: apply cat/wilaya/price filters client-side.
  if (usedFallback) {
    docs = docs.filter((d) => {
      if (f.cat && d.categoryId !== f.cat) return false;
      if (f.wilaya && String(d.wilayaCode) !== String(f.wilaya)) return false;
      // 11 Oct 2026: use ordered lo/hi — matches server fix above.
      const cMin = f.min !== undefined && f.min !== '' ? Number(f.min) : undefined;
      const cMax = f.max !== undefined && f.max !== '' ? Number(f.max) : undefined;
      const cLo = cMin !== undefined && cMax !== undefined ? Math.min(cMin, cMax) : cMin;
      const cHi = cMin !== undefined && cMax !== undefined ? Math.max(cMin, cMax) : cMax;
      if (cLo !== undefined && (d.price ?? 0) < cLo) return false;
      if (cHi !== undefined && (d.price ?? 0) > cHi) return false;
      return true;
    });
    // Server orderBy(price) was dropped with the filters — sort client-side.
    if (priceDir) {
      const asc = priceDir === 'ASCENDING';
      docs.sort((a, b) => (asc ? 1 : -1) * ((a.price ?? 0) - (b.price ?? 0)));
    }
  }

  // 12 Oct 2026 (paired with the orderBy fix above): the server ordered by
  // price (range field) so the query is index-servable; restore the default
  // newest-first order here. Skipped when the user explicitly sorts by price
  // (priceDir) — that order is already correct.
  if (!priceDir && usePriceRange) {
    docs.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }

  // HOM-1 (16 Sep 2026, production parity): keep all-wilayas wanted ads
  // (wilayaCode 0) even under a wilaya filter — they are relevant everywhere
  // by definition. (Sale ads can never carry wilayaCode 0: publish + rules
  // forbid it.) Production fetches them in a separate background query and
  // merges; same here.
  if (wantedZeroP) {
    // Round 17 T6: await the pool fired in parallel with the main query
    // above. Merge logic unchanged from the sequential version.
    const wantedZero = await wantedZeroP;
    if (wantedZero.length) {
      const seen = new Set(docs.map((d) => d.id));
      for (const w of wantedZero) {
        if (!seen.has(w.id)) {
          docs.push(w);
          seen.add(w.id);
        }
      }
    }
  }

  // Facet refinement (js/home.js matchFacets, verbatim): the client-side
  // correctness layer under the server plan. Always runs when facets are
  // active — it is a no-op for facets the server already applied exactly,
  // and it covers year/mileage ranges plus the server-ineligible shapes
  // (price sort, price range, missing index fallback).
  if (hasFacetFilter(f)) {
    docs = docs.filter((d) => matchFacets(d, f));
  }

  // Text query: normalized substring match on title/description
  // (js/home.js renderFeed R-9 branch, verbatim logic).
  // R5-1 (18 Oct 2026): Arabic free-text brand search. q=بيجو normalizes to
  // Arabic text that never matches Latin titles (all titles are Latin),
  // so brand queries in Arabic silently returned zero. Apply the same
  // brand mapping the fCarBrand facet uses (normalizeCarBrand): a query
  // token that maps to a cb* key acts as a brand filter, remaining tokens
  // match title/description as before. q=بيجو → all Peugeot; q=بيجو 2016
  // → Peugeot with 2016 in title/desc.
  // R25-1 (24 Oct 2026): the matcher lives in textMatchStage now —
  // shared verbatim with the index replica — and the pool it sees is
  // no longer the 120 newest: the fetch above paginates text queries
  // (SEARCH_TEXT_SCAN_CAP). No slice here — the caller paints.
  if (f.q && f.q.trim()) {
    docs = textMatchStage(docs, f);
  }

  // 0.0.0.39 D-7 parity (Round 164): boosted/pro sellers lead the regular
  // pool when there is no text query and sort is recent. Stable partition —
  // the fetched ranking is preserved inside each group. Live 0.0.0.39
  // verified: `if (!F.q) pool = feedBoostPartition(pool, feedBoostSeller)`
  // inside the sort==='recent' branch. Taste ranking and follow boost stay
  // default-feed-only (production isDefaultFilter parity — NOT applied
  // here), and vitrine showcase cards are also default-feed-only
  // (production insertVitrineCards early-returns on filters).
  // Round 17 T6: the boost-map fetch was kicked off right after the main
  // query resolved; only the await remains here. Same condition as before.
  if (boostMapP) {
    const boostMap = await boostMapP;
    docs = partitionWithBoostMap(docs, boostMap);
  }
  return docs;
}

// Pure partition step (Round 17 T6): boosted/pro
// sellers' listings lead, every other card keeps its relative order.
function partitionWithBoostMap(
  docs: ListingCard[],
  boostMap: Map<string, boolean>
): ListingCard[] {
  const regular = docs.filter((d) => !d.isWanted);
  if (!regular.length) return docs;
  const wanted = docs.filter((d) => d.isWanted);
  const boosted: ListingCard[] = [];
  const rest: ListingCard[] = [];
  for (const d of regular) {
    (boostMap.get(String(d.sellerId || '')) ? boosted : rest).push(d);
  }
  return boosted.concat(rest, wanted);
}

// Batch-fetch seller boost verdicts (storeTier + vitrineBoostUntil) for a
// listing pool via a single :batchGet on users (guest-safe public
// read — same collection the card pro-badges read in card-markers.ts).
// Returns sellerId → boosted/pro.
async function fetchSellerBoostMap(docs: ListingCard[]): Promise<Map<string, boolean>> {
  const sids = [...new Set(docs.map((d) => String(d.sellerId || '')).filter(Boolean))];
  const map = new Map<string, boolean>();
  if (!sids.length) return map;
  const url = FIRESTORE_REST_BASE + ':batchGet?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const nowMs = Date.now();
  // Round 17 T6: chunks of 50 fired in parallel instead of sequentially.
  // Same per-chunk request and same row parsing: identical map.
  const chunks: string[][] = [];
  for (let i = 0; i < sids.length; i += 50) chunks.push(sids.slice(i, i + 50));
  const fetchChunk = async (chunk: string[]): Promise<Array<[string, boolean]>> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documents: chunk.map(
          (id) =>
            `${FIRESTORE_RESOURCE_BASE}/users/${encodeURIComponent(id)}`
        ),
        mask: { fieldPaths: ['storeTier', 'vitrineBoostUntil'] },
      }),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as unknown;
    const out: Array<[string, boolean]> = [];
    for (const row of Array.isArray(body) ? body : []) {
      const found = (row as Record<string, unknown> | null)?.found as
        | { name?: string; fields?: Record<string, unknown> }
        | undefined;
      if (!found) continue;
      const uid = String(found.name || '').split('/').pop() || '';
      if (!uid) continue;
      const fields = found.fields || {};
      const isPro = restValue(fields.storeTier) === 'verified';
      const bu = restValue(fields.vitrineBoostUntil);
      const ms = bu instanceof Date ? bu.getTime() : 0;
      out.push([uid, !!isPro || (ms > nowMs)]);
    }
    return out;
  };
  const chunkResults = await Promise.all(chunks.map(fetchChunk));
  for (const entries of chunkResults) {
    for (const [uid, boosted] of entries) map.set(uid, boosted);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Search pool from the precomputed index (23 Oct 2026, reads-reduction 3).
//
// runSearchPipelineFromIndex reproduces runSearchPipeline EXACTLY over
// the siteStats/search entries (every live listing, CARD_FIELDS
// projection + createdAtRaw, written by the siteStats CF — see
// src/lib/site-stats.ts). Stage correspondence with the live pipeline:
//   1. server filter plan (status is the dataset's membership rule;
//      cat / wilaya / raw price bounds / facet plan when eligible)
//      as in-memory predicates with Firestore semantics over decoded
//      values — strict equality, IN membership, range comparisons in
//      Firestore's total type order (the harness stub's matchFilter is
//      the semantics reference, as for every siteStats package).
//   2. orderBy (price ASC/DESC, price ASC for range shapes, else
//      createdAt DESC) with the orderBy existence rule and the implicit
//      __name__ tiebreak in the order's direction; LIMIT = poolLimit
//      for every mode EXCEPT text queries (R25-1, below).
//   3. price-range newest-first resort (stable, createdAt ms) — verbatim.
//   4. all-wilayas wanted merge: the live path's separate query has no
//      orderBy, i.e. __name__ ASC, limit 100, then the verbatim
//      fetchWantedZeroWilaya client filter — reproduced over entries.
//   5. matchFacets, text match + relevanceRank — the same functions.
//   6. boost partition via partitionWithBoostMap, with verdicts from
//      the index head's precomputed inputs ({t: storeTier, u:
//      vitrineBoostUntilMs}) evaluated against Date.now() exactly as
//      fetchSellerBoostMap evaluates the live :batchGet fields.
// R25-1 (24 Oct 2026) — the text-query reach fix, both paths: stage 5
// used to run over a pool sliced to the 120 newest (stage 2's LIMIT
// here; the LIMIT 120 runQuery there), so any token that was not a
// known brand — model names, sub-brands — could only match the newest
// 120 listings (q=galaxy → 0 of 14, q=sandero → 1 of 27). Now: the
// Round-52 brand IN pre-filter is removed from BOTH paths (it also
// hard-dropped docs whose answers.brand is missing — the gate is
// stage 5's alone, with its title fallback), this replica skips the
// stage-2 LIMIT for text queries and matches over the full candidate
// set (zero added reads — the entries are already in memory), and the
// live path cursor-paginates its filtered query up to
// SEARCH_TEXT_SCAN_CAP docs. The pipelines therefore return identical
// pools whenever the live window covers the matches (always, on the
// harness's corpus); the scan cap is the one documented divergence.
// The ONE stage with no counterpart is the live path's missing-index
// fallback (HTTP 400 → status-only query + client filter): it exists
// only because a live query can be rejected; an in-memory pass cannot
// be. The replica always implements the primary (designed) semantics.
// Entries are never mutated; createdAtRaw is stripped from the output
// (the feed's pattern), so results are indistinguishable from the live
// pool's ListingCards.
// ---------------------------------------------------------------------------

export interface SearchIndexEntry extends ListingCard {
  createdAtRaw?: string | null;
}

export type SearchBoostVerdicts = Record<string, { t?: string; u?: number }>;

// RFC 3339 → [seconds, nanoseconds], or null. Full precision (unlike
// Date's milliseconds) — pool ordering ties break on nanoseconds
// before they break on document id, exactly as in Firestore.
function rawTsKey(raw: unknown): [number, number] | null {
  if (typeof raw !== 'string') return null;
  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/
  );
  if (!m) return null;
  const sec = Math.floor(
    Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) / 1000
  );
  const nanos = m[7] ? Number(m[7].padEnd(9, '0')) : 0;
  return [sec, nanos];
}

function entryTsKey(e: SearchIndexEntry): [number, number] | null {
  const raw = rawTsKey(e.createdAtRaw);
  if (raw) return raw;
  const c = e.createdAt;
  if (c instanceof Date && !isNaN(c.getTime())) {
    const ms = c.getTime();
    return [Math.floor(ms / 1000), (ms % 1000) * 1e6];
  }
  return null;
}

// Firestore's total value order — null < boolean < number < string <
// timestamp — as implemented by the harness stub's cmpVal. A total
// order is load-bearing here: a comparator with mixed-type cycles
// (e.g. comparing a legacy string price against numbers by string
// form) makes sort output depend on input order, which differs
// between a collection scan and the index — the one input-order
// sensitivity the replica must not have.
function searchTypeRank(v: unknown, k: [number, number] | null): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 2;
  if (typeof v === 'string') return 3;
  if (k) return 4;
  return 5;
}

// ASC value comparison mirroring the harness stub's cmpVal:
// timestamps by (seconds, nanoseconds) first, then the total type
// order, then the within-type comparison.
function cmpSearchVal(
  a: unknown,
  b: unknown,
  ka: [number, number] | null,
  kb: [number, number] | null
): number {
  if (ka && kb) return ka[0] - kb[0] || ka[1] - kb[1];
  const ra = searchTypeRank(a, ka);
  const rb = searchTypeRank(b, kb);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function runSearchPipelineFromIndex(
  entries: SearchIndexEntry[],
  boost: SearchBoostVerdicts,
  f: SearchFilters
): ListingCard[] {
  const poolLimit = SEARCH_DEEP_POOL;
  // js/home.js feedShape() deep-pool condition — same expression as
  // fetchSearchPool computes for runSearchPipeline.
  const usePriceRange =
    (f.min !== undefined && f.min !== '') || (f.max !== undefined && f.max !== '');

  // Raw price bounds, NO auto-order (22 Oct 2026 audit R16 — an
  // inverted range matches zero docs, as the live primary query does).
  const pMin = f.min !== undefined && f.min !== '' ? Number(f.min) : undefined;
  const pMax = f.max !== undefined && f.max !== '' ? Number(f.max) : undefined;

  // Facet server plan eligibility — verbatim condition from
  // runSearchPipeline (recent sort, no price range).
  const facetServerEligible = (!f.sort || f.sort === 'recent') && !usePriceRange;

  const answerOf = (d: SearchIndexEntry, k: string): unknown =>
    d.answers && typeof d.answers === 'object'
      ? (d.answers as Record<string, unknown>)[k]
      : undefined;

  // --- stage 1+2: server filter plan, ordering, pool LIMIT ------------
  let docs = entries.filter((d) => {
    // status IN (available, negotiating) is the dataset's membership.
    if (f.cat && d.categoryId !== f.cat) return false;
    if (f.wilaya && d.wilayaCode !== Number(f.wilaya)) return false;
    // Range comparisons follow Firestore's total type order (a legacy
    // string price satisfies >= any number, never <= one) — the stub's
    // matchFilter semantics, via cmpSearchVal.
    if (pMin !== undefined && !(cmpSearchVal(d.price, pMin, null, null) >= 0)) {
      return false;
    }
    if (pMax !== undefined && !(cmpSearchVal(d.price, pMax, null, null) <= 0)) {
      return false;
    }
    if (facetServerEligible) {
      if (f.cat === 'phones') {
        if (f.fOs && answerOf(d, 'os') !== f.fOs) return false;
        if (f.fBrand && answerOf(d, 'brand') !== f.fBrand) return false;
      } else if (f.cat === 'cars') {
        if (f.fCarBrand) {
          const inValues = [f.fCarBrand, ...(CB_TO_LEGACY_BRAND[f.fCarBrand] || [])];
          if (!inValues.includes(answerOf(d, 'brand') as string)) return false;
        }
        if (f.fFuel && answerOf(d, 'fuel') !== f.fFuel) return false;
        if (f.fGear && answerOf(d, 'gear') !== f.fGear) return false;
      }
    }
    // R25-1: no qBrand predicate here — the live path's server IN
    // filter is gone too; stage 5 (makeTextMatcher) owns brand
    // selection, including docs whose answers.brand is missing.
    return true;
  });

  const priceDir =
    f.sort === 'priceAsc' ? 'ASCENDING' : f.sort === 'priceDesc' ? 'DESCENDING' : null;
  const orderField: 'price' | 'createdAt' =
    priceDir || usePriceRange ? 'price' : 'createdAt';
  const descending = priceDir ? priceDir === 'DESCENDING' : !usePriceRange;
  // orderBy existence rule (docs missing the ordered field are excluded).
  docs = docs.filter(
    (d) => (orderField === 'price' ? d.price : d.createdAt) !== undefined
  );
  docs.sort((a, b) => {
    const c =
      orderField === 'createdAt'
        ? cmpSearchVal(a.createdAt, b.createdAt, entryTsKey(a), entryTsKey(b))
        : cmpSearchVal(a.price, b.price, null, null);
    if (c !== 0) return descending ? -c : c;
    const ic = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return descending ? -ic : ic;
  });
  // R25-1 (24 Oct 2026): the pool LIMIT does not apply to text queries
  // — stage 5 matches over the FULL candidate set (zero added reads in
  // memory) and its SEARCH_MAX_MATCHES cap bounds the returned pool
  // exactly as this slice did. Every other mode keeps the slice:
  // structured browsing's 120 cap is a product contract (R21-3).
  if (!(f.q && f.q.trim())) docs = docs.slice(0, poolLimit);

  // --- stage 3: price-range newest-first resort (verbatim) ------------
  if (!priceDir && usePriceRange) {
    docs.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }

  // --- stage 4: all-wilayas wanted merge (verbatim filter) ------------
  if (f.wilaya) {
    const lo = f.min !== undefined && f.min !== '' ? Number(f.min) : -Infinity;
    const hi = f.max !== undefined && f.max !== '' ? Number(f.max) : Infinity;
    const wantedZero = entries
      .filter((d) => d.wilayaCode === 0)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 100)
      .filter((d) => {
        if (!d.isWanted) return false;
        if (f.cat && d.categoryId !== f.cat) return false;
        const p = Number(d.price || 0);
        if (p < lo || p > hi) return false;
        return true;
      });
    if (wantedZero.length) {
      const seen = new Set(docs.map((d) => d.id));
      for (const w of wantedZero) {
        if (!seen.has(w.id)) {
          docs.push(w);
          seen.add(w.id);
        }
      }
    }
  }

  // --- stage 5: facet refinement + text match (same functions) --------
  if (hasFacetFilter(f)) {
    docs = docs.filter((d) => matchFacets(d, f));
  }
  if (f.q && f.q.trim()) {
    // R25-1: the shared matcher (textMatchStage) over the UNSLICED
    // candidate set — see the stage-2 note above.
    docs = textMatchStage(docs, f) as SearchIndexEntry[];
  }

  // --- stage 6: boost partition (verdicts from the index head) --------
  const needBoost = (!f.sort || f.sort === 'recent') && !(f.q && f.q.trim());
  if (needBoost) {
    const nowMs = Date.now();
    const boostMap = new Map<string, boolean>();
    for (const d of docs) {
      if (d.isWanted) continue;
      const sid = String(d.sellerId || '');
      if (!sid || boostMap.has(sid)) continue;
      const v = boost[sid];
      boostMap.set(
        sid,
        !!v && (v.t === 'verified' || (typeof v.u === 'number' && v.u > nowMs))
      );
    }
    docs = partitionWithBoostMap(docs, boostMap) as SearchIndexEntry[];
  }

  // Strip the index-internal cursor field (feed pattern) — output is
  // indistinguishable from the live pool's cards.
  return docs.map((d) => {
    if (!('createdAtRaw' in d)) return d;
    const { createdAtRaw: _raw, ...rest } = d;
    return rest as unknown as ListingCard;
  });
}

// ---------------------------------------------------------------------------
// Search live sliver (23 Oct 2026, reads-reduction 3 — Zak's follow-up
// order «أضف الشريحة الحية أولاً ثم انشر»: the feed hybrid's discipline
// applied to /search, so a just-published listing is findable at once
// instead of at the next CF tick).
//
// When the pool is served from the index, the post-watermark live
// arrivals are ALSO fetched and merged into the entries BEFORE the
// replica runs — an arrival filters / ranks / paginates exactly as if
// the CF had indexed it. The discipline mirrors fetchFeedSliver's:
//   - watermark = the index's newest entry's createdAt, carried as its
//     createdAtRaw string (full RFC 3339 precision end-to-end, so the
//     >= predicate is exact — no coarser clock is involved anywhere:
//     the search head's computedAt is a millisecond Date once decoded
//     and is deliberately NOT used as the watermark, since a watermark
//     rounded to a coarser clock would need a fudge factor to stay
//     gapless);
//   - predicate createdAt >= watermark, i.e. the ENTIRE boundary tie
//     group is re-fetched; dedupe by id with the sliver copy winning
//     (it is also the fresher read of the boundary docs);
//   - ONE bounded runQuery per pool execution (status IN + createdAt
//     >= watermark, createdAt DESC + __name__ DESC, LIMIT
//     SEARCH_SLIVER_LIMIT), issued from inside the caller's 60s pool
//     cache — never per-request uncached;
//   - boost verdicts for the sliver's sellers are resolved live (one
//     :batchGet, distinct sellers only), mirroring the live pipeline's
//     fetchSellerBoostMap; every other seller keeps the head's
//     verdict inputs.
// Read bound per pool execution: ≤ 24 listing reads (the sliver query
// bills the documents it returns) + ≤ 24 user reads (the verdict
// :batchGet over the sliver docs' distinct sellers) = ≤ 48 added reads
// worst case, on top of the pre-existing 1 head probe; typical is 1–6
// (the watermark doc itself + however many ads arrived since the
// tick). Arrivals beyond the newest 24 in one inter-tick window wait
// for the next CF run (the same bounded-burst shape as the feed's).
// Degradation is one-directional: a sliver or verdict failure serves
// the pure index pool — never a full scan, never an error to search.
// Removals / edits of already-indexed docs still land at the next CF
// tick (the accepted precompute trade-off), except the boundary group,
// whose sliver copies are live.
// ---------------------------------------------------------------------------

export const SEARCH_SLIVER_LIMIT = 24;

// The sliver watermark: the newest createdAtRaw among the index
// entries, compared at full (seconds, nanoseconds) precision. Null
// when no entry carries a timestamp — the sliver then runs
// status-only, i.e. it IS the whole live head (the feed's
// empty-corpus branch).
export function searchIndexWatermark(entries: SearchIndexEntry[]): string | null {
  let best: string | null = null;
  let bestKey: [number, number] | null = null;
  for (const e of entries) {
    const k = rawTsKey(e.createdAtRaw);
    if (!k) continue;
    if (
      !bestKey ||
      k[0] > bestKey[0] ||
      (k[0] === bestKey[0] && k[1] > bestKey[1])
    ) {
      bestKey = k;
      best = e.createdAtRaw as string;
    }
  }
  return best;
}

// Post-watermark live arrivals as search index entries — the feed
// sliver's query (fetchFeedSliver, verbatim shape) re-projected to the
// index entry shape. Throws on HTTP failure; the caller degrades to
// the pure index pool.
export async function fetchSearchSliver(
  watermarkRaw: string | null
): Promise<SearchIndexEntry[]> {
  const docs = await fetchFeedSliver(watermarkRaw, SEARCH_SLIVER_LIMIT);
  return docs.map((s) => ({ ...s.doc, createdAtRaw: s.rawTs }));
}

// Fresh boost verdict INPUTS ({t, u}) for the given sellers — the live
// pipeline's :batchGet (same endpoint, same field mask as
// fetchSellerBoostMap), decoded to the search head's input shape
// instead of a pre-evaluated boolean, so the replica's stage 6
// evaluates vitrineBoostUntil expiry against Date.now() exactly as on
// the pure index path. Every requested seller gets an entry: {} when
// its users doc is missing or carries neither input — a definitive
// "not boosted" that overrides a stale head entry. Returns null on
// request failure (caller keeps the head's verdicts).
export async function fetchSellerVerdictInputs(
  sellerIds: string[]
): Promise<SearchBoostVerdicts | null> {
  const sids = [...new Set(sellerIds.filter(Boolean))];
  if (!sids.length) return {};
  const url =
    FIRESTORE_REST_BASE + ':batchGet?key=' + encodeURIComponent(FIREBASE_API_KEY);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documents: sids.map(
          (id) => `${FIRESTORE_RESOURCE_BASE}/users/${encodeURIComponent(id)}`
        ),
        mask: { fieldPaths: ['storeTier', 'vitrineBoostUntil'] },
      }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as unknown;
    const found = new Map<string, Record<string, unknown>>();
    for (const row of Array.isArray(body) ? body : []) {
      const f = (row as Record<string, unknown> | null)?.found as
        | { name?: string; fields?: Record<string, unknown> }
        | undefined;
      if (!f) continue;
      const uid = String(f.name || '').split('/').pop() || '';
      if (uid) found.set(uid, f.fields || {});
    }
    const out: SearchBoostVerdicts = {};
    for (const sid of sids) {
      const fields = found.get(sid);
      const v: { t?: string; u?: number } = {};
      if (fields) {
        // Verbatim input extraction (the CF's extractSellerVerdict
        // shape): t only for a non-empty storeTier string, u as epoch
        // ms from the decoded timestamp.
        const tier = restValue(fields.storeTier);
        if (typeof tier === 'string' && tier !== '') v.t = tier;
        const bu = restValue(fields.vitrineBoostUntil);
        if (bu instanceof Date) v.u = bu.getTime();
      }
      out[sid] = v;
    }
    return out;
  } catch {
    return null;
  }
}

// The index-path pool WITH the live sliver merged (see the block
// header above). All failure modes degrade one-directionally to
// runSearchPipelineFromIndex over the untouched index inputs.
export async function runSearchPipelineFromIndexWithSliver(
  entries: SearchIndexEntry[],
  boost: SearchBoostVerdicts,
  f: SearchFilters
): Promise<ListingCard[]> {
  let sliver: SearchIndexEntry[] | null = null;
  try {
    sliver = await fetchSearchSliver(searchIndexWatermark(entries));
  } catch {
    sliver = null;
  }
  let merged: SearchIndexEntry[] = entries;
  let mergedBoost = boost;
  if (sliver && sliver.length > 0) {
    const sliverIds = new Set(sliver.map((s) => String(s.id)));
    merged = [
      ...sliver,
      ...entries.filter((e) => !sliverIds.has(String(e.id))),
    ];
    const sids = [
      ...new Set(sliver.map((s) => String(s.sellerId || '')).filter(Boolean)),
    ];
    if (sids.length) {
      const fresh = await fetchSellerVerdictInputs(sids).catch(() => null);
      if (fresh) mergedBoost = { ...boost, ...fresh };
    }
  }
  // R26-3: evict sold-since-compute entries BEFORE the pipeline trusts
  // dataset membership (stage 1 never re-checks status).
  const flips = await fetchSoldFlipsSince(searchIndexWatermark(entries));
  merged = evictSoldIds(merged, flips);
  return runSearchPipelineFromIndex(merged, mergedBoost, f);
}

// Helpers for card rendering (mirror client-side formatting)

export function cardTitle(l: ListingCard, lang = 'ar'): string {
  if (l.title && typeof l.title === 'object') {
    return l.title[lang] || l.title.ar || l.title.fr || l.title.en || '';
  }
  // 11 Oct 2026: return string titles as-is (legacy docs store plain strings).
  if (typeof l.title === 'string') return l.title;
  return '';
}

export function cardImage(l: ListingCard): string {
  // Prefer W320 thumbnail (photo_thumbs[0]), fall back to photoUrls[0].
  // Mirrors the 0.0.0.1w R2 client behavior.
  // 12 Oct 2026: rewrite dzdlala.com default ad images to local paths —
  // job/wanted ads store absolute production URLs, which the preview CSP
  // blocks (img-src has no dzdlala.com). Central fix for all card renderers.
  const rewrite = (u: string) =>
    u.replace('https://www.dzdlala.com/img/default_ads/', '/img/default_ads/');
  const thumbs = l.photo_thumbs;
  if (Array.isArray(thumbs) && thumbs[0]) return rewrite(thumbs[0] as string);
  const urls = l.photoUrls;
  if (Array.isArray(urls) && urls[0]) return rewrite(urls[0]);
  const turls = l.thumbUrls;
  if (Array.isArray(turls) && turls[0]) return rewrite(turls[0]);
  return '';
}

export function formatPrice(n: number, lang: string = 'ar'): string {
  if (!isFinite(n)) return '';
  // Zak 18 Oct 2026 (correction): ALWAYS show the literal price, even 1 DZD.
  // The negotiable badge is rendered separately by the UI components.
  // 0.0.0.39 fmtPrice parity: LTR digits with COMMA thousand separators.
  // Currency localized: 'دج' for AR, 'DZD' for FR/EN.
  const currency = lang === 'ar' ? 'دج' : 'DZD';
  return n.toLocaleString('en-US') + ' ' + currency;
}

// --- Announcements (public, read-only) -----------------------------------
// Firestore collection `announcements`. Public list is allowed only with
// where('active','==',true) (security rules v101). Mirrors the exact
// behavior of ~/workspace/dlala-040/js/announcements.js.

export interface Announcement {
  id: string;
  title?: string | Record<string, string>;
  body?: string | Record<string, string>;
  createdAt?: Date;
  active?: boolean;
  link?: string;
}

function restAnnouncement(doc: { name: string; fields?: Record<string, unknown> }): Announcement {
  const o: Record<string, unknown> = { id: doc.name.split('/').pop() as string };
  const fs = doc.fields || {};
  for (const k in fs) o[k] = restValue(fs[k]);
  return o as unknown as Announcement;
}

// Localized map lookup — js/announcements.js annLocalized (verbatim logic):
// explicit string passes through; map prefers the UI language, then ar/fr/en.
// Round 120 restores the dropped `lang` parameter (the port always preferred
// Arabic, so FR/EN users saw Arabic titles even when a localized version existed).
export function annLocalized(map: string | Record<string, string> | undefined, lang: string = 'ar'): string {
  if (!map) return '';
  if (typeof map === 'string') return map;
  const L = lang || 'ar';
  return map[L] || map.ar || map.fr || map.en || '';
}

// Defense in depth: only http(s) URLs become clickable links
// (js/announcements.js annSafeLink, verbatim logic).
export function annSafeLink(url: unknown): string {
  if (typeof url !== 'string') return '';
  const s = url.trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

// Short preview of the body on the card, default 160 chars
// (js/announcements.js annExcerpt, verbatim logic).
export function annExcerpt(body: string, maxLen = 160): string {
  const s = String(body == null ? '' : body);
  const n = typeof maxLen === 'number' && maxLen > 0 ? maxLen : 160;
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+$/, '') + '…';
}

export async function fetchAnnouncements(limit = 50): Promise<Announcement[]> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const baseQuery = {
    from: [{ collectionId: 'announcements' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'active' },
        op: 'EQUAL',
        value: { booleanValue: true },
      },
    },
    limit,
  };
  const doQuery = async (withOrder: boolean): Promise<Announcement[]> => {
    const structuredQuery = withOrder
      ? {
          ...baseQuery,
          orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
        }
      : baseQuery;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = new Error(`announcements-rest-${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const body = await res.json().catch(() => null);
    return (Array.isArray(body) ? body : [])
      .filter((r) => r.document)
      .map((r) => restAnnouncement(r.document));
  };
  try {
    return await doQuery(true);
  } catch (e) {
    // The where+orderBy composite needs a Firestore composite index.
    // Legacy fallback (js/announcements.js annFetch): single-field query +
    // client-side sort by createdAt desc.
    const status = (e as Error & { status?: number }).status;
    if (status === 400) {
      const docs = await doQuery(false);
      const ms = (d?: Date) => (d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0);
      return docs.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    }
    throw e;
  }
}

// Single announcement doc. Callers must check `active === true` before
// rendering (the list rule only ever exposes active docs —
// js/announcement.js loadAnnouncementDetail).
export async function fetchAnnouncement(id: string): Promise<Announcement | null> {
  const url =
    FIRESTORE_REST_BASE + '/announcements/' + encodeURIComponent(id) +
    '?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status === 403) return null;
    throw new Error(`announcement-rest-${res.status}`);
  }
  const doc = await res.json().catch(() => null);
  if (!doc || !doc.fields) return null;
  return restAnnouncement(doc);
}

// Verbatim js/app.js timeAgo (0.0.0.31 FIX-WEB-025 day plurals) — trilingual.
export function timeAgo(d: Date | undefined, lang: Lang = 'ar'): string {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return lang === 'ar' ? 'الآن' : lang === 'fr' ? "à l'instant" : 'now';
  if (mins < 60) return `${mins} ${lang === 'ar' ? 'د' : 'min'}`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ${lang === 'ar' ? 'س' : 'h'}`;
  const days = Math.floor(h / 24);
  if (lang === 'ar') {
    if (days === 1) return 'منذ يوم';
    if (days === 2) return 'منذ يومين';
    if (days <= 10) return `منذ ${days} أيام`;
    return `منذ ${days} يوماً`;
  }
  if (lang === 'fr') return `il y a ${days} j`;
  return `${days}d ago`;
}

// ================= VITRINE SHOWCASES (Round 55) =================
// Ported from ~/workspace/dlala-040/js/home.js (fetchVitrineExtraSellers,
// selectVitrineShowcases, withVitrinePicksBackfilled).
//
// The home feed discovers vitrine-eligible sellers via the dedicated
// `vitrineSellers` collection — NOT by scanning listings. The registry is
// self-maintaining: the vitrine picker upserts/deletes the seller's doc on
// every save (see src/app/vitrine/page.tsx syncVitrineRegistry).

export interface VitrineRegistryEntry {
  sellerId: string;
  storeTier?: string | null;
  vitrineIds?: string[];
  vitrineBoostUntil?: Date | null;
}

export interface VitrineShowcaseData {
  seller: {
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
    vitrineBoostUntil?: Date | null;
  };
  products: ListingCard[];
}

// Fetch all vitrine-eligible sellers from the registry.
// Eligibility: pro stores always; ordinary sellers need an active boost
// AND at least one pick (mirrors js/home.js fetchVitrineExtraSellers).
export async function fetchVitrineRegistry(): Promise<VitrineRegistryEntry[]> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const structuredQuery = {
    from: [{ collectionId: 'vitrineSellers' }],
    select: {
      fields: [
        { fieldPath: 'sellerId' },
        { fieldPath: 'storeTier' },
        { fieldPath: 'vitrineIds' },
        { fieldPath: 'vitrineBoostUntil' },
      ],
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`vitrine-registry-${res.status}`);
  const body = await res.json().catch(() => null);
  const nowMs = Date.now();
  const out: VitrineRegistryEntry[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(body) ? body : []) {
    const f = r?.document?.fields;
    if (!f) continue;
    const sid = String(restValue(f.sellerId) || '');
    if (!sid || seen.has(sid)) continue;
    const isPro = restValue(f.storeTier) === 'verified';
    let eligible = !!isPro;
    if (!eligible) {
      const bu = restValue(f.vitrineBoostUntil);
      const ms = bu instanceof Date ? bu.getTime() : 0;
      const picks = restValue(f.vitrineIds);
      const nPicks = Array.isArray(picks) ? picks.length : 0;
      eligible = !!(ms && ms > nowMs && nPicks > 0);
    }
    if (eligible) {
      seen.add(sid);
      out.push({
        sellerId: sid,
        storeTier: (restValue(f.storeTier) as string) || null,
        vitrineIds: (restValue(f.vitrineIds) as string[]) || [],
        vitrineBoostUntil: (restValue(f.vitrineBoostUntil) as Date) || null,
      });
    }
  }
  return out;
}

// Batch-get listing docs by ID (for vitrine pick backfill).
async function batchGetListings(ids: string[]): Promise<ListingCard[]> {
  if (!ids.length) return [];
  const url =
    FIRESTORE_REST_BASE + ':batchGet?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const docs = ids.slice(0, 100).map(
    (id) => `${FIRESTORE_RESOURCE_BASE}/listings/${encodeURIComponent(id)}`
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documents: docs,
      mask: { fieldPaths: CARD_REST_FIELDS },
    }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`vitrine-batchget-${res.status}`);
  const body = await res.json().catch(() => null);
  const out: ListingCard[] = [];
  for (const r of Array.isArray(body) ? body : []) {
    if (r.found) out.push(restDocToObj(r.found));
  }
  return out;
}

// Fetch full showcase data: registry → public seller profiles → pick listings.
// Returns showcases ready for selectVitrineShowcases() filtering.
export async function fetchVitrineShowcases(): Promise<VitrineShowcaseData[]> {
  const registry = await fetchVitrineRegistry();
  if (!registry.length) return [];

  // Fetch public seller profiles in parallel (best-effort per seller).
  const showcases: VitrineShowcaseData[] = [];
  await Promise.all(
    registry.map(async (entry) => {
      try {
        const profile = await fetchSeller(entry.sellerId);
        if (!profile) return;
        const picks = entry.vitrineIds || [];
        // Fetch pick listings (best-effort: fall back to empty).
        let products: ListingCard[] = [];
        try {
          const fetched = await batchGetListings(picks.slice(0, 8));
          // Only available/negotiating products (legacy parity).
          products = fetched.filter(
            (l) => l.status === 'available' || l.status === 'negotiating'
          );
        } catch {
          products = [];
        }
        // Pro stores with no picks fall back to latest products (legacy FIX 3).
        if (!products.length && entry.storeTier === 'verified') {
          try {
            const latest = await fetchSellerListings(entry.sellerId, 8);
            products = latest.filter(
              (l) => l.status === 'available' || l.status === 'negotiating'
            );
          } catch {
            products = [];
          }
        }
        if (!products.length) return;
        showcases.push({
          seller: {
            id: entry.sellerId,
            name: profile.name,
            storeName: profile.storeName,
            storeTier: profile.storeTier || entry.storeTier || undefined,
            verified: profile.verified,
            emailVerified: profile.emailVerified,
            rating: profile.rating,
            ratingCount: profile.ratingCount,
            followerCount: profile.followerCount,
            vitrineIds: picks,
            vitrineBoostUntil: entry.vitrineBoostUntil,
          },
          products,
        });
      } catch {
        /* per-seller failure must never break the whole showcase fetch */
      }
    })
  );
  return showcases;
}
