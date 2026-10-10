// Server-side Firestore REST client — exact replica of the production
// vanilla-JS logic (js/app.js + js/home.js). Zero behavior drift by design.
//
// Every constant below is copied verbatim from the source of truth:
//   ~/workspace/dlala-040/js/config.js  (FIREBASE_CONFIG)
//   ~/workspace/dlala-040/js/app.js     (FIRESTORE_REST_BASE, CARD_REST_FIELDS,
//                                        restValue, restDocToObj, cardSelectClause)
//   ~/workspace/dlala-040/js/home.js    (buildFeedRestQuery default branch)

const FIREBASE_API_KEY = 'AIzaSyCjll9nUDSbf9h8oS0s9xRyl1S0Qh9qO5M';
const FIRESTORE_REST_BASE =
  'https://firestore.googleapis.com/v1/projects/dlala-85cea/databases/(default)/documents';

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
function buildDefaultFeedQuery(limit: number) {
  return {
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
}

export async function fetchFeed(limit = 24): Promise<ListingCard[]> {
  const url =
    FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: buildDefaultFeedQuery(limit) }),
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
  photoUrl?: string;
  photoPath?: string;
  storeTier?: string;
  storeName?: string;
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

// Seller's active listings — same card projection as the feed, plus a
// sellerId == uid filter. Mirrors the seller.html grid query.
export async function fetchSellerListings(uid: string, limit = 24): Promise<ListingCard[]> {
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
}

// Server-side search: structured Firestore filters + client-side text match
// (mirrors js/home.js renderFeed text-query branch).
export async function searchListings(f: SearchFilters, limit = 24): Promise<ListingCard[]> {
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
  if (f.min !== undefined && f.min !== '') {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'price' }, op: 'GREATER_THAN_OR_EQUAL',
        value: { doubleValue: Number(f.min) },
      },
    });
  }
  if (f.max !== undefined && f.max !== '') {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'price' }, op: 'LESS_THAN_OR_EQUAL',
        value: { doubleValue: Number(f.max) },
      },
    });
  }

  const url = FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
  // Sort: legacy fSort (الأحدث / السعر من الأقل / السعر من الأعلى).
  // A price orderBy with other filters may need a composite index — the
  // index-error fallback below then sorts client-side.
  const priceDir =
    f.sort === 'priceAsc' ? 'ASCENDING' : f.sort === 'priceDesc' ? 'DESCENDING' : null;
  const orderBy = priceDir
    ? [{ field: { fieldPath: 'price' }, direction: priceDir }]
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
          limit: f.q ? 100 : limit, // text query needs a pool to scan
        },
      }),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`search-rest-${r.status}`);
    return r;
  };

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

  // Fallback path: apply cat/wilaya/price filters client-side.
  if (usedFallback) {
    docs = docs.filter((d) => {
      if (f.cat && d.categoryId !== f.cat) return false;
      if (f.wilaya && String(d.wilayaCode) !== String(f.wilaya)) return false;
      if (f.min !== undefined && f.min !== '' && (d.price ?? 0) < Number(f.min)) return false;
      if (f.max !== undefined && f.max !== '' && (d.price ?? 0) > Number(f.max)) return false;
      return true;
    });
    // Server orderBy(price) was dropped with the filters — sort client-side.
    if (priceDir) {
      const asc = priceDir === 'ASCENDING';
      docs.sort((a, b) => (asc ? 1 : -1) * ((a.price ?? 0) - (b.price ?? 0)));
    }
  }

  // Text query: normalized substring match on title/description
  // (js/home.js renderFeed R-9 branch, verbatim logic).
  if (f.q && f.q.trim()) {
    const q = normSearchText(f.q);
    const matched: ListingCard[] = [];
    for (const d of docs) {
      if (matched.length >= 48) break;
      const title = normSearchText(
        d.title && typeof d.title === 'object'
          ? (d.title as Record<string, string>).ar || ''
          : ''
      );
      const desc = normSearchText(d.description?.ar || '');
      if (title.includes(q) || desc.includes(q)) matched.push(d);
    }
    docs = matched.slice(0, limit);
  }
  return docs;
}

// Helpers for card rendering (mirror client-side formatting)

export function cardTitle(l: ListingCard, lang = 'ar'): string {
  if (l.title && typeof l.title === 'object') {
    return l.title[lang] || l.title.ar || l.title.fr || l.title.en || '';
  }
  return '';
}

export function cardImage(l: ListingCard): string {
  // Prefer W320 thumbnail (photo_thumbs[0]), fall back to photoUrls[0].
  // Mirrors the 0.0.0.1w R2 client behavior.
  const thumbs = l.photo_thumbs;
  if (Array.isArray(thumbs) && thumbs[0]) return thumbs[0] as string;
  const urls = l.photoUrls;
  if (Array.isArray(urls) && urls[0]) return urls[0];
  const turls = l.thumbUrls;
  if (Array.isArray(turls) && turls[0]) return turls[0];
  return '';
}

export function formatPrice(n: number): string {
  if (!isFinite(n)) return '';
  // Production format: LTR digits with thousand separators + " دج"
  // (MEMORY.md: never "000150 دج", always "15000 دج").
  return n.toLocaleString('en-US').replace(/,/g, ' ') + ' دج';
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
// explicit string passes through; map prefers Arabic, then fr/en.
export function annLocalized(map: string | Record<string, string> | undefined): string {
  if (!map) return '';
  if (typeof map === 'string') return map;
  return map.ar || map.fr || map.en || '';
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

export function timeAgo(d: Date | undefined, lang = 'ar'): string {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return lang === 'ar' ? 'الآن' : "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return lang === 'ar' ? `منذ ${m} د` : `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === 'ar' ? `منذ ${h} س` : `il y a ${h} h`;
  const days = Math.floor(h / 24);
  return lang === 'ar' ? `منذ ${days} يوم` : `il y a ${days} j`;
}
