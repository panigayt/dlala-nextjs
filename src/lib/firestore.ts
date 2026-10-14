// Server-side Firestore REST client — exact replica of the production
// vanilla-JS logic (js/app.js + js/home.js). Zero behavior drift by design.
//
// Every constant below is copied verbatim from the source of truth:
//   ~/workspace/dlala-040/js/config.js  (FIREBASE_CONFIG)
//   ~/workspace/dlala-040/js/app.js     (FIRESTORE_REST_BASE, CARD_REST_FIELDS,
//                                        restValue, restDocToObj, cardSelectClause)
//   ~/workspace/dlala-040/js/home.js    (buildFeedRestQuery default branch)

import type { Lang } from './i18n';

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
  'createdAt', 'status', 'isWanted', 'isWholesale', 'sellerId', 'favoriteCount',
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
    FIRESTORE_REST_BASE + '/users_public/' + encodeURIComponent(uid) +
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
    from: [{ collectionId: 'users_public' }],
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

export async function fetchSimilarListings(
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

// --- Category facet filters (phones: OS+brand; cars: brand+fuel+gear+year+mileage) ---
// Verbatim port of js/home.js facet logic (0.0.0.43).

export const FACET_PHONE_BRANDS = [
  'pbApple', 'pbSamsung', 'pbHonor', 'pbHuawei', 'pbXiaomi',
  'pbOppo', 'pbRealme', 'pbInfinix', 'pbTecno', 'pbOther',
];

export const FACET_CAR_BRANDS = [
  'cbRenault', 'cbDacia', 'cbPeugeot', 'cbCitroen', 'cbFiat',
  'cbVolkswagen', 'cbHyundai', 'cbKia', 'cbToyota', 'cbNissan',
  'cbSkoda', 'cbSeat', 'cbOpel', 'cbSuzuki', 'cbAudi', 'cbBmw',
  'cbMercedes', 'cbChery', 'cbGeely', 'cbByd', 'cbOther',
];

// 0.0.0.1l (Zak): brand options follow the selected OS.
export function facetPhoneBrandsForOs(os: string): string[] {
  if (os === 'osIos') return ['pbApple'];
  if (os === 'osAndroid') return FACET_PHONE_BRANDS.filter((b) => b !== 'pbApple');
  return FACET_PHONE_BRANDS;
}

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

// 0.0.0.1z: legacy free-text car brands → cb keys. READ-ONLY normalization:
// unknown values return '' (no guessing) so a brand-filtered search simply
// skips listings it cannot classify instead of showing wrong results.
const LEGACY_CAR_BRAND_MAP: Record<string, string> = {
  renault: 'cbRenault', dacia: 'cbDacia', peugeot: 'cbPeugeot',
  citroen: 'cbCitroen', fiat: 'cbFiat', volkswagen: 'cbVolkswagen', vw: 'cbVolkswagen',
  hyundai: 'cbHyundai', kia: 'cbKia', toyota: 'cbToyota', nissan: 'cbNissan',
  skoda: 'cbSkoda', seat: 'cbSeat', opel: 'cbOpel', suzuki: 'cbSuzuki',
  audi: 'cbAudi', bmw: 'cbBmw', mercedes: 'cbMercedes', mercedesbenz: 'cbMercedes',
  chery: 'cbChery', geely: 'cbGeely', byd: 'cbByd',
  'رونو': 'cbRenault', 'رينو': 'cbRenault',
  'داسيا': 'cbDacia', 'داشيا': 'cbDacia',
  'بيجو': 'cbPeugeot', 'بوجو': 'cbPeugeot',
  'سيتروين': 'cbCitroen', 'ستروين': 'cbCitroen',
  'فيات': 'cbFiat',
  'فولكسفاغن': 'cbVolkswagen', 'فولكسفاجن': 'cbVolkswagen', 'فولكسواجن': 'cbVolkswagen',
  'هيونداي': 'cbHyundai', 'هونداي': 'cbHyundai',
  'كيا': 'cbKia',
  'تويوتا': 'cbToyota', 'طويوطا': 'cbToyota',
  'نيسان': 'cbNissan',
  'سكودا': 'cbSkoda', 'شكودا': 'cbSkoda',
  'سيات': 'cbSeat',
  'اوبل': 'cbOpel',
  'سوزوكي': 'cbSuzuki',
  'اودي': 'cbAudi',
  'بيامدبليو': 'cbBmw',
  'مرسيدس': 'cbMercedes', 'مرسيدسبنز': 'cbMercedes',
  'شيري': 'cbChery',
  'جيلي': 'cbGeely',
  'بيوايدي': 'cbByd',
};

export function normalizeCarBrand(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (s.startsWith('cb')) return FACET_CAR_BRANDS.includes(s) ? s : '';
  const latin = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (latin && LEGACY_CAR_BRAND_MAP[latin]) return LEGACY_CAR_BRAND_MAP[latin];
  const ar = s.replace(/[ً-ٖ]/g, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, '');
  if (ar && LEGACY_CAR_BRAND_MAP[ar]) return LEGACY_CAR_BRAND_MAP[ar];
  return '';
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
function relevanceRank(docs: ListingCard[], q: string): ListingCard[] {
  const qn = normSearchText(q);
  const decorated = new Array<{ d: ListingCard; score: number; ts: number }>(docs.length);
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const title = normSearchText(
      d.title && typeof d.title === 'object'
        ? (d.title as Record<string, string>).ar || ''
        : ''
    );
    const desc = normSearchText(d.description?.ar || '');
    const c = d.createdAt;
    decorated[i] = {
      d,
      score: title === qn ? 100 : title.startsWith(qn) ? 50
        : title.includes(qn) ? 30 : desc.includes(qn) ? 10 : 0,
      ts: c instanceof Date && !isNaN(c.getTime()) ? c.getTime() : 0,
    };
  }
  decorated.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
  const out = new Array<ListingCard>(decorated.length);
  for (let i = 0; i < decorated.length; i++) out[i] = decorated[i].d;
  return out;
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
export const SEARCH_DEEP_POOL = 60;
export const SEARCH_MAX_MATCHES = 60;
export const SEARCH_PAGE_SIZE = 24;

export interface SearchResult {
  listings: ListingCard[];
  // Count of painted cards — legacy resultsMeta semantics:
  // js/home.js setResultsCount(shown.length).
  total: number;
  // Structured-filter mode only: a further page may exist
  // (legacy: moreAvailable = !deepPool && fresh.length === limit).
  hasMore: boolean;
}

// Server-side search: structured Firestore filters + client-side text match
// (mirrors js/home.js renderFeed text-query branch).
export async function searchListingsWithCount(
  f: SearchFilters,
  limit = SEARCH_PAGE_SIZE
): Promise<SearchResult> {
  // js/home.js feedShape(): deep-fetch the pool when the client refines it
  // itself — price range, text query, or facet refinements. Structured
  // filters page server-side (legacy PAGE_SIZE + cursor): fetch one extra
  // row so hasMore mirrors `moreAvailable = fresh.length === limit`.
  const usePriceRange =
    (f.min !== undefined && f.min !== '') || (f.max !== undefined && f.max !== '');
  const deepPool = usePriceRange || !!f.q?.trim() || hasFacetFilter(f);
  const poolLimit = deepPool ? SEARCH_DEEP_POOL : limit + 1;
  const matched = await runSearchPipeline(f, poolLimit, usePriceRange);
  if (deepPool) {
    // Legacy deepPool mode paints every matched doc — no load-more.
    return { listings: matched, total: matched.length, hasMore: false };
  }
  const listings = matched.slice(0, limit);
  // total = painted cards (legacy setResultsCount(shown.length)).
  return { listings, total: listings.length, hasMore: matched.length > limit };
}

// Backward-compatible wrapper — the painted cards only.
export async function searchListings(
  f: SearchFilters,
  limit = SEARCH_PAGE_SIZE
): Promise<ListingCard[]> {
  return (await searchListingsWithCount(f, limit)).listings;
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
    // 11 Oct 2026: auto-order min/max (was missed by the 4d008be fix).
    const lo = f.min !== undefined && f.min !== '' ? Math.min(Number(f.min), Number(f.max || Infinity)) : -Infinity;
    const hi = f.max !== undefined && f.max !== '' ? Math.max(Number(f.min || -Infinity), Number(f.max)) : Infinity;
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
  // 11 Oct 2026: auto-order min/max — user entering max<min got zero results.
  const pMin = f.min !== undefined && f.min !== '' ? Number(f.min) : undefined;
  const pMax = f.max !== undefined && f.max !== '' ? Number(f.max) : undefined;
  const lo = pMin !== undefined && pMax !== undefined ? Math.min(pMin, pMax) : pMin;
  const hi = pMin !== undefined && pMax !== undefined ? Math.max(pMin, pMax) : pMax;
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
  const runQuery = async (useFilters: unknown[]) => {
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

  let res;
  let usedFallback = false;
  try {
    res = await runQuery(filters);
  } catch (e) {
    // Missing composite index: fall back to status-only query + client-side filtering
    // (mirrors js/home.js index-error fallback).
    const msg = e instanceof Error ? e.message : '';
    if (!msg.includes('400') && !msg.includes('FAILED_PRECONDITION')) throw e;
    usedFallback = true;
    res = await runQuery([filters[0]]);
  }
  const body = await res.json().catch(() => null);
  const rawDocs = (Array.isArray(body) ? body : [])
    .filter((r) => r.document)
    .map((r) => r.document);
  let docs = rawDocs.map(restDocToObj);

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
  if (f.q && f.q.trim()) {
    const q = normSearchText(f.q);
    const matched: ListingCard[] = [];
    for (const d of docs) {
      if (matched.length >= SEARCH_MAX_MATCHES) break;
      const title = normSearchText(
        d.title && typeof d.title === 'object'
          ? (d.title as Record<string, string>).ar || ''
          : ''
      );
      const desc = normSearchText(d.description?.ar || '');
      if (title.includes(q) || desc.includes(q)) matched.push(d);
    }
    // FIX-WEB-021: with a text query, relevance leads (exact title first) —
    // recency only breaks ties. Price sorts keep their own order instead
    // (legacy renderFeed sort branch). No slice here — the caller paints.
    docs = (!f.sort || f.sort === 'recent') ? relevanceRank(matched, f.q) : matched;
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
// listing pool via a single :batchGet on users_public (guest-safe public
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
            `${FIRESTORE_RESOURCE_BASE}/users_public/${encodeURIComponent(id)}`
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
    u.replace('https://dzdlala.com/img/default_ads/', '/img/default_ads/');
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
