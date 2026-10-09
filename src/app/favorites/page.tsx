// Favorites page — the user's saved favorite listings.
//
// Migrated from favorites.html + js/favorites.js (production 0.0.0.43).
// Auth-gated: redirects to /auth when signed out.
//
// Behavior preserved:
// - Reads favorites/{uid}/items subcollection (orderBy createdAt desc, 60/page)
// - Hydrates each favorite with its live listing doc
// - Price-drop badge when live price < favorited price
// - Orphan favorites (listing deleted) show a "removed" placeholder
// - Un-favorite removes the fav doc (+ listingFavoriters doc, best-effort)
// - "Shown / total" footer with "show more" pagination
// - Empty state with browse CTA

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import AuthGate, { PageHeader } from '@/components/AuthGate';
import { getFirebase, withTimeout, type CompatUser } from '@/lib/firebase-compat';
import { useLang, type Lang } from '@/lib/i18n';
import { formatPrice } from '@/lib/firestore';

const FAV_PAGE = 60;

interface FavItem {
  listingId: string;
  price?: number;
  createdAt?: unknown;
}

interface LiveListing {
  id: string;
  title?: Record<string, string> | string;
  price?: number;
  photoUrls?: string[];
  thumbUrls?: string[];
  photo_thumbs?: (string | null)[];
  status?: string;
  isWanted?: boolean;
  exists: boolean;
}

interface FavCard {
  fav: FavItem;
  live: LiveListing | null; // null = orphan (listing deleted)
}

function listingTitle(l: LiveListing, lang: Lang): string {
  const t = l.title;
  if (t && typeof t === 'object') return t[lang] || t.ar || t.fr || t.en || '';
  return typeof t === 'string' ? t : '';
}

function listingImg(l: LiveListing): string {
  const thumbs = l.photo_thumbs;
  if (Array.isArray(thumbs) && thumbs[0]) return thumbs[0] as string;
  if (Array.isArray(l.photoUrls) && l.photoUrls[0]) return l.photoUrls[0];
  if (Array.isArray(l.thumbUrls) && l.thumbUrls[0]) return l.thumbUrls[0];
  return '';
}

type DbLike = {
  collection: (p: string) => {
    doc: (id: string) => {
      collection: (p: string) => {
        orderBy: (f: string, d: string) => {
          limit: (n: number) => unknown;
        };
      };
    };
  };
  doc: (p: string) => {
    get: () => Promise<{ exists: boolean; id: string; data: () => Record<string, unknown> }>;
    delete: () => Promise<void>;
    collection: (p: string) => unknown;
  };
};

export default function FavoritesPage() {
  return (
    <AuthGate>
      {(user) => <FavoritesContent user={user} />}
    </AuthGate>
  );
}

