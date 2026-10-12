// My Listings page — the seller's own ads with edit / mark-sold / delete.
//
// Migrated from my-listings.html + js/my-listings.js (production 0.0.0.43).
// Auth-gated: redirects to /auth when signed out.
//
// Behavior preserved:
// - Lists own listings (sellerId == uid, orderBy createdAt desc, limit 60)
// - Edit button → /publish?edit={id} (publish page handles the edit flow)
// - Mark-sold button (with confirm dialog) → status='sold' (final, no undo)
// - Delete button (with confirm) → audit doc + delete + Storage cleanup
// - Email-verification banner for unverified users
// - Empty state with "publish" CTA
//
// Round 12: Firebase compat SDK → modular (getFirebaseBundled path).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AuthGate from '@/components/AuthGate';
import { getFirebaseBundled, type CompatUser } from '@/lib/firebase';
import { withTimeout } from '@/lib/timeout';
import { useLang, type Lang } from '@/lib/i18n';
import { formatPrice } from '@/lib/firestore';
import { deleteR2Objects } from '@/lib/r2-upload';
import { snapshotRead, snapshotWrite, snapMs } from '@/lib/snapshot';

interface OwnListing {
  id: string;
  title?: Record<string, string> | string;
  price?: number;
  // 11 Oct 2026: answers for job salary display (was 0 DZD on job cards).
  answers?: { jobType?: string; salary?: number };
  photoUrls?: string[];
  thumbUrls?: string[];
  photo_thumbs?: (string | null)[];
  status?: string;
  categoryId?: string;
  wilayaCode?: number;
  createdAt?: { toDate?: () => Date } | Date;
  previousPrice?: number;
  priceReduced?: boolean;
  sellerId?: string;
  isWholesale?: boolean;
  isWanted?: boolean;
}

function listingTitle(l: OwnListing, lang: Lang): string {
  const t = l.title;
  if (t && typeof t === 'object') return t[lang] || t.ar || t.fr || t.en || '';
  return typeof t === 'string' ? t : '';
}

function listingImg(l: OwnListing): string {
  const thumbs = l.photo_thumbs;
  if (Array.isArray(thumbs) && thumbs[0]) return thumbs[0] as string;
  if (Array.isArray(l.photoUrls) && l.photoUrls[0]) return l.photoUrls[0];
  if (Array.isArray(l.thumbUrls) && l.thumbUrls[0]) return l.thumbUrls[0];
  return '';
}

// 0.0.0.22 (Zak): instant paint — last my-listings render from localStorage,
// before the SDKs/auth/network. The page then refreshes silently.
// Projection matches exactly what the card render reads (js/my-listings.js).
function paintMyAdsSnapshot(): OwnListing[] | null {
  const snap = snapshotRead<{ docs?: Record<string, unknown>[] }>('mylistings');
  if (!snap || !snap.data || !Array.isArray(snap.data.docs) || !snap.data.docs.length)
    return null;
  try {
    const docs = snap.data.docs
      .filter((d) => d && d.id)
      .map((d) => ({ ...(d as object), id: String((d as { id: unknown }).id) }) as OwnListing);
    return docs.length ? docs : null;
  } catch {
    return null;
  }
}

export default function MyListingsPage() {
  return (
    <AuthGate>
      {(user) => <MyListingsContent user={user} />}
    </AuthGate>
  );
}

