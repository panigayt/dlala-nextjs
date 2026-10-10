// Live price-guide stats — server-side Firestore aggregation for the
// dynamic price guide (Zak's 27 Sep 2026 «يجب ان يكون تلقائيا» spec).
//
// Port of the guides Cloud Function's getPriceStats(): listings where
// status == 'available' and categoryId == 'cars', newest first, limit
// 10000, then aggregateModelPrices() with the vehicle-placeholder ceiling
// (FIX-FN-009).
//
// Kept in its own module because 'use cache' + next/cache cannot be
// imported in the node differential test (pure functions live in
// ./price-guide.ts). Caching mirrors the function (1h in-memory +
// 1h HTTP): 'use cache' + cacheLife('hours') is the Next 16
// (cacheComponents) pattern already used by src/app/sitemap.ts.

import { cacheLife } from 'next/cache';

import { FIREBASE_API_KEY, FIRESTORE_REST_BASE } from './firestore';
import {
  aggregateModelPrices,
  type PriceListing,
  type PriceRow,
  type PriceStats,
} from './price-guide';

export type { PriceRow, PriceStats };

// Decode the three fields the aggregation needs (price, answers, title)
// from a Firestore REST document. Minimal local decoder — the full
// restValue/restDocToObj in ./firestore.ts are module-private.
function decodeRestValue(v: unknown): unknown {
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
    return (av.values || []).map(decodeRestValue);
  }
  if ('mapValue' in o) {
    const out: Record<string, unknown> = {};
    const fs = (o.mapValue as { fields?: Record<string, unknown> }).fields || {};
    for (const k in fs) out[k] = decodeRestValue(fs[k]);
    return out;
  }
  return null;
}

export async function getPriceStats(): Promise<PriceStats> {
  'use cache';
  cacheLife('hours');
  try {
    const url = FIRESTORE_REST_BASE + ':runQuery?key=' + encodeURIComponent(FIREBASE_API_KEY);
    // CF parity: status == 'available', categoryId == 'cars',
    // orderBy createdAt desc, limit 10000. Field mask keeps the payload
    // small (price + answers + title are all the aggregation reads).
    const structuredQuery = {
      from: [{ collectionId: 'listings' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'available' } } },
            { fieldFilter: { field: { fieldPath: 'categoryId' }, op: 'EQUAL', value: { stringValue: 'cars' } } },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      select: { fields: [{ fieldPath: 'price' }, { fieldPath: 'answers' }, { fieldPath: 'title' }] },
      limit: 10000,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`price-stats-rest-${res.status}`);
    const body = await res.json().catch(() => null);
    const docs = (Array.isArray(body) ? body : [])
      .filter((r) => r.document)
      .map((r) => r.document);
    const listings: PriceListing[] = docs.map((d) => {
      const fs = (d.fields || {}) as Record<string, unknown>;
      return {
        price: decodeRestValue(fs.price),
        answers: (decodeRestValue(fs.answers) as Record<string, unknown>) || {},
        title: decodeRestValue(fs.title),
      };
    });
    // FIX-FN-009: this IS a vehicle guide — apply the 10,000 DZD
    // placeholder ceiling ("call me" convention) on top of the 1-DZD
    // sentinel exclusion.
    const rows = aggregateModelPrices(listings, { vehiclePlaceholders: true });
    return {
      ok: true,
      rows,
      totalAds: listings.length,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('price guide fetch failed:', e);
    return { ok: false, rows: [], totalAds: 0, fetchedAt: null };
  }
}
