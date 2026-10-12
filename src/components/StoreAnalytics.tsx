// Store analytics box — owner-only, pro merchants only.
// Port of js/seller.js loadStoreAnalytics (16 Sep 2026) + renderSellerExtras
// (0.0.0.4): the box lives in the Infos tab for pro owners. Aggregates
// views/favorites from the seller's listings + conversation count, with the
// 0.0.0.9 "new conversations (7d)" window and the top-5 products by views.
//
// Visibility rules (legacy verbatim):
// - visitors and non-owners: renders nothing
// - non-pro owners: renders nothing (analytics is a pro-merchant feature)

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthState } from '@/lib/firebase-client';
import { useLang, type Lang } from '@/lib/i18n';
// 11 Oct 2026: withTimeout now in @/lib/timeout — no firebase-compat import.
import { withTimeout } from '@/lib/timeout';
import { localizedTitle } from '@/lib/ratings';
import {
  computeStoreAnalytics,
  createdAtToMs,
  type AnalyticsAd,
  type StoreAnalyticsData,
} from '@/lib/store-owner';

const STRINGS: Record<Lang, Record<string, string>> = {
  ar: {
    storeAnalyticsTitle: 'إحصائيات المتجر',
    analyticsViews: 'مشاهدات',
    analyticsFavorites: 'مفضلات',
    analyticsConversations: 'محادثات',
    analyticsNewConversations: 'محادثات جديدة (7 أيام)',
    analyticsTopProducts: 'أفضل المنتجات',
    loading: 'جارٍ التحميل...',
    errorGeneric: 'حدث خطأ — حاول مجدداً',
  },
  fr: {
    storeAnalyticsTitle: 'Statistiques de la boutique',
    analyticsViews: 'Vues',
    analyticsFavorites: 'Favoris',
    analyticsConversations: 'Conversations',
    analyticsNewConversations: 'Nouvelles conversations (7 j)',
    analyticsTopProducts: 'Meilleurs produits',
    loading: 'Chargement...',
    errorGeneric: 'Une erreur est survenue — réessayez',
  },
  en: {
    storeAnalyticsTitle: 'Store analytics',
    analyticsViews: 'Views',
    analyticsFavorites: 'Favorites',
    analyticsConversations: 'Conversations',
    analyticsNewConversations: 'New conversations (7d)',
    analyticsTopProducts: 'Top products',
    loading: 'Loading...',
    errorGeneric: 'Something went wrong — try again',
  },
};

export default function StoreAnalytics({
  uid,
  isPro,
}: {
  uid: string;
  isPro: boolean;
}) {
  const auth = useAuthState();
  const { lang } = useLang();
  const STR = STRINGS[lang] || STRINGS.ar;
  const [data, setData] = useState<StoreAnalyticsData | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);

  const signedIn = auth.status === 'signed-in';
  const user = signedIn ? auth.user : null;
  const client = signedIn ? auth.client : null;
  const isOwner = !!(user && user.uid === uid);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // js/seller.js: auth-dependent bits load when authReady resolves.
  useEffect(() => {
    if (!isPro || !isOwner || !user || !client) return;
    let cancelled = false;
    (async () => {
      try {
        const [adsSnap, convSnap] = await Promise.all([
          withTimeout(
            client.db.collection('listings').where('sellerId', '==', uid).get(),
            15000
          ),
          withTimeout(
            client.db
              .collection('conversations')
              .where('participants', 'array-contains', uid)
              .get(),
            15000
          ),
        ]);
        const ads: AnalyticsAd[] = [];
        adsSnap.forEach((d) => {
          const l = (d.data() || {}) as Record<string, unknown>;
          ads.push({
            id: d.id,
            title: l.title,
            views: l.views,
            favoriteCount: l.favoriteCount,
            status: typeof l.status === 'string' ? l.status : '',
          });
        });
        const convs: { createdAtMs: number | null }[] = [];
        convSnap.forEach((d) => {
          const c = (d.data() || {}) as Record<string, unknown>;
          convs.push({ createdAtMs: createdAtToMs(c.createdAt) });
        });
        const computed = computeStoreAnalytics(ads, convs, Date.now(), (ad) =>
          localizedTitle(ad.title)
        );
        if (!cancelled && mounted.current) setData(computed);
      } catch {
        if (!cancelled && mounted.current) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPro, isOwner, user, client, uid]);

  // Legacy: the box only exists for pro owners.
  if (!isPro) return null;
  if (auth.status === 'loading') return null;
  if (!isOwner) return null;

  if (failed)
    return (
      <div className="alert alert-error" style={{ marginTop: 16 }}>
        {STR.errorGeneric}
      </div>
    );
  if (!data)
    return (
      <div className="spinner" style={{ marginTop: 16 }}>
        {STR.loading}
      </div>
    );

  return (
    <div className="acc-section" style={{ marginTop: 16 }}>
      <h3 className="acc-h">📊 {STR.storeAnalyticsTitle}</h3>
      <div className="analytics-grid">
        <div className="analytics-card">
          <div className="analytics-num">{data.totalViews}</div>
          <div className="analytics-label">{STR.analyticsViews}</div>
        </div>
        <div className="analytics-card">
          <div className="analytics-num">{data.totalFavs}</div>
          <div className="analytics-label">{STR.analyticsFavorites}</div>
        </div>
        <div className="analytics-card">
          <div className="analytics-num">{data.totalConvs}</div>
          <div className="analytics-label">{STR.analyticsConversations}</div>
        </div>
        <div className="analytics-card">
          <div className="analytics-num">{data.newConvs7d}</div>
          <div className="analytics-label">{STR.analyticsNewConversations}</div>
        </div>
      </div>
      {data.top.length > 0 && (
        <>
          <h4 style={{ margin: '12px 0 8px' }}>{STR.analyticsTopProducts}</h4>
          <div className="analytics-top">
            {data.top.map((l) => (
              <Link
                key={l.id}
                className="analytics-top-item"
                href={`/listing/${encodeURIComponent(l.id)}`}
              >
                <span className="analytics-top-title">{l.title}</span>
                <span className="analytics-top-views">👁 {l.views}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