function MyListingsContent({ user }: { user: CompatUser }) {
  const { lang, t } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [listings, setListings] = useState<OwnListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showVerifyBanner] = useState(() => !user.emailVerified);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [confirmSoldId, setConfirmSoldId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Round 12: modular SDK via getFirebaseBundled (was dynamic
      // firebase-compat import). Loader stays at the usage site.
      const { db, fsMod } = await getFirebaseBundled();
      const snap = await withTimeout(
        fsMod.getDocs(
          fsMod.query(
            fsMod.collection(db, 'listings'),
            fsMod.where('sellerId', '==', user.uid),
            fsMod.orderBy('createdAt', 'desc'),
            fsMod.limit(60)
          )
        ),
        20000
      );
      if (!mounted.current) return;
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as OwnListing);
      setListings(docs);
      // 0.0.0.22 (Zak): save for instant paint on next boot.
      // Projection matches exactly what the card render reads.
      try {
        snapshotWrite('mylistings', user.uid, {
          docs: docs.map((l) => ({
            id: l.id,
            title: l.title || '',
            price: l.price || 0,
            photoUrls: (l.photoUrls || []).slice(0, 2),
            thumbUrls: ((l.photo_thumbs && l.photo_thumbs.length ? l.photo_thumbs : l.thumbUrls) || []).slice(0, 2),
            status: l.status || '',
            categoryId: l.categoryId || '',
            wilayaCode: l.wilayaCode || 0,
            createdAt: snapMs(l.createdAt),
            previousPrice: l.previousPrice || 0,
            priceReduced: !!l.priceReduced,
            sellerId: l.sellerId || '',
            isWholesale: !!l.isWholesale,
            isWanted: !!l.isWanted,
          })),
        });
      } catch {
        /* best-effort */
      }
    } catch (e) {
      if (!mounted.current) return;
      console.error(e);
      setError(t('errorGeneric'));
    }
  }, [user.uid, t]);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetch on mount, guarded by mounted ref */
  useEffect(() => {
    mounted.current = true;
    // 0.0.0.22 (Zak): paint the last good render synchronously, before the
    // SDKs/auth/network. load() then refreshes silently in the background.
    try {
      const cached = paintMyAdsSnapshot();
      if (cached) setListings(cached);
    } catch {
      /* fall through to the live path */
    }
    load();
    return () => {
      mounted.current = false;
    };
  }, [user, load]);

  const markSold = useCallback(
    async (id: string) => {
      // Use custom modal instead of window.confirm (testable, better UX)
      setConfirmSoldId(id);
    },
    []
  );

  const confirmMarkSold = useCallback(
    async () => {
      const id = confirmSoldId;
      if (!id) return;
      setConfirmSoldId(null);
      setActionBusy(id);
      try {
        const { db, fsMod } = await getFirebaseBundled();
        // 12 Oct 2026: include updatedAt for sitemap/feed ordering.
        await withTimeout(fsMod.updateDoc(fsMod.doc(db, 'listings', id), {
          status: 'sold',
          updatedAt: fsMod.serverTimestamp(),
        }), 15000);
        // Full reload instead of React state update (automation-compatible)
        window.location.reload();
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'deadline-exceeded') {
          // Write may have committed — reload to show server truth.
          load();
        } else if (mounted.current) {
          // 12 Oct 2026: inline error (was window.alert).
          setError(t('errorGeneric'));
        }
      } finally {
        if (mounted.current) setActionBusy(null);
      }
    },
    [t, load, confirmSoldId]
  );

  const deleteAd = useCallback(
    async (id: string) => {
      // Use custom modal instead of window.confirm (testable, better UX)
      setConfirmDeleteId(id);
    },
    []
  );

  const confirmDelete = useCallback(
    async () => {
      const id = confirmDeleteId;
      if (!id) return;
      setConfirmDeleteId(null);
      setActionBusy(id);
      try {
        const { db, storage, fsMod, storageMod } = await getFirebaseBundled();
        // Verify ownership first (mirrors js/acct-common.js delAd).
        const listingRef = fsMod.doc(db, 'listings', id);
        const snap = await withTimeout(fsMod.getDoc(listingRef), 15000);
        if (!snap.exists()) {
          load();
          return;
        }
        const l = snap.data() as OwnListing;
        if (l.sellerId !== user.uid) {
          // 12 Oct 2026: inline error (was window.alert).
          setError(t('errorGeneric'));
          return;
        }
        const title = listingTitle(l, lang);
        const batch = fsMod.writeBatch(db);
        batch.set(fsMod.doc(fsMod.collection(db, 'deletedAds')), {
          sellerId: user.uid,
          listingId: id,
          title,
          sellerName: user.displayName || '',
          deletedAt: fsMod.serverTimestamp(),
          reason: 'owner',
          adminId: '',
        });
        batch.delete(listingRef);
        batch.update(fsMod.doc(db, 'users', user.uid), {
          vitrineIds: fsMod.arrayRemove(id),
        });
        // 12 Oct 2026: also prune vitrineSellers registry (was left dangling).
        // Best-effort AFTER the batch — the registry doc may not exist
        // (syncVitrineRegistry deletes it when ineligible), and batch.update()
        // on a missing doc would fail the entire delete.
        await withTimeout(batch.commit(), 20000);
        try {
          await fsMod.updateDoc(fsMod.doc(db, 'vitrineSellers', user.uid), {
            vitrineIds: fsMod.arrayRemove(id),
          });
        } catch {
          /* registry doc absent: nothing to prune */
        }
        // Photo cleanup (best-effort): legacy Firebase Storage URLs first,
        // then R2 (the server skips non-R2 values and enforces uid ownership).
        const urls: string[] = [
          ...(Array.isArray(l.photoUrls) ? l.photoUrls : []),
          ...(Array.isArray(l.thumbUrls) ? l.thumbUrls : []),
          ...(Array.isArray(l.photo_thumbs) ? l.photo_thumbs : []),
        ].filter((u): u is string => typeof u === 'string' && !!u);
        try {
          await Promise.all(
            urls.map(async (u) => {
              try {
                // 11 Oct 2026: refFromURL (was ref — silent no-op on full URLs).
                // Round 12: modular ref() routes URLs internally
                // (no refFromURL in the modular API) — one call for both.
                const r = storageMod.ref(storage, u);
                await storageMod.deleteObject(r);
              } catch {
                // ignore missing objects
              }
            })
          );
        } catch {
          // non-fatal
        }
        try {
          const idToken = await user.getIdToken();
          await deleteR2Objects(urls, idToken);
        } catch {
          // non-fatal
        }
        // Full reload instead of React state update (automation-compatible)
        window.location.reload();
      } catch (e) {
        console.error(e);
        // 12 Oct 2026: inline error (was window.alert).
        if (mounted.current) setError(t('errorGeneric'));
      } finally {
        if (mounted.current) setActionBusy(null);
      }
    },
    [user, lang, t, load, confirmDeleteId]
  );

  const resendVerification = useCallback(async () => {
    try {
      // Round 12: sendEmailVerification is a top-level modular function
      // (not a User method).
      const { authMod } = await getFirebaseBundled();
      await withTimeout(authMod.sendEmailVerification(user), 15000);
      // 12 Oct 2026: inline success (was window.alert).
      setError(null);
      setNotice(t('emailSent'));
    } catch {
      setNotice(null);
      setError(t('authConnectionProblem'));
    }
  }, [user, t]);

  const iVerified = useCallback(async () => {
    try {
      // Round 12: reload is a top-level modular function (not a User method).
      const { authMod } = await getFirebaseBundled();
      await withTimeout(authMod.reload(user), 15000);
    } catch {
      // 12 Oct 2026: inline error (was window.alert).
      setNotice(null);
      setError(t('authConnectionProblem'));
      return;
    }
    // Re-check via fresh auth state — reload the page if now verified.
    const client = await getFirebaseBundled().catch(() => null);
    const cu = client?.auth.currentUser;
    if (cu && cu.emailVerified) window.location.reload();
    else {
      // 12 Oct 2026: inline info (was window.alert).
      setError(null);
      setNotice(t('stillNotVerified'));
    }
  }, [user, t]);

  return (
    <div className="min-h-screen bg-zinc-50" dir={dir}>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {showVerifyBanner && (
          <div className="mb-4 rounded-xl bg-blue-50 border border-blue-200 p-4">
            <p className="text-sm text-blue-900">{t('verifyEmailBody')}</p>
            <div className="mt-3 flex gap-2 flex-wrap">
              <button
                onClick={iVerified}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800"
              >
                {t('iVerifiedContinue')}
              </button>
              <button
                onClick={resendVerification}
                className="rounded-lg bg-white border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t('resendEmail')}
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900">
            {notice}
          </div>
        )}

        <h1 className="text-xl font-bold text-zinc-900 mb-4">{t('myAds')}</h1>

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

        {!error && listings === null && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-white shadow-sm overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-zinc-200" />
                <div className="p-3">
                  <div className="h-5 bg-zinc-200 rounded w-1/2 mb-2" />
                  <div className="h-4 bg-zinc-200 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!error && listings !== null && listings.length === 0 && (
          <div className="rounded-xl bg-white shadow-sm p-10 text-center">
            <p className="text-5xl mb-4">📦</p>
            <p className="text-zinc-600 mb-5">{t('noAds')}</p>
            <a
              href="/publish"
              className="inline-block rounded-lg bg-emerald-700 px-6 py-2.5 font-bold text-white hover:bg-emerald-800"
            >
              {t('publish')}
            </a>
          </div>
        )}

        {!error && listings !== null && listings.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {listings.map((l) => {
              const img = listingImg(l);
              const busy = actionBusy === l.id;
              return (
                <div key={l.id} className="relative">
                  <a
                    href={`/listing/${l.id}`}
                    className="block rounded-xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
                  >
                    <div className="relative aspect-[4/3] bg-zinc-100">
                      <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
                      {img && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={listingTitle(l, lang)} loading="lazy" className="absolute inset-0 w-full h-full object-cover"
                          // 12 Oct 2026: hide broken image so the 📷 placeholder shows (was broken-image icon).
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      )}
                      {l.status === 'sold' && (
                        <span className="absolute top-2 start-2 rounded bg-zinc-900/80 text-white text-xs px-2 py-1">
                          {t('sold')}
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      {/* 11 Oct 2026: job offers show salary/month, not 0 DZD. */}
                      <p className="font-bold text-emerald-700">
                        {l.answers?.jobType === 'jobOffer' && typeof l.answers?.salary === 'number' ? (
                          <span dir="ltr">{t('salaryPerMonth').replace('{x}', formatPrice(l.answers.salary, lang))}</span>
                        ) : (
                          <span dir="ltr">{formatPrice(l.price || 0, lang)}</span>
                        )}
                      </p>
                      <h3 className="mt-1 text-sm font-medium text-zinc-900 line-clamp-2">{listingTitle(l, lang)}</h3>
                    </div>
                  </a>
                  <div className="mt-2 flex gap-2">
                    <a
                      href={`/publish?edit=${encodeURIComponent(l.id)}`}
                      className="flex-1 rounded-lg bg-white border border-zinc-300 px-2 py-2 text-xs font-medium text-zinc-700 text-center hover:bg-zinc-50"
                    >
                      ✎ {t('edit')}
                    </a>
                    {l.status !== 'sold' && (
                      <button
                        onClick={() => markSold(l.id)}
                        disabled={busy}
                        className="flex-1 rounded-lg bg-white border border-zinc-300 px-2 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        ✓ {t('markSold')}
                      </button>
                    )}
                    <button
                      onClick={() => deleteAd(l.id)}
                      disabled={busy}
                      className="flex-1 rounded-lg bg-red-600 px-2 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      ✕ {t('delete')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Custom confirm modal for Mark as Sold (replaces window.confirm) */}
      {confirmSoldId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-zinc-900">{t('markSoldConfirm')}</h3>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmSoldId(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirmMarkSold}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800"
              >
                {t('markSold')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom confirm modal for Delete (replaces window.confirm) */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-zinc-900">{t('delete')}?</h3>
            <p className="mt-2 text-sm text-zinc-600">{t('deleteConfirm')}</p>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-700"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
