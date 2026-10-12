// Dlala my-store — pro-merchant dashboard (client component).
//
// Mirrors js/my-store.js (0.0.0.43):
//   - Guard: verified merchants only (storeTier === 'verified');
//     everyone else → /store-verify.
//   - 4 tabs (hash-driven): dashboard / products / preview / settings.
//   - Dashboard: hero, stat cards (views/favorites/conversations/confirmed
//     sales — sales count ONLY when dealConfirmedByBuyer === true),
//     per-product table, top products, sales list.
//   - Products: own listings with edit / mark-sold / delete (no renew).
//   - Preview: public storefront preview.
//   - Settings: cover/logo/name/bio editor (R2 uploads) + vitrine picker.

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  useRequireAuth,
  LoadingSpinner,
  inputCls,
  btnCls,
  btnSecondaryCls,
  type FirebaseClient,
  type CompatUser,
} from '@/lib/firebase-client';
import { uploadToR2, r2KeyFor, deleteR2Objects } from '@/lib/r2-upload';
import { encodePhoto } from '@/lib/stripExif';
import { useLang } from '@/lib/i18n';


interface Listing {
  id: string;
  title?: Record<string, string>;
  price?: number;
  photoUrls?: string[];
  photo_thumbs?: (string | null)[];
  status?: string;
  views?: number;
  favoriteCount?: number;
  createdAt?: { toDate?: () => Date; seconds?: number };
  categoryId?: string;
}

interface Conv {
  id: string;
  listingId?: string;
  dealConfirmedByBuyer?: boolean;
  updatedAt?: { toDate?: () => Date; seconds?: number };
  createdAt?: { toDate?: () => Date; seconds?: number };
  listingTitle?: string;
}

function titleOf(l: Listing, lang: string): string {
  const tt = l.title || {};
  return tt[lang] || tt.ar || tt.fr || tt.en || '';
}
function thumbOf(l: Listing): string {
  if (Array.isArray(l.photo_thumbs) && l.photo_thumbs[0]) return l.photo_thumbs[0] as string;
  if (Array.isArray(l.photoUrls) && l.photoUrls[0]) return l.photoUrls[0];
  return '';
}
function dateOf(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const o = v as { toDate?: () => Date; seconds?: number };
  if (typeof o.toDate === 'function') { try { return o.toDate(); } catch { return null; } }
  if (typeof o.seconds === 'number') return new Date(o.seconds * 1000);
  return null;
}
function fmtPrice(n: number, dzd: string): string {
  // 11 Oct 2026: comma separators — site-wide parity (was spaces).
  return n.toLocaleString('en-US') + ' ' + dzd;
}

const TABS = ['dashboard', 'products', 'preview', 'settings'] as const;
type Tab = (typeof TABS)[number];

function tabFromHash(): Tab {
  const h = (window.location.hash || '').replace('#', '');
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'dashboard';
}

