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

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AuthGate, { PageHeader } from '@/components/AuthGate';
import { getFirebase, withTimeout, type CompatUser } from '@/lib/firebase-compat';
import { useLang, type Lang } from '@/lib/i18n';
import { cardImage, cardTitle, formatPrice } from '@/lib/firestore';

interface OwnListing {
  id: string;
  title?: Record<string, string> | string;
  price?: number;
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
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const fb = await getFirebase();
      const db = fb.firestore() as unknown as {
        collection: (p: string) => {
          where: (f: string, op: string, v: string) => {
            orderBy: (f: string, d: string) => {
              limit: (n: number) => { get: () => Promise<{ docs: { id: string; data: () => OwnListing }[] }> };
            };
          };
        };
      };
      const snap = await withTimeout(
        db.collection('listings').where('sellerId', '==', user.uid).orderBy('createdAt', 'desc').limit(60).get(),
        20000
      );
      if (!mounted.current) return;
      setListings(snap.docs.map((d) => ({ ...(d.data() as OwnListing), id: d.id })));
    } catch (e) {
      if (!mounted.current) return;
      console.error(e);
      setError(t('errorGeneric'));
    }
  }, [user.uid, t]);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetch on mount, guarded by mounted ref */
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [user, load]);

  const markSold = useCallback(
    async (id: string) => {
      if (!window.confirm(t('markSoldConfirm'))) return;
      setActionBusy(id);
      try {
        const fb = await getFirebase();
        const db = fb.firestore() as unknown as {
          doc: (p: string) => { update: (d: Record<string, unknown>) => Promise<void> };
        };
        await withTimeout(db.doc('listings/' + id).update({ status: 'sold' }), 15000);
        if (mounted.current) {
          setNotice('✓ ' + t('markSold'));
          load();
        }
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'deadline-exceeded') {
          // Write may have committed — reload to show server truth.
          load();
        } else if (mounted.current) {
          window.alert(t('errorGeneric'));
        }
      } finally {
        if (mounted.current) setActionBusy(null);
      }
    },
    [t, load]
  );

  const deleteAd = useCallback(
    async (id: string) => {
      const confirmMsg = t('delete') + '?';
      if (!window.confirm(confirmMsg)) return;
      setActionBusy(id);
      try {
        const fb = await getFirebase();
        const w = window as unknown as {
          firebase: {
            firestore: {
              FieldValue: { arrayRemove: (v: string) => unknown; serverTimestamp: () => unknown };
            };
          };
        };
        const db = fb.firestore() as unknown as {
          doc: (p: string) => {
            get: () => Promise<{ exists: boolean; data: () => OwnListing }>;
            delete: () => Promise<void>;
          };
          collection: (p: string) => { doc: () => { set: (d: Record<string, unknown>) => Promise<void> } };
          batch: () => {
            set: (ref: unknown, d: Record<string, unknown>) => void;
            delete: (ref: unknown) => void;
            update: (ref: unknown, d: Record<string, unknown>) => void;
            commit: () => Promise<void>;
          };
        };
        // Verify ownership first (mirrors js/acct-common.js delAd).
        const listingRef = db.doc('listings/' + id);
        const snap = await withTimeout(listingRef.get(), 15000);
        if (!snap.exists) {
          load();
          return;
        }
        const l = snap.data();
        if (l.sellerId !== user.uid) {
          window.alert(t('errorGeneric'));
          return;
        }
        const title = listingTitle(l, lang);
        const batch = db.batch();
        batch.set(db.collection('deletedAds').doc(), {
          sellerId: user.uid,
          listingId: id,
          title,
          sellerName: user.displayName || '',
          deletedAt: w.firebase.firestore.FieldValue.serverTimestamp(),
          reason: 'owner',
          adminId: '',
        });
        batch.delete(listingRef);
        batch.update(db.doc('users/' + user.uid), {
          vitrineIds: w.firebase.firestore.FieldValue.arrayRemove(id),
        });
        await withTimeout(batch.commit(), 20000);
        // Storage cleanup (best-effort).
        try {
          const storage = fb.storage() as unknown as {
            ref: (p: string) => { delete: () => Promise<void> };
          };
          const urls: string[] = [
            ...(Array.isArray(l.photoUrls) ? l.photoUrls : []),
            ...(Array.isArray(l.thumbUrls) ? l.thumbUrls : []),
          ];
          await Promise.all(
            urls.map(async (u) => {
              try {
                await storage.ref(u).delete();
              } catch {
                // ignore missing objects
              }
            })
          );
        } catch {
          // non-fatal
        }
        if (mounted.current) load();
      } catch (e) {
        console.error(e);
        if (mounted.current) window.alert(t('errorGeneric'));
      } finally {
        if (mounted.current) setActionBusy(null);
      }
    },
    [user, lang, t, load]
  );

  const resendVerification = useCallback(async () => {
    try {
      await withTimeout(user.sendEmailVerification(), 15000);
      window.alert(t('verifyEmailBody'));
    } catch {
      window.alert(t('authConnectionProblem'));
    }
  }, [user, t]);

  const iVerified = useCallback(async () => {
    try {
      await withTimeout(user.reload(), 15000);
    } catch {
      window.alert(t('authConnectionProblem'));
      return;
    }
    // Re-check via fresh auth state — reload the page if now verified.
    const fb = await getFirebase().catch(() => null);
    const cu = fb?.auth().currentUser;
    if (cu && cu.emailVerified) window.location.reload();
    else window.alert(t('stillNotVerified'));
  }, [user, t]);

  return (
    <div className="min-h-screen bg-zinc-50" dir={dir}>
      <PageHeader title={t('myAds')} />

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
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={listingTitle(l, lang)} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
                      )}
                      {l.status === 'sold' && (
                        <span className="absolute top-2 start-2 rounded bg-zinc-900/80 text-white text-xs px-2 py-1">
                          {t('markSold')}
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="font-bold text-emerald-700">{formatPrice(l.price || 0)}</p>
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
    </div>
  );
}