function FavoritesContent({ user }: { user: CompatUser }) {
  const { lang, t } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [cards, setCards] = useState<FavCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const cursorRef = useRef<unknown>(null);
  const mounted = useRef(true);

  const hydratePage = useCallback(
    async (db: DbLike, colQuery: unknown): Promise<{ cards: FavCard[]; lastDoc: unknown; full: boolean }> => {
      const q = colQuery as {
        get: () => Promise<{ empty: boolean; size: number; docs: { id: string; data: () => FavItem; ref: unknown }[] }>;
      };
      const snap = await withTimeout(q.get(), 20000);
      const lastDoc = snap.empty ? null : snap.docs[snap.docs.length - 1];
      const hydrated = await Promise.all(
        snap.docs.map(async (d) => {
          const raw = d.data() as FavItem;
          const fav: FavItem = { listingId: String(raw.listingId || ''), price: raw.price, createdAt: raw.createdAt };
          try {
            const l = await withTimeout(db.doc('listings/' + fav.listingId).get(), 15000);
            if (!l.exists) return { fav, live: null };
            const data = l.data() as Record<string, unknown>;
            return {
              fav,
              live: { id: l.id, exists: true, ...data } as LiveListing,
            };
          } catch {
            return { fav, live: null };
          }
        })
      );
      return { cards: hydrated, lastDoc, full: snap.size >= FAV_PAGE };
    },
    []
  );

  const load = useCallback(async () => {
    setError(null);
    cursorRef.current = null;
    try {
      const fb = await getFirebase();
      const db = fb.firestore() as unknown as DbLike & {
        collection: (p: string) => {
          doc: (id: string) => {
            collection: (p: string) => {
              orderBy: (f: string, d: string) => { limit: (n: number) => unknown };
            };
          };
        };
      };
      const col = db.collection('favorites').doc(user.uid).collection('items');
      const q = col.orderBy('createdAt', 'desc').limit(FAV_PAGE);
      const { cards: page, lastDoc, full } = await hydratePage(db, q);
      if (!mounted.current) return;
      cursorRef.current = lastDoc;
      setCards(page);
      setHasMore(full);
    } catch (e) {
      if (!mounted.current) return;
      console.error(e);
      setError(t('errorGeneric'));
    }
  }, [user.uid, t, hydratePage]);

  const loadMore = useCallback(async () => {
    if (!cursorRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const fb = await getFirebase();
      type MoreDb = {
        collection: (p: string) => {
          doc: (id: string) => {
            collection: (p: string) => {
              orderBy: (f: string, d: string) => {
                limit: (n: number) => { startAfter: (c: unknown) => unknown };
              };
            };
          };
        };
      };
      const raw = fb.firestore() as unknown;
      const db = raw as DbLike;
      const mdb = raw as MoreDb;
      const col = mdb.collection('favorites').doc(user.uid).collection('items');
      const q = col.orderBy('createdAt', 'desc').limit(FAV_PAGE).startAfter(cursorRef.current);
      const { cards: page, lastDoc, full } = await hydratePage(db, q);
      if (!mounted.current) return;
      cursorRef.current = lastDoc;
      setCards((prev) => (prev ? [...prev, ...page] : page));
      setHasMore(full);
    } catch (e) {
      console.error(e);
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }, [user.uid, loadingMore, hydratePage]);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetch on mount, guarded by mounted ref */
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const removeFavorite = useCallback(
    async (listingId: string, orphan: boolean) => {
      setRemoving(listingId);
      try {
        const fb = await getFirebase();
        const db = fb.firestore() as unknown as DbLike;
        await withTimeout(db.doc(`favorites/${user.uid}/items/${listingId}`).delete(), 15000);
        // Also delete the listingFavoriters doc (prevents stale price-drop notifications).
        try {
          await withTimeout(db.doc(`listingFavoriters/${listingId}/users/${user.uid}`).delete(), 15000);
        } catch {
          // non-fatal
        }
        if (mounted.current) {
          setCards((prev) => (prev ? prev.filter((c) => c.fav.listingId !== listingId) : prev));
        }
      } catch (e) {
        console.error(e);
        if (mounted.current) window.alert(t('errorGeneric'));
      } finally {
        if (mounted.current) setRemoving(null);
      }
    },
    [user.uid, t]
  );

  return (
    <div className="min-h-screen bg-zinc-50" dir={dir}>
      <PageHeader title={t('favorites')} />

      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-zinc-900 mb-4">{t('favorites')}</h1>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center">
            <p className="text-red-700 mb-4">⚠️ {error}</p>
            <button
              onClick={load}
              className="rounded-lg bg-emerald-700 px-6 py-2.5 font-bold text-white hover:bg-emerald-800"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {!error && cards === null && (
          <div className="text-center py-10">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-700" />
            <p className="mt-3 text-zinc-600">{t('loading')}</p>
          </div>
        )}

        {!error && cards !== null && cards.length === 0 && (
          <div className="rounded-xl bg-white shadow-sm p-10 text-center">
            <p className="text-5xl mb-4">♥</p>
            <p className="text-zinc-900 font-medium mb-1">{t('noFavorites')}</p>
            <p className="text-zinc-500 text-sm mb-5">{t('noFavoritesHint')}</p>
            <Link
              href="/"
              className="inline-block rounded-lg bg-emerald-700 px-6 py-2.5 font-bold text-white hover:bg-emerald-800"
            >
              {t('browseAds')}
            </Link>
          </div>
        )}

        {!error && cards !== null && cards.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {cards.map(({ fav, live }) => {
                const lid = fav.listingId;
                const busy = removing === lid;
                if (!live) {
                  // Orphan: listing was deleted — show placeholder with remove control.
                  return (
                    <div key={lid} className="relative rounded-xl bg-white shadow-sm overflow-hidden">
                      <div className="p-6 text-center">
                        <p className="text-3xl mb-2">🗑️</p>
                        <p className="text-sm text-zinc-500">{t('favListingRemoved')}</p>
                      </div>
                      <button
                        onClick={() => removeFavorite(lid, true)}
                        disabled={busy}
                        aria-label={t('removeFavorite')}
                        title={t('removeFavorite')}
                        className="absolute top-2 end-2 w-9 h-9 rounded-full bg-black/60 text-white text-base disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </div>
                  );
                }
                const img = listingImg(live);
                const base = Number(fav.price || 0);
                const dropped = live.status !== 'sold' && base > 0 && Number(live.price || 0) < base;
                return (
                  <div key={lid} className="relative">
                    <a
                      href={`/listing/${live.id}`}
                      className="block rounded-xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
                    >
                      <div className="relative aspect-[4/3] bg-zinc-100">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt={listingTitle(live, lang)} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
                        )}
                        {dropped && (
                          <span className="absolute top-2 start-2 rounded bg-red-600 text-white text-xs px-2 py-1 font-bold">
                            ▼ {t('priceDropped')}
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="font-bold text-emerald-700">{formatPrice(live.price || 0)}</p>
                        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">{listingTitle(live, lang)}</h3>
                      </div>
                    </a>
                    <button
                      onClick={() => removeFavorite(lid, false)}
                      disabled={busy}
                      aria-label={t('removeFavorite')}
                      title={t('removeFavorite')}
                      className="absolute top-2 end-2 w-9 h-9 rounded-full bg-black/60 text-white text-base disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 text-center">
              <p className="text-sm text-zinc-500 mb-3">
                {cards.length}
              </p>
              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-lg bg-emerald-700 px-6 py-2.5 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {loadingMore ? '…' : t('loadMore')}
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
