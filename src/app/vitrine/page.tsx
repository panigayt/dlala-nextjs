// Dlala vitrine (showcase) — ordinary-seller 7-day activation (client).
//
// Mirrors js/vitrine.js renderVitrineBox (0.0.0.43):
//   - Pro merchant → notice + link to /my-store#settings (dead end here).
//   - Active boost (vitrineBoostUntil in future) → remaining time + cancel.
//   - Cooldown (activated <30d ago) → reactivation date.
//   - Activatable → hint + product picker (checkboxes, max 8, MIN 5 to
//     activate) + "تفعيل الواجهة" button.
//   - Activation/cancel via the activateVitrine Cloud Function (client may
//     NEVER write vitrineBoostUntil directly — rules deny it).
//   - After every vitrineIds save: syncVitrineRegistry.

'use client';

import { useEffect, useState } from 'react';
import {
  useRequireAuth,
  LoadingSpinner,
  btnCls,
  btnSecondaryCls,
  type FirebaseClient,
  type CompatUser,
} from '@/lib/firebase-client';

const T = {
  title: 'الواجهة',
  loading: 'جارٍ التحميل...',
  errorGeneric: 'حدث خطأ — حاول مجدداً',
  retry: 'إعادة المحاولة',
  proNotice: 'تاجر محترف — واجهة غير محدودة',
  manageProducts: 'إدارة منتجات الواجهة',
  proHint: 'اختر حتى 8 من منتجاتك لعرضها في بطاقة الواجهة على الصفحة الرئيسية.',
  boostLeft: (n: number, unit: string) => `Vitrine — متبقي ${n} ${unit}`,
  days: 'يوم',
  hours: 'ساعة',
  cancelVitrine: 'إلغاء الواجهة',
  cancelConfirm: 'إلغاء تفعيل الواجهة؟',
  cooldown: (d: string) => `يمكنك إعادة التفعيل ابتداءً من ${d}`,
  activateHint: 'فعّل الواجهة لعرض منتجاتك المميزة لمدة 7 أيام.',
  activate: 'تفعيل الواجهة',
  chooseProducts: 'اختر منتجات للعرض في الواجهة',
  needMinPicks: 'اختر 5 إعلانات على الأقل للواجهة لتتمكن من نشرها.',
  needAds: 'انشر إعلاناً واحداً على الأقل أولاً لتفعيل الواجهة.',
  needListings: 'تحتاج إلى حساب موثق أو 3 إعلانات نشطة على الأقل.',
  pickerFull: 'يمكنك اختيار 8 منتجات كحد أقصى.',
  vitrineInfo: 'نظم متجرك واعرض منتجاتك في صفحتك.',
  login: 'تسجيل الدخول',
};

const ACTIVATE_FN_URL =
  'https://europe-west3-dlala-85cea.cloudfunctions.net/activateVitrine';

interface Listing {
  id: string;
  title?: Record<string, string>;
  price?: number;
  photoUrls?: string[];
  photo_thumbs?: (string | null)[];
  status?: string;
}

