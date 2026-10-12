// Favorites page — the user's saved favorite listings.
//
// Migrated from favorites.html + js/favorites.js (production 0.0.0.43).
// Auth-gated: redirects to /auth when signed out.
//
// Behavior preserved:
// - Reads favorites/{uid}/items subcollection (orderBy createdAt desc, 60/page)
// - Hydrates each favorite with its live listing doc
// - Price-drop badge when live price < favorited price
// - Orphan favorites (listing read succeeded and doc does NOT exist) show a
//   "removed" placeholder — shown ONLY when the doc definitively doesn't exist.
// - Unreadable listings (read failed: timeout/network/permission) show a
//   per-card error with retry, NEVER the "removed" placeholder (Round 30).
// - F7 (legacy sweep): if EVERY hydration fails on first load, the page shows
//   a full-page error state with retry — never a misleading empty/removed state.
// - Un-favorite removes the fav doc (+ listingFavoriters doc, best-effort)
// - "Shown / total" footer with "show more" pagination
// - Empty state with browse CTA

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import AuthGate from '@/components/AuthGate';
// 12 Oct 2026 (Round 12): migrated to the modular Firebase SDK
// (@/lib/firebase; firebase-compat users → getFirebaseBundled()). The lazy
// dynamic import('@/lib/firebase') at each usage site keeps the SDK off the
// initial chunk (topology preserved). AuthGate still passes the old compat
// user type, so the user prop takes the minimal structural shape both the
// old CompatUser and the modular User satisfy (only uid is used).
import type {
  FirebaseDb,
  FirebaseDocSnap,
  FirebaseModules,
  FirebaseQuery,
} from '@/lib/firebase';
import { withTimeout } from '@/lib/timeout';
import { useLang, type Lang } from '@/lib/i18n';
import { formatPrice } from '@/lib/firestore';
import { snapshotRead, snapshotWrite, snapMs } from '@/lib/snapshot';

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
  // Carried at runtime via the ...data spread in hydratePage; declared here
  // so the favorites instant-paint snapshot (js/snapshot.js + js/favorites.js
  // favCardSnapshot parity) can project them with types instead of casts.
  categoryId?: string;
  category?: string;
  wilayaCode?: number;
  previousPrice?: number;
  priceReduced?: boolean;
  sellerId?: string;
  isWholesale?: boolean;
  createdAt?: unknown;
}

type CardStatus = 'ok' | 'deleted' | 'failed';

// Projection of a hydrated favorite for the instant-paint snapshot —
// verbatim port of js/favorites.js favCardSnapshot: everything
// favCardHtml/listingCard reads, nothing more. Also the projection
// tasteReadFavs (@/lib/taste) reads for personalization signals (it reads
// a subset of these fields).
function favCardSnapshot(live: LiveListing, fav: FavItem) {
  return {
    live: {
      id: String(live.id || ''),
      title: live.title || '',
      price: Number(live.price) || 0,
      photoUrls: (live.photoUrls || []).slice(0, 2),
      thumbUrls: (
        (live.photo_thumbs && live.photo_thumbs.length
          ? live.photo_thumbs
          : live.thumbUrls) || []
      ).slice(0, 2),
      status: String(live.status || ''),
      categoryId: String(live.categoryId || live.category || ''),
      wilayaCode: Number(live.wilayaCode) || 0,
      createdAt: snapMs(live.createdAt),
      previousPrice: Number(live.previousPrice) || 0,
      priceReduced: !!live.priceReduced,
      sellerId: String(live.sellerId || ''),
      isWholesale: !!live.isWholesale,
      isWanted: !!live.isWanted,
    },
    fav: {
      listingId: String(fav.listingId || live.id || ''),
      price: Number(fav.price || 0),
    },
  };
}

// 0.0.0.22 (Zak): instant paint — last favorites from localStorage, before
// the SDKs/auth/network. The page then refreshes silently in the background.
function paintFavSnapshot(): FavCard[] | null {
  const snap = snapshotRead<{ cards?: { live?: Record<string, unknown>; fav?: Record<string, unknown> }[] }>(
    'favorites'
  );
  if (!snap || !snap.data || !Array.isArray(snap.data.cards) || !snap.data.cards.length)
    return null;
  try {
    const cards: FavCard[] = snap.data.cards
      .filter((c) => c && c.live && c.fav)
      .map((c) => ({
        fav: {
          listingId: String(c.fav!.listingId || ''),
          price: Number(c.fav!.price || 0),
        },
        live: { ...(c.live as Record<string, unknown>), exists: true } as LiveListing,
        status: 'ok' as const,
      }));
    return cards.length ? cards : null;
  } catch {
    return null;
  }
}

