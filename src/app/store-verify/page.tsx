// Dlala store verification — client component.
//
// Mirrors js/vitrine.js loadStoreVerifyPage/renderStoreVerify (0.0.0.43):
//   - Signed-in required; verified merchants → /my-store#settings.
//   - States: no tier → "طلب توثيق متجر" button (opens request dialog);
//     requested → "طلب التوثيق قيد المراجعة" notice.
//   - Request dialog: store name (required, ≤60), business wilaya
//     (required, 1–69), delivery checkbox, bio (optional, ≤500).
//   - Submit: updateDoc(users/{uid}, { storeTier:'requested', ... }).
//   - ⓘ pro benefits dialog.

'use client';

import { useEffect, useState } from 'react';
import {
  useRequireAuth,
  LoadingSpinner,
  inputCls,
  btnCls,
  btnSecondaryCls,
  type FirebaseClient,
  type CompatUser,
} from '@/lib/firebase';
import { WILAYAS } from '@/lib/wilayas';
import { useLang } from '@/lib/i18n';
import { useModalDialog } from '@/lib/use-modal-dialog';
// 11 Oct 2026: withTimeout now in @/lib/timeout.
import { withTimeout } from '@/lib/timeout';

function StoreVerifyApp({ user, client }: { user: CompatUser; client: FirebaseClient }) {
  const { t, lang } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const benefits = [t('proBenefit1'), t('proBenefit2'), t('proBenefit3'), t('proBenefit4')];
  const [state, setState] = useState<'loading' | 'error' | 'none' | 'requested'>('loading');
  const [showDialog, setShowDialog] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  // R32-4: shared dialog keyboard/focus behavior — useModalDialog.
  const confirmDialogRef = useModalDialog({
    open: showDialog,
    onClose: () => setShowDialog(false),
  });
  const infoDialogRef = useModalDialog({
    open: showInfo,
    onClose: () => setShowInfo(false),
  });
  const [name, setName] = useState('');
  const [wilaya, setWilaya] = useState('');
  const [delivery, setDelivery] = useState(false);
  const [bio, setBio] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setState('loading');
    try {
      const { db, fsMod } = client;
      // 11 Oct 2026: timeout — hung load left spinner forever.
      const d = await withTimeout(
        fsMod.getDoc(fsMod.doc(db, 'users/' + user.uid)),
        15000
      );
      const u = d.exists() ? (d.data() as Record<string, unknown>) : {};
      if ((u.storeTier as string) === 'verified') {
        window.location.replace('/my-store#settings');
        return;
      }
      setName((u.storeName as string) || '');
      setWilaya(u.storeWilaya ? String(u.storeWilaya) : '');
      setDelivery(!!u.storeDelivery);
      setBio((u.storeBio as string) || '');
      setState((u.storeTier as string) === 'requested' ? 'requested' : 'none');
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setFormError(null);
    const n = name.trim();
    if (!n) { setFormError(t('storeReqNameRequired')); return; }
    const w = Number(wilaya);
    if (!(w >= 1 && w <= 69)) { setFormError(t('storeReqWilayaRequired')); return; }
    setSubmitting(true);
    try {
      const data: Record<string, unknown> = {
        storeTier: 'requested',
        storeName: n.slice(0, 60),
        storeWilaya: w,
        storeDelivery: delivery,
      };
      const b = bio.trim();
      if (b) data.storeBio = b.slice(0, 500);
      // 11 Oct 2026: timeout — stuck disabled button on stalled network.
      await withTimeout(
        client.fsMod.updateDoc(client.fsMod.doc(client.db, 'users/' + user.uid), data),
        20000
      );
      setShowDialog(false);
      setState('requested');
    } catch {
      setFormError(t('errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'loading') return <LoadingSpinner />;
  if (state === 'error') {
    return (
      <div className="min-h-screen bg-zinc-50" dir={dir}>
        <main id="main-content" className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-red-700 mb-4">{t('errorGeneric')}</p>
          <button onClick={load} className={btnSecondaryCls}>{t('retry')}</button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50" dir={dir}>
      <main id="main-content" className="max-w-2xl mx-auto px-4 py-6">
        <section className="rounded-2xl bg-white shadow-sm p-5">
          <h1 className="text-xl font-bold text-zinc-900 mb-4 flex items-center">
            {t('storeVerifyTitle')}
            <button
              onClick={() => setShowInfo(true)}
              className="ms-2 w-6 h-6 rounded-full border border-zinc-300 text-zinc-500 text-sm"
              aria-label={t('proInfoTitle')}
            >
              ⓘ
            </button>
          </h1>

          {state === 'requested' ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-6 text-center">
              <div className="text-3xl mb-2">⏳</div>
              <p className="font-bold text-amber-800">{t('storeRequested')}</p>
              <p className="text-sm text-amber-700 mt-1">{t('storeRequestedHint')}</p>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="text-5xl mb-4">🏪</div>
              <button onClick={() => setShowDialog(true)} className={btnCls + ' max-w-xs mx-auto'}>
                {t('storeVerifyRequest')}
              </button>
            </div>
          )}
        </section>
      </main>

      {showDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" dir={dir}>
          <div
            ref={confirmDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('storeVerifyConfirm')}
            className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-lg font-bold text-zinc-900 mb-4">{t('storeVerifyConfirm')}</h2>
            {formError && (
              <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}
            <label className="block text-sm font-medium text-zinc-700 mb-1">{t('storeNameLabel')}</label>
            <input
              className={inputCls + ' mb-3'}
              value={name}
              maxLength={60}
              placeholder={t('storeNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="block text-sm font-medium text-zinc-700 mb-1">{t('storeWilayaLabel')}</label>
            <select
              className={inputCls + ' mb-3'}
              value={wilaya}
              onChange={(e) => setWilaya(e.target.value)}
            >
              <option value="">{t('storeWilayaPlaceholder')}</option>
              {WILAYAS.map((w) => (
                <option key={w.code} value={String(w.code)}>
                  {w.code} - {lang === 'ar' ? w.ar : (lang === 'en' && w.en ? w.en : w.fr)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 mb-3 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={delivery}
                onChange={(e) => setDelivery(e.target.checked)}
                className="w-4 h-4 accent-emerald-700"
              />
              {t('storeDeliveryLabel')}
            </label>
            <label className="block text-sm font-medium text-zinc-700 mb-1">{t('storeBioLabel')}</label>
            <textarea
              className={inputCls + ' mb-4'}
              value={bio}
              maxLength={500}
              rows={3}
              placeholder={t('storeBioPlaceholder')}
              onChange={(e) => setBio(e.target.value)}
            />
            <div className="flex gap-2">
              <button onClick={submit} disabled={submitting} className={btnCls}>
                {submitting ? t('loading') : t('storeVerifyRequest')}
              </button>
              <button onClick={() => setShowDialog(false)} className={btnSecondaryCls}>
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInfo && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" dir={dir}>
          <div
            ref={infoDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('proInfoTitle')}
            className="bg-white rounded-2xl p-5 w-full max-w-md"
          >
            <h2 className="text-lg font-bold text-zinc-900 mb-4">{t('proInfoTitle')}</h2>
            <ol className="list-decimal list-inside space-y-2 text-sm text-zinc-700 mb-4">
              {benefits.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ol>
            <button onClick={() => setShowInfo(false)} className={btnSecondaryCls + ' w-full'}>
              {t('close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StoreVerifyPage() {
  const auth = useRequireAuth();
  if (auth.status === 'loading') return <LoadingSpinner />;
  if (auth.status === 'signed-out') return <LoadingSpinner />;
  return <StoreVerifyApp user={auth.user} client={auth.client} />;
}