function titleOf(l: Listing): string {
  return l.title?.ar || l.title?.fr || l.title?.en || '';
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

// VITRINE REGISTRY (27 Sep 2026): keeps the public `vitrineSellers`
// collection in sync. The home feed discovers vitrine candidates from
// this registry — NOT by scanning listings — so it works at any catalog
// size. Called after every vitrineIds save and after activation success.
// Eligibility mirrors the feed's check: pro stores are always in;
// ordinary sellers need an active boost AND at least one pick.
// Mirrors js/vitrine.js syncVitrineRegistry (0.0.0.43).
async function syncVitrineRegistry(
  client: FirebaseClient,
  uid: string,
  u: Record<string, unknown>
) {
  try {
    const isPro = u.storeTier === 'verified';
    const picks = Array.isArray(u.vitrineIds) ? (u.vitrineIds as string[]) : [];
    const boostUntil = dateOf(u.vitrineBoostUntil);
    const boosted = !!boostUntil && boostUntil.getTime() > Date.now();
    const eligible = !!(isPro || (boosted && picks.length > 0));
    const docRef = client.db.collection('vitrineSellers').doc(uid);
    if (eligible) {
      await docRef.set(
        {
          sellerId: uid,
          storeTier: (u.storeTier as string) || null,
          vitrineIds: picks,
          vitrineBoostUntil: u.vitrineBoostUntil || null,
          updatedAt: client.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      await docRef.delete().catch(() => {}); // already absent: fine
    }
  } catch (e) {
    // Non-fatal: the seller's own vitrineIds save already succeeded.
    console.error('[vitrine] registry sync failed', e);
  }
}

type BoxState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'pro' }
  | { kind: 'boost'; until: Date }
  | { kind: 'cooldown'; from: Date }
  | { kind: 'activatable' };

function BoostCountdown({ until }: { until: Date }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const ms = until.getTime() - now;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const label = days > 0 ? T.boostLeft(days, T.days) : T.boostLeft(Math.max(1, hours), T.hours);
  return (
    <p className="font-bold text-emerald-700 text-lg mb-4">✨ {label}</p>
  );
}

function VitrineApp({ user, client }: { user: CompatUser; client: FirebaseClient }) {
  const [box, setBox] = useState<BoxState>({ kind: 'loading' });
  const [ads, setAds] = useState<Listing[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [, setUserData] = useState<Record<string, unknown>>({});

  const load = async () => {
    setBox({ kind: 'loading' });
    setMsg(null);
    try {
      const d = await client.db.collection('users').doc(user.uid).get();
      const u = (d.exists ? d.data() : {}) as Record<string, unknown>;
      setUserData(u);

      if (u.storeTier === 'verified') {
        setBox({ kind: 'pro' });
        return;
      }

      const boostUntil = dateOf(u.vitrineBoostUntil);
      if (boostUntil && boostUntil.getTime() > Date.now()) {
        setBox({ kind: 'boost', until: boostUntil });
        return;
      }

      const lastActivated = dateOf(u.vitrineLastActivatedAt);
      if (lastActivated && Date.now() - lastActivated.getTime() < 30 * 24 * 3600 * 1000) {
        const from = new Date(lastActivated.getTime() + 30 * 24 * 3600 * 1000);
        setBox({ kind: 'cooldown', from });
        return;
      }

      // Load candidates
      const snap = await client.db
        .collection('listings')
        .where('sellerId', '==', user.uid)
        .where('status', 'in', ['available', 'negotiating'])
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
      const list = snap.docs.map((dd) => ({ id: dd.id, ...(dd.data() as object) }) as Listing);
      setAds(list);
      const saved = Array.isArray(u.vitrineIds) ? (u.vitrineIds as string[]) : [];
      const eligible = new Set(list.map((l) => l.id));
      setPicked(saved.filter((id) => eligible.has(id)).slice(0, 8));
      setBox({ kind: 'activatable' });
    } catch {
      setBox({ kind: 'error' });
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setMsg(null);
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= 8) { setMsg(T.pickerFull); return p; }
      return [...p, id];
    });
  };

  const callFn = async (action?: string) => {
    const idToken = await user.getIdToken();
    const res = await fetch(ACTIVATE_FN_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ data: action ? { action } : {}, idToken }),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok && body && !body.error, body };
  };

  const activate = async () => {
    if (picked.length < 5) { setMsg(T.needMinPicks); return; }
    setBusy(true);
    setMsg(null);
    try {
      // Save picks first
      await client.db.collection('users').doc(user.uid).update({ vitrineIds: picked });
      // VITRINE REGISTRY (27 Sep 2026): keep the public discovery registry
      // in sync so the home feed finds this seller at any catalog size.
      try {
        const snap = await client.db.collection('users').doc(user.uid).get();
        const udata = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
        udata.vitrineIds = picked;
        await syncVitrineRegistry(client, user.uid, udata);
      } catch (e) { console.error('[vitrine] registry sync failed', e); }
      const { ok, body } = await callFn();
      if (!ok) {
        const code = String(body?.error?.status || '').toLowerCase();
        if (code.includes('already_active')) { await load(); return; }
        if (code.includes('not_eligible')) { setMsg(T.needListings); return; }
        setMsg(T.errorGeneric);
        return;
      }
      // VITRINE REGISTRY (27 Sep 2026): activation succeeded — sync the
      // public registry so the home feed discovers this seller.
      try {
        const usnap = await client.db.collection('users').doc(user.uid).get();
        const udata = (usnap.exists ? usnap.data() : {}) as Record<string, unknown>;
        await syncVitrineRegistry(client, user.uid, udata);
      } catch (e) { console.error('[vitrine] registry sync failed', e); }
      await load();
    } catch {
      setMsg(T.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm(T.cancelConfirm)) return;
    setBusy(true);
    try {
      await callFn('cancel');
      await load();
    } catch {
      setMsg(T.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  if (box.kind === 'loading') return <LoadingSpinner />;
  if (box.kind === 'error') {
    return (
      <div className="min-h-screen bg-zinc-50" dir="rtl">
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-red-700 mb-4">{T.errorGeneric}</p>
          <button onClick={load} className={btnSecondaryCls}>{T.retry}</button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <main className="max-w-2xl mx-auto px-4 py-6">
        <section className="rounded-2xl bg-white shadow-sm p-5">
          <h1 className="text-xl font-bold text-zinc-900 mb-4 flex items-center">
            {T.title}
            <button
              onClick={() => setShowInfo(true)}
              className="ms-2 w-6 h-6 rounded-full border border-zinc-300 text-zinc-500 text-sm"
              aria-label={T.title}
            >
              ⓘ
            </button>
          </h1>

          {msg && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              {msg}
            </div>
          )}

          {box.kind === 'pro' && (
            <div className="text-center py-6">
              <p className="font-bold text-emerald-700 mb-4">★ {T.proNotice}</p>
              <a href="/my-store#settings" className={btnCls + ' inline-block w-auto px-6'}>
                🖼️ {T.manageProducts}
              </a>
              <p className="text-sm text-zinc-500 mt-3">{T.proHint}</p>
            </div>
          )}

          {box.kind === 'boost' && (
            <div className="text-center py-6">
              <BoostCountdown until={box.until} />
              <button onClick={cancel} disabled={busy} className={btnSecondaryCls}>
                {T.cancelVitrine}
              </button>
            </div>
          )}

          {box.kind === 'cooldown' && (
            <div className="text-center py-6">
              <div className="text-4xl mb-3">⏳</div>
              <p className="text-zinc-700">
                {T.cooldown(box.from.toLocaleDateString('ar-DZ'))}
              </p>
            </div>
          )}

          {box.kind === 'activatable' && (
            <div>
              <p className="text-sm text-zinc-600 mb-4">{T.activateHint}</p>
              {ads.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-6">{T.needAds}</p>
              ) : (
                <>
                  <h2 className="font-bold text-zinc-900 mb-3">{T.chooseProducts}</h2>
                  <div className="space-y-2 mb-4">
                    {ads.map((a) => {
                      const on = picked.includes(a.id);
                      return (
                        <label
                          key={a.id}
                          className={`flex items-center gap-3 rounded-xl border p-2 cursor-pointer ${
                            on ? 'border-emerald-500 bg-emerald-50' : 'border-zinc-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(a.id)}
                            className="w-5 h-5 accent-emerald-700"
                          />
                          {thumbOf(a) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumbOf(a)} alt="" className="w-12 h-12 rounded-lg object-cover" />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-zinc-200 flex items-center justify-center text-zinc-400">📷</div>
                          )}
                          <span className="flex-1 text-sm truncate">{titleOf(a)}</span>
                        </label>
                      );
                    })}
                  </div>
                  <button onClick={activate} disabled={busy} className={btnCls}>
                    {busy ? T.loading : `✨ ${T.activate}`}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      </main>

      {showInfo && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md">
            <h2 className="text-lg font-bold text-zinc-900 mb-3">{T.title}</h2>
            <p className="text-sm text-zinc-700 mb-4">{T.vitrineInfo}</p>
            <button onClick={() => setShowInfo(false)} className={btnSecondaryCls + ' w-full'}>
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VitrinePage() {
  const auth = useRequireAuth();
  if (auth.status === 'loading') return <LoadingSpinner />;
  if (auth.status === 'signed-out') return <LoadingSpinner />;
  return <VitrineApp user={auth.user} client={auth.client} />;
}
