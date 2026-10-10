// Store-owner sections — pure logic behind the owner-only boxes on the
// seller page (src/components/StoreAnalytics.tsx,
// src/components/RecentFollowers.tsx). Mirrors js/seller.js verbatim:
//
// - loadStoreAnalytics (16 Sep 2026, pro merchant, private to owner):
//   aggregates views/favorites from the seller's listings + conversation
//   count. 0.0.0.9 (17 Sep 2026): added "new conversations (7d)"
//   (createdAt exists on conversation docs, so the window is honest).
// - loadRecentFollowers / RECENT_FOLLOWERS_N (v101 follow-notif, Zak,
//   16 Sep 2026): latest followers on the OWNER's own profile page —
//   avatar + name, each linking to the follower's profile. Owner-only:
//   the rules grant the followed user (storeId == me) a read path on
//   their own follow docs; visitors never see this section.
//
// Kept DOM-free and React-free so the logic is unit-testable (node harness).

export interface AnalyticsAd {
  id: string;
  title?: unknown;
  views?: unknown;
  favoriteCount?: unknown;
  status?: string;
}

export interface AnalyticsConv {
  /** Milliseconds epoch of conversations.createdAt, or null when unreadable. */
  createdAtMs: number | null;
}

export interface TopProduct {
  id: string;
  title: string;
  views: number;
}

export interface StoreAnalyticsData {
  totalViews: number;
  totalFavs: number;
  totalConvs: number;
  newConvs7d: number;
  top: TopProduct[];
}

// v101 follow-notif: latest-N window for the recent-followers box.
export const RECENT_FOLLOWERS_N = 10;

// js/seller.js loadStoreAnalytics verbatim parity (aggregation + window).
export function computeStoreAnalytics(
  ads: AnalyticsAd[],
  convs: AnalyticsConv[],
  nowMs: number,
  titleOf: (ad: AnalyticsAd) => string
): StoreAnalyticsData {
  const totalViews = ads.reduce((s, l) => s + (Number(l.views) || 0), 0);
  const totalFavs = ads.reduce((s, l) => s + (Number(l.favoriteCount) || 0), 0);
  const weekAgo = nowMs - 7 * 86400000;
  const newConvs7d = convs.filter((c) => (c.createdAtMs || 0) > weekAgo).length;
  const top = ads
    .filter((l) => l.status !== 'sold')
    .sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0))
    .slice(0, 5)
    .map((l) => ({ id: l.id, title: titleOf(l), views: Number(l.views) || 0 }));
  return {
    totalViews,
    totalFavs,
    totalConvs: convs.length,
    newConvs7d,
    top,
  };
}

/** Convert a Firestore createdAt-ish value to ms epoch, or null. */
export function createdAtToMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof (v as { toMillis?: unknown }).toMillis === 'function')
    return (v as { toMillis: () => number }).toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && isFinite(v)) return v;
  return null;
}