interface FavCard {
  fav: FavItem;
  live: LiveListing | null; // only set when status === 'ok'
  status: CardStatus;
  // 'deleted' = the listing read SUCCEEDED and the doc does not exist (true orphan).
  // 'failed'  = the listing read FAILED (timeout/network/permission) — never
  //             render the "removed" placeholder for these; they get a retry card.
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

export default function FavoritesPage() {
  return (
    <AuthGate>
      {(user) => <FavoritesContent user={user} />}
    </AuthGate>
  );
}

function FavoritesContent({ user }: { user: { uid: string } }) {
  const { lang, t } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [cards, setCards] = useState<FavCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  // 12 Oct 2026: per-card remove error feedback (was silent console.error).
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  // Pagination cursor: the last QueryDocumentSnapshot of the previous page.
  // Modular fsMod.startAfter(snapshot) accepts a DocumentSnapshot — same
  // semantics as the old compat .startAfter(docSnap) on this query shape
  // (orderBy createdAt desc on the same subcollection).
  const cursorRef = useRef<FirebaseDocSnap | null>(null);
  const mounted = useRef(true);
  // 0.0.0.22 (Zak): instant paint — a snapshot already painted stays and
  // the live load refreshes silently (no spinner flash).
  const paintedFromCacheRef = useRef(false);

  const hydratePage = useCallback(
    async (
      db: FirebaseDb,
      fsMod: FirebaseModules['fs'],
      colQuery: FirebaseQuery
    ): Promise<{ cards: FavCard[]; lastDoc: FirebaseDocSnap | null; full: boolean }> => {
      const snap = await withTimeout(fsMod.getDocs(colQuery), 20000);
      const lastDoc = snap.empty ? null : snap.docs[snap.docs.length - 1];
      const hydrated: FavCard[] = await Promise.all(
        snap.docs.map(async (d) => {
          const raw = d.data() as FavItem;
          const fav: FavItem = { listingId: String(raw.listingId || ''), price: raw.price, createdAt: raw.createdAt };
          try {
            const l = await withTimeout(fsMod.getDoc(fsMod.doc(db, 'listings/' + fav.listingId)), 15000);
            // Distinguish "deleted" (read succeeded, doc absent) from
            // "unreadable" (read failed — caught below). A failed read must
            // NEVER render as a "removed" placeholder (Round 30).
            if (!l.exists()) return { fav, live: null, status: 'deleted' };
            const data = l.data() as Record<string, unknown>;
            return {
              fav,
              live: { id: l.id, exists: true, ...data } as LiveListing,
              status: 'ok' as const,
            };
          } catch {
            return { fav, live: null, status: 'failed' as const };
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
      const { getFirebaseBundled } = await import('@/lib/firebase');
      const { db, fsMod } = await getFirebaseBundled();
      const q = fsMod.query(
        fsMod.collection(db, 'favorites', user.uid, 'items'),
        fsMod.orderBy('createdAt', 'desc'),
        fsMod.limit(FAV_PAGE)
      );
      const { cards: page, lastDoc, full } = await hydratePage(db, fsMod, q);
      if (!mounted.current) return;
      // F7 (legacy sweep): if EVERY hydration failed on first load, that is a
      // full-page error state — never show the misleading "no favorites" empty
      // state (and never the "removed" placeholders).
      if (page.length > 0 && page.every((c) => c.status === 'failed')) {
        setError(t('errorGeneric'));
        return;
      }
      cursorRef.current = lastDoc;
      setCards(page);
      // js/favorites.js 0.0.0.22 + js/snapshot.js: save the first page so
      // the next boot paints instantly (instant paint), and so the taste
      // personalization (tasteReadFavs in @/lib/taste) sees the favorites'
      // category/price/wilaya signals. One key, one write, both consumers —
      // the taste projection is a subset of this render projection (same
      // key, envelope {v:1, ts, data} and 10-minute TTL contract as legacy).
      try {
        const snapPairs = page
          .filter((c) => c.status === 'ok' && c.live)
          .map((c) => favCardSnapshot(c.live!, c.fav));
        // 11 Oct 2026: always write (even empty) — stale snapshot repainted deleted favorites.
        snapshotWrite('favorites', user.uid, { cards: snapPairs });
      } catch {
        /* best-effort — the live path still works */
      }
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
      const { getFirebaseBundled } = await import('@/lib/firebase');
      const { db, fsMod } = await getFirebaseBundled();
      // startAfter with the previous page's last DocumentSnapshot — modular
      // equivalent of the old compat .startAfter(docSnap): extracts the
      // orderBy field values from the snapshot (same subcollection, same
      // orderBy shape, so the cursor is valid).
      const q = fsMod.query(
        fsMod.collection(db, 'favorites', user.uid, 'items'),
        fsMod.orderBy('createdAt', 'desc'),
        fsMod.limit(FAV_PAGE),
        fsMod.startAfter(cursorRef.current)
      );
      const { cards: page, lastDoc, full } = await hydratePage(db, fsMod, q);
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
    // 0.0.0.22 (Zak): paint the last good render synchronously, before the
    // SDKs/auth/network. load() then refreshes silently in the background.
    try {
      const cached = paintFavSnapshot();
      if (cached) {
        setCards(cached);
        paintedFromCacheRef.current = true;
      }
    } catch {
      /* fall through to the live path */
    }
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // Per-card hydration retry (Round 30): re-reads a single listing doc. If the
  // doc now reads and doesn't exist, the card flips to the orphan placeholder;
  // if it reads and exists, it becomes a normal card.
  const retryCard = useCallback(
    async (listingId: string) => {
      setRetrying(listingId);
      try {
        const { getFirebaseBundled } = await import('@/lib/firebase');
        const { db, fsMod } = await getFirebaseBundled();
        const l = await withTimeout(fsMod.getDoc(fsMod.doc(db, 'listings/' + listingId)), 15000);
        if (!mounted.current) return;
        if (!l.exists()) {
          setCards((prev) =>
            prev ? prev.map((c) => (c.fav.listingId === listingId ? { ...c, status: 'deleted' as const } : c)) : prev
          );
        } else {
          const data = l.data() as Record<string, unknown>;
          setCards((prev) =>
            prev
              ? prev.map((c) =>
                  c.fav.listingId === listingId
                    ? { fav: c.fav, live: { id: l.id, exists: true, ...data } as LiveListing, status: 'ok' as const }
                    : c
                )
              : prev
          );
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted.current) setRetrying(null);
      }
    },
    []
  );

  const removeFavorite = useCallback(
    async (listingId: string) => {
      setRemoving(listingId);
      setRemoveErr(null); // clear previous error on retry
      try {
        const { getFirebaseBundled } = await import('@/lib/firebase');
        const { db, fsMod } = await getFirebaseBundled();
        // 11 Oct 2026: atomic batch — prevents orphan listingFavoriters docs
        // (which caused phantom price-drop notifications).
        const batch = fsMod.writeBatch(db);
        batch.delete(fsMod.doc(db, `favorites/${user.uid}/items/${listingId}`));
        batch.delete(fsMod.doc(db, `listingFavoriters/${listingId}/users/${user.uid}`));
        await withTimeout(batch.commit(), 15000);
        // 11 Oct 2026: REMOVED tasteNoteFav — it recorded an ADD signal on remove,
        // polluting the taste profile with unfavorited listings.
        if (mounted.current) {
          setCards((prev) => (prev ? prev.filter((c) => c.fav.listingId !== listingId) : prev));
        }
      } catch (e) {
        console.error(e);
        // 11 Oct 2026: don't nuke the grid on single-card remove failure.
        // The card stays; user can retry by tapping ✕ again.
        // (was setError → full-page error wiped all cards.)
        // 12 Oct 2026: show per-card error feedback (was silent).
        if (mounted.current) setRemoveErr(listingId);
      } finally {
        if (mounted.current) setRemoving(null);
      }
    },
    [user.uid, t]
  );

  return (
    <div className="min-h-screen bg-zinc-50" dir={dir}>

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
              {cards.map(({ fav, live, status }) => {
                const lid = fav.listingId;
                const busy = removing === lid;
                if (status === 'failed') {
                  // Read failed (timeout/network/permission): per-card error
                  // state with retry — NEVER the "removed" placeholder.
                  const retryBusy = retrying === lid;
                  return (
                    <div key={lid} className="relative rounded-xl bg-white shadow-sm overflow-hidden">
                      <div className="p-6 text-center">
                        <p className="text-3xl mb-2">⚠️</p>
                        <p className="text-sm text-zinc-500 mb-3">{t('favCardLoadFailed')}</p>
                        <button
                          onClick={() => retryCard(lid)}
                          disabled={retryBusy}
                          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {retryBusy ? '…' : t('retry')}
                        </button>
                      </div>
                    </div>
                  );
                }
                if (status === 'deleted' || !live) {
                  // Orphan: the read SUCCEEDED and the doc does not exist —
                  // only this case shows the "removed" placeholder.
                  return (
                    <div key={lid} className="relative rounded-xl bg-white shadow-sm overflow-hidden">
                      <div className="p-6 text-center">
                        <p className="text-3xl mb-2">🗑️</p>
                        <p className="text-sm text-zinc-500">{t('favListingRemoved')}</p>
                      </div>
                      <button
                        onClick={() => removeFavorite(lid)}
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
                        <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
                        {img && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt={listingTitle(live, lang)} loading="lazy" className="absolute inset-0 w-full h-full object-cover"
                            // 12 Oct 2026: hide broken image so the 📷 placeholder shows (was broken-image icon).
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        )}
                        {dropped && (
                          <span className="absolute top-2 start-2 rounded bg-red-600 text-white text-xs px-2 py-1 font-bold">
                            ▼ {t('priceDropped')}
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="font-bold text-emerald-700">{formatPrice(live.price || 0, lang)}</p>
                        <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">{listingTitle(live, lang)}</h3>
                      </div>
                    </a>
                    <button
                      onClick={() => removeFavorite(lid)}
                      disabled={busy}
                      aria-label={t('removeFavorite')}
                      title={t('removeFavorite')}
                      className="absolute top-2 end-2 w-9 h-9 rounded-full bg-black/60 text-white text-base disabled:opacity-50"
                    >
                      ✕
                    </button>
                    {removeErr === lid && (
                      <p className="absolute bottom-2 start-2 end-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                        {t('errorGeneric')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 text-center">
              <p className="text-sm text-zinc-500 mb-3">
                {t('favorites')}: {cards.length}
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