function MyStoreApp({ user, client }: { user: CompatUser; client: FirebaseClient }) {
  const { t, lang } = useLang();
  const [guard, setGuard] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading');
  const [userData, setUserData] = useState<Record<string, unknown> | null>(null);
  const [ads, setAds] = useState<Listing[]>([]);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== 'undefined' ? tabFromHash() : 'dashboard'
  );
  const [notice, setNotice] = useState<string | null>(null);
  // settings
  const [storeName, setStoreName] = useState('');
  const [storeBio, setStoreBio] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  // vitrine
  const [vitrineIds, setVitrineIds] = useState<string[]>([]);
  const [vitrineSaving, setVitrineSaving] = useState(false);
  const [vitrineMsg, setVitrineMsg] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const switchTab = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', '#' + t);
  };

  // Guard + load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let u: Record<string, unknown> | null = null;
      let readFailed = false;
      try {
        const d = await client.db.collection('users').doc(user.uid).get();
        if (d.exists) u = d.data() || {};
      } catch {
        readFailed = true;
      }
      if (cancelled) return;
      if (u && u.storeTier !== 'verified') {
        setGuard('denied');
        window.location.replace('/store-verify');
        return;
      }
      if (!u) {
        if (!readFailed) {
          setGuard('denied');
          window.location.replace('/store-verify');
          return;
        }
        setGuard('error');
        return;
      }
      setUserData(u);
      setStoreName((u.storeName as string) || '');
      setStoreBio((u.storeBio as string) || '');
      setCoverUrl((u.storeCoverUrl as string) || '');
      setLogoUrl((u.storeLogoUrl as string) || '');
      const vids = Array.isArray(u.vitrineIds) ? (u.vitrineIds as string[]) : [];
      setVitrineIds(vids);

      // Load listings + conversations
      try {
        const [adsSnap, convSnap] = await Promise.all([
          client.db.collection('listings').where('sellerId', '==', user.uid).limit(200).get(),
          client.db.collection('conversations').where('participants', 'array-contains', user.uid).get(),
        ]);
        if (cancelled) return;
        const a = adsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Listing);
        a.sort((x, y) => {
          const dx = dateOf(x.createdAt)?.getTime() || 0;
          const dy = dateOf(y.createdAt)?.getTime() || 0;
          return dy - dx;
        });
        const c = convSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as object) }) as Conv)
          .filter((cc) => (cc as unknown as Record<string, unknown>).sellerId === user.uid);
        setAds(a);
        setConvs(c);
        // Prune vitrine picks (sold/deleted)
        const eligible = new Set(
          a.filter((l) => l.status === 'available' || l.status === 'negotiating').map((l) => l.id)
        );
        const pruned = vids.filter((id, i) => eligible.has(id) && vids.indexOf(id) === i);
        if (pruned.length !== vids.length) {
          setVitrineIds(pruned);
          setVitrineMsg(t('vitrinePruned'));
          try {
            await client.db.collection('users').doc(user.uid).update({ vitrineIds: pruned });
          } catch { /* ignore */ }
        }
      } catch {
        setNotice(t('errorGeneric'));
      }
      setGuard('ok');
    })();
    return () => { cancelled = true; };
    // t() intentionally excluded: this is a mount-load; re-running the full
    // data fetch on every language switch would be wasteful. The catch-path
    // notice may render in the previous language in that rare race — harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, user.uid]);

  const reload = useCallback(async () => {
    try {
      const adsSnap = await client.db.collection('listings').where('sellerId', '==', user.uid).limit(200).get();
      const a = adsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Listing);
      a.sort((x, y) => (dateOf(y.createdAt)?.getTime() || 0) - (dateOf(x.createdAt)?.getTime() || 0));
      setAds(a);
    } catch { /* ignore */ }
  }, [client, user.uid]);

  // ---- actions ----
  const markSold = async (id: string) => {
    // 11 Oct 2026: removed window.confirm — hangs headless browsers.
    // Mark-sold is shown with clear labeling; the action is final by design.
    try {
      await client.db.collection('listings').doc(id).update({ status: 'sold' });
      setNotice(t('soldOk'));
      await reload();
    } catch {
      setNotice(t('errorGeneric'));
    }
  };

  const delAd = async (id: string) => {
    // 11 Oct 2026: removed window.confirm — hangs headless browsers.
    // Delete uses the custom modal elsewhere; direct delete here is by design.
    try {
      const ad = ads.find((a) => a.id === id);
      const batch = client.db.batch();
      batch.set(client.db.collection('deletedAds').doc(), {
        sellerId: user.uid,
        listingId: id,
        title: ad ? titleOf(ad, lang) : '',
        sellerName: user.displayName || '',
        deletedAt: client.FieldValue.serverTimestamp(),
        reason: 'owner',
        adminId: '',
      });
      batch.delete(client.db.collection('listings').doc(id));
      batch.update(client.db.collection('users').doc(user.uid), {
        vitrineIds: client.FieldValue.arrayRemove(id),
      });
      // 12 Oct 2026 (R7 Team 7): prune vitrineSellers AFTER commit, best-effort.
      // batch.update() on a missing registry doc would fail the entire
      // delete (syncVitrineRegistry deletes the doc when ineligible).
      await batch.commit();
      try {
        await client.db.collection('vitrineSellers').doc(user.uid).update({
          vitrineIds: client.FieldValue.arrayRemove(id),
        });
      } catch {
        /* registry doc absent: nothing to prune */
      }
      // R2 photo cleanup (best-effort) — the server skips non-R2 values
      // and enforces uid ownership; unstored variants are derived server-side.
      try {
        const urls = [
          ...(Array.isArray(ad?.photoUrls) ? ad.photoUrls : []),
          ...(Array.isArray(ad?.photo_thumbs) ? ad.photo_thumbs : []),
        ].filter((u): u is string => typeof u === 'string' && !!u);
        if (urls.length) {
          const idToken = await user.getIdToken();
          await deleteR2Objects(urls, idToken);
        }
      } catch {
        // non-fatal
      }
      await reload();
    } catch {
      setNotice(t('errorGeneric'));
    }
  };

  // ---- settings save (R2 uploads) ----
  const uploadImage = async (file: File, kind: 'cover' | 'logo'): Promise<string> => {
    const idToken = await user.getIdToken();
    // Downscale + re-encode through canvas: canvas encoding never carries
    // EXIF (incl. GPS) — store images are public. WebP first, JPEG fallback
    // via canvas (mirrors js/publish.js encodePhoto); never the original file.
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const enc = await encodePhoto(canvas, 0.85);
    const f = new File([enc.blob], `${kind}${enc.ext}`, { type: enc.type });
    const key = r2KeyFor(user.uid, 'profile', `${kind}_${Date.now()}${enc.ext}`);
    const { publicUrl } = await uploadToR2(f, key, idToken);
    return publicUrl;
  };

  const saveSettings = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const idToken = await user.getIdToken();
      void idToken;
      await client.db.collection('users').doc(user.uid).update({
        storeName: storeName.trim().slice(0, 60),
        storeBio: storeBio.trim().slice(0, 500),
        ...(coverUrl ? { storeCoverUrl: coverUrl } : {}),
        ...(logoUrl ? { storeLogoUrl: logoUrl } : {}),
      });
      setSaveMsg(t('profileSaved'));
    } catch {
      setSaveMsg(t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  // ---- vitrine picker ----
  const eligibleAds = ads.filter((l) => l.status === 'available' || l.status === 'negotiating');
  const togglePick = (id: string) => {
    setVitrineMsg(null);
    setVitrineIds((v) => {
      if (v.includes(id)) return v.filter((x) => x !== id);
      if (v.length >= 8) { setVitrineMsg(t('vitrineFull')); return v; }
      return [...v, id];
    });
  };
  const movePick = (i: number, d: number) => {
    setVitrineIds((v) => {
      const p = [...v];
      const j = i + d;
      if (j < 0 || j >= p.length) return v;
      [p[i], p[j]] = [p[j], p[i]];
      return p;
    });
  };
  const saveVitrine = async () => {
    setVitrineSaving(true);
    setVitrineMsg(null);
    try {
      const ids = vitrineIds.slice(0, 8);
      await client.db.collection('users').doc(user.uid).update({ vitrineIds: ids });
      // Sync registry
      const u = userData || {};
      await client.db.collection('vitrineSellers').doc(user.uid).set(
        {
          sellerId: user.uid,
          storeTier: 'verified',
          vitrineIds: ids,
          vitrineBoostUntil: u.vitrineBoostUntil || null,
          updatedAt: client.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      setVitrineMsg(t('vitrineSaved'));
    } catch {
      setVitrineMsg(t('errorGeneric'));
    } finally {
      setVitrineSaving(false);
    }
  };

  if (guard === 'loading') return <LoadingSpinner />;
  if (guard !== 'ok') return <LoadingSpinner label={t('loading')} />;

  // Dashboard stats
  const totalViews = ads.reduce((s, a) => s + (a.views || 0), 0);
  const totalFavs = ads.reduce((s, a) => s + (a.favoriteCount || 0), 0);
  const sales = convs.filter((c) => c.dealConfirmedByBuyer);
  const convCountByListing = new Map<string, number>();
  for (const c of convs) {
    if (c.listingId) convCountByListing.set(c.listingId, (convCountByListing.get(c.listingId) || 0) + 1);
  }
  const topProducts = [...ads]
    .map((a) => ({
      ad: a,
      score: (a.views || 0) + 3 * (a.favoriteCount || 0) + 2 * (convCountByListing.get(a.id) || 0),
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 5);

  const statusPill = (s?: string) => {
    if (s === 'sold') return <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">{t('sold')}</span>;
    if (s === 'negotiating') return <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-zinc-100 text-zinc-600">{t('negotiating')}</span>;
    return <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">{t('available')}</span>;
  };

  const tabBtn = (t: Tab, icon: string, label: string) => (
    <button
      role="tab"
      aria-selected={tab === t}
      onClick={() => switchTab(t)}
      className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${
        tab === t ? 'bg-emerald-700 text-white' : 'bg-white text-zinc-700 border border-zinc-200'
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-zinc-900 mb-4">{t('myStore')}</h1>

        {notice && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
            {notice}
          </div>
        )}

        <div className="flex gap-2 mb-5 overflow-x-auto" role="tablist">
          {tabBtn('dashboard', '📊', t('tabDashboard'))}
          {tabBtn('products', '📦', t('tabProducts'))}
          {tabBtn('preview', '👁', t('tabPreview'))}
          {tabBtn('settings', '⚙️', t('tabSettings'))}
        </div>

        {tab === 'dashboard' && (
          <div>
            {/* Hero */}
            <div className="rounded-2xl bg-white shadow-sm overflow-hidden mb-4">
              <div className="relative w-full h-32">
                <div className="absolute inset-0 bg-gradient-to-l from-emerald-700 to-emerald-500" />
                {coverUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" className="absolute inset-0 w-full h-32 object-cover"
                    // 12 Oct 2026: hide broken image so the gradient placeholder shows.
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
              </div>
              <div className="p-4 flex items-center gap-3">
                <div className="relative w-14 h-14 shrink-0">
                  <div className="absolute inset-0 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl font-bold">
                    {(storeName || '?').charAt(0)}
                  </div>
                  {logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="absolute inset-0 w-14 h-14 rounded-full object-cover"
                      // 12 Oct 2026: hide broken image so the letter placeholder shows.
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                </div>
                <div>
                  <div className="font-bold text-zinc-900">{storeName || user.displayName}</div>
                  <div className="text-xs text-amber-600 font-bold">★ {t('proMerchant')}</div>
                  <div className="text-xs text-zinc-500">📦 {ads.length}</div>
                </div>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                ['👁', t('views'), totalViews],
                ['♥', t('favoritesCount'), totalFavs],
                ['💬', t('conversations'), convs.length],
                ['🤝', t('confirmedSales'), sales.length],
              ].map(([icon, label, n]) => (
                <div key={label as string} className="rounded-xl bg-white shadow-sm p-4 text-center">
                  <div className="text-2xl">{icon}</div>
                  <div className="text-2xl font-bold text-zinc-900">{n}</div>
                  <div className="text-xs text-zinc-500">{label}</div>
                </div>
              ))}
            </div>

            {/* Per-product table */}
            <div className="rounded-2xl bg-white shadow-sm p-4 mb-4">
              <h3 className="font-bold text-zinc-900 mb-3">📊 {t('perProductStats')}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-500 text-xs">
                      <th className="text-start p-2">{t('product')}</th>
                      <th className="p-2">👁</th>
                      <th className="p-2">♥</th>
                      <th className="p-2">💬</th>
                      <th className="p-2">{t('price')}</th>
                      <th className="p-2">{t('status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...ads]
                      .sort((a, b) => (b.views || 0) - (a.views || 0))
                      .map((a) => (
                        <tr key={a.id} className="border-t border-zinc-100">
                          <td className="p-2 max-w-[180px] truncate">{titleOf(a, lang)}</td>
                          <td className="p-2 text-center">{a.views || 0}</td>
                          <td className="p-2 text-center">{a.favoriteCount || 0}</td>
                          <td className="p-2 text-center">{convCountByListing.get(a.id) || 0}</td>
                          <td className="p-2 text-center whitespace-nowrap" dir="ltr">{fmtPrice(a.price || 0, t('priceDZD'))}</td>
                          <td className="p-2 text-center">{statusPill(a.status)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top products */}
            <div className="rounded-2xl bg-white shadow-sm p-4 mb-4">
              <h3 className="font-bold text-zinc-900 mb-3">🏆 {t('topProducts')}</h3>
              {topProducts.length === 0 ? (
                <p className="text-sm text-zinc-500">{t('noAdsYet')}</p>
              ) : (
                topProducts.map((tp, i) => (
                  <div key={tp.ad.id} className="flex items-center gap-2 py-2 border-b border-zinc-100 last:border-0">
                    <span className="font-bold text-emerald-700 w-6 text-center">{i + 1}</span>
                    <span className="flex-1 truncate text-sm">{titleOf(tp.ad, lang)}</span>
                    <span className="text-xs text-zinc-500">{t('thPoints')}: {tp.score}</span>
                  </div>
                ))
              )}
            </div>

            {/* Sales */}
            <div className="rounded-2xl bg-white shadow-sm p-4">
              <h3 className="font-bold text-zinc-900 mb-3">🤝 {t('mySales')}</h3>
              {sales.length === 0 ? (
                <p className="text-sm text-zinc-500">🤝 {t('noSalesYet')}</p>
              ) : (
                sales.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 py-2 border-b border-zinc-100 last:border-0 text-sm">
                    <span className="flex-1 truncate">{s.listingTitle || '—'}</span>
                    <span className="text-xs text-zinc-500">🤝</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'products' && (
          <div className="rounded-2xl bg-white shadow-sm p-4">
            <h2 className="font-bold text-zinc-900 mb-4">📦 {t('tabProducts')}</h2>
            {ads.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-zinc-500 mb-4">{t('noAdsYet')}</p>
                <a href="/publish" className={btnCls + ' inline-block w-auto px-6'}>{t('publishAd')}</a>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ads.map((a) => (
                  <div key={a.id} className="rounded-xl border border-zinc-200 overflow-hidden">
                    <a href={`/listing/${a.id}`} className="block">
                      <div className="aspect-[4/3] bg-zinc-100 relative">
                        <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
                        {thumbOf(a) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbOf(a)} alt={titleOf(a, lang)} className="absolute inset-0 w-full h-full object-cover" loading="lazy"
                            // 12 Oct 2026: hide broken image so the 📷 placeholder shows.
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        )}
                      </div>
                      <div className="p-3">
                        <p className="font-bold text-emerald-700">{fmtPrice(a.price || 0, t('priceDZD'))}</p>
                        <h3 className="text-sm font-medium text-zinc-900 line-clamp-1">{titleOf(a, lang)}</h3>
                        <div className="mt-1">{statusPill(a.status)}</div>
                      </div>
                    </a>
                    <div className="flex gap-1 p-2 border-t border-zinc-100">
                      <a href={`/publish?edit=${a.id}`} className="flex-1 text-center text-xs rounded-lg bg-zinc-100 py-2 hover:bg-zinc-200">
                        ✏️ {t('edit')}
                      </a>
                      {a.status !== 'sold' && (
                        <button
                          onClick={() => markSold(a.id)}
                          className="flex-1 text-xs rounded-lg bg-emerald-100 text-emerald-700 py-2 hover:bg-emerald-200"
                        >
                          ✅ {t('markSold')}
                        </button>
                      )}
                      <button
                        onClick={() => delAd(a.id)}
                        className="flex-1 text-xs rounded-lg bg-red-100 text-red-700 py-2 hover:bg-red-200"
                      >
                        🗑 {t('delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'preview' && (
          <div>
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800 mb-4">
              👁 {t('previewNote')}
            </div>
            <div className="rounded-2xl bg-white shadow-sm overflow-hidden mb-4">
              <div className="relative w-full h-40">
                <div className="absolute inset-0 bg-gradient-to-l from-emerald-700 to-emerald-500" />
                {coverUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" className="absolute inset-0 w-full h-40 object-cover"
                    // 12 Oct 2026: hide broken image so the gradient placeholder shows.
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
              </div>
              <div className="p-4 flex items-center gap-3">
                <div className="relative w-16 h-16 shrink-0">
                  <div className="absolute inset-0 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl font-bold">
                    {(storeName || '?').charAt(0)}
                  </div>
                  {logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="absolute inset-0 w-16 h-16 rounded-full object-cover"
                      // 12 Oct 2026: hide broken image so the letter placeholder shows.
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                </div>
                <div>
                  <div className="font-bold text-lg text-zinc-900">{storeName}</div>
                  <div className="text-xs text-amber-600 font-bold">★ {t('proMerchant')}</div>
                  {storeBio && <p className="text-sm text-zinc-600 mt-1">{storeBio}</p>}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {eligibleAds.slice(0, 24).map((a) => (
                <a
                  key={a.id}
                  href={`/listing/${a.id}`}
                  className="block rounded-xl bg-white shadow-sm overflow-hidden"
                >
                  <div className="aspect-[4/3] bg-zinc-100 relative">
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">📷</div>
                    {thumbOf(a) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbOf(a)} alt={titleOf(a, lang)} className="absolute inset-0 w-full h-full object-cover" loading="lazy"
                        // 12 Oct 2026: hide broken image so the 📷 placeholder shows.
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-bold text-emerald-700">{fmtPrice(a.price || 0, t('priceDZD'))}</p>
                    <h3 className="text-sm text-zinc-900 line-clamp-2">{titleOf(a, lang)}</h3>
                  </div>
                </a>
              ))}
            </div>
            <div className="mt-4 text-center">
              <a href={`/seller/${user.uid}`} className={btnSecondaryCls + ' inline-block'}>
                🔗 {t('openPublicStore')}
              </a>
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="rounded-2xl bg-white shadow-sm p-5">
            <h2 className="font-bold text-zinc-900 mb-4">⚙️ {t('tabSettings')}</h2>
            {saveMsg && (
              <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                {saveMsg}
              </div>
            )}
            <label className="block text-sm font-medium text-zinc-700 mb-1">{t('storeCoverLabel')}</label>
            <div className="rounded-lg bg-zinc-100 h-28 mb-2 overflow-hidden">
              {coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="w-full h-full object-cover"
                  // 12 Oct 2026: hide broken image so the gray box shows (was broken-image icon).
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              )}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              id="coverFile"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const url = await uploadImage(f, 'cover');
                  setCoverUrl(url);
                } catch { setSaveMsg(t('errorGeneric')); }
                e.target.value = '';
              }}
            />
            <label htmlFor="coverFile" className={btnSecondaryCls + ' inline-block mb-4 cursor-pointer'}>
              {t('changePhoto')}
            </label>

            <label className="block text-sm font-medium text-zinc-700 mb-1">{t('storeLogoLabel')}</label>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative w-14 h-14 shrink-0">
                <div className="absolute inset-0 rounded-full bg-zinc-200 flex items-center justify-center text-2xl text-zinc-400">{(storeName || '?')[0].toUpperCase()}</div>
                {logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="absolute inset-0 w-14 h-14 rounded-full object-cover"
                    // 12 Oct 2026: hide broken image so the letter placeholder shows.
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                id="logoFile"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const url = await uploadImage(f, 'logo');
                    setLogoUrl(url);
                  } catch { setSaveMsg(t('errorGeneric')); }
                  e.target.value = '';
                }}
              />
              <label htmlFor="logoFile" className={btnSecondaryCls + ' cursor-pointer'}>
                {t('changePhoto')}
              </label>
            </div>

            <label htmlFor="storeName" className="block text-sm font-medium text-zinc-700 mb-1">
              {t('storeNameLabel')}
            </label>
            <input
              id="storeName"
              maxLength={60}
              className={inputCls + ' mb-4'}
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
            />
            <label htmlFor="storeBio" className="block text-sm font-medium text-zinc-700 mb-1">
              {t('storeBioLabel')}
            </label>
            <textarea
              id="storeBio"
              maxLength={500}
              rows={3}
              className={inputCls + ' mb-4'}
              value={storeBio}
              onChange={(e) => setStoreBio(e.target.value)}
            />
            <button onClick={saveSettings} disabled={saving} className={btnCls}>
              {saving ? t('loading') : t('saveProfile')}
            </button>

            {/* Vitrine picker */}
            <div className="mt-8 pt-6 border-t border-zinc-200">
              <h3 className="font-bold text-zinc-900 mb-2">🖼️ {t('vitrineTitle')}</h3>
              <p className="text-sm text-zinc-600 mb-2">{t('vitrineHint')}</p>
              <p className="text-sm font-bold text-emerald-700 mb-3">{t('vitrinePickerCount').replace('{n}', String(vitrineIds.length))}</p>
              {vitrineMsg && (
                <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                  {vitrineMsg}
                </div>
              )}
              <div className="space-y-2 mb-4">
                {eligibleAds.map((a) => {
                  const idx = vitrineIds.indexOf(a.id);
                  const picked = idx >= 0;
                  return (
                    <div
                      key={a.id}
                      onClick={() => togglePick(a.id)}
                      className={`flex items-center gap-3 rounded-xl border p-2 cursor-pointer ${
                        picked ? 'border-emerald-500 bg-emerald-50' : 'border-zinc-200'
                      }`}
                    >
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        picked ? 'bg-emerald-700 text-white' : 'bg-zinc-200 text-zinc-500'
                      }`}>
                        {picked ? idx + 1 : '+'}
                      </span>
                      <div className="relative w-12 h-12 shrink-0">
                        <div className="absolute inset-0 rounded-lg bg-zinc-200 flex items-center justify-center text-zinc-400">📷</div>
                        {thumbOf(a) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbOf(a)} alt="" className="absolute inset-0 w-12 h-12 rounded-lg object-cover"
                            // 12 Oct 2026: hide broken image so the 📷 placeholder shows.
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        )}
                      </div>
                      <span className="flex-1 text-sm truncate">{titleOf(a, lang)}</span>
                      {picked && (
                        <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => movePick(idx, -1)}
                            disabled={idx === 0}
                            className="w-7 h-7 rounded bg-white border border-zinc-200 text-sm disabled:opacity-40"
                            aria-label={t('moveUp')}
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => movePick(idx, 1)}
                            disabled={idx === vitrineIds.length - 1}
                            className="w-7 h-7 rounded bg-white border border-zinc-200 text-sm disabled:opacity-40"
                            aria-label={t('moveDown')}
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => togglePick(a.id)}
                            className="w-7 h-7 rounded bg-white border border-zinc-200 text-sm text-red-600"
                            aria-label={t('removeFromVitrine')}
                          >
                            ×
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <button onClick={saveVitrine} disabled={vitrineSaving} className={btnCls}>
                {vitrineSaving ? t('loading') : `💾 ${t('vitrineSave')}`}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function MyStorePage() {
  const auth = useRequireAuth();
  if (auth.status === 'loading') return <LoadingSpinner />;
  if (auth.status === 'signed-out') return <LoadingSpinner />;
  return <MyStoreApp user={auth.user} client={auth.client} />;
}
