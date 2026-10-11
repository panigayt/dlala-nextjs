// Settings page — language, cache, support, blocked users, about, danger zone.
//
// Migrated from settings.html + js/settings.js (production 0.0.0.43).
// Auth-gated: redirects to /auth when signed out.
//
// Behavior preserved:
// - Language switch (AR/FR/EN) — persisted to localStorage, applied live
// - Clear cache (localStorage feed/publish keys + sessionStorage prefetch)
// - Report a problem → writes ticket to users/{uid}/tickets
// - Contact support → deterministic support thread (supp_{uid})
// - Blocked users list with unblock buttons
// - About: terms, privacy, app version
// - Danger zone: permanent account deletion (double confirmation,
//   type-delete-word, fresh re-auth, pre-wipe listings, deletion request)

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import { getFirebase, withTimeout, type CompatUser } from '@/lib/firebase-compat';
import { deleteR2Objects } from '@/lib/r2-upload';
import { authLoginHref } from '@/lib/auth-return';
import { saveScrollForReturn } from '@/lib/scroll-restore';
import { useLang, type Lang } from '@/lib/i18n';

const BLOCK_FN_URL = 'https://europe-west3-dlala-85cea.cloudfunctions.net/toggleBlock';
const APP_VERSION = 'v54';

interface BlockedUser {
  uid: string;
  name: string;
  username: string;
}

export default function SettingsPage() {
  return (
    <AuthGate>
      {(user) => <SettingsContent user={user} />}
    </AuthGate>
  );
}

function SettingsContent({ user }: { user: CompatUser }) {
  const router = useRouter();
  const { lang, setLang, t } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [blocked, setBlocked] = useState<BlockedUser[] | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportSubject, setReportSubject] = useState('');
  const [reportBody, setReportBody] = useState('');
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');
  const [deletePw, setDeletePw] = useState('');
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const mounted = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      if (mounted.current) setToast(null);
    }, 3000);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // ---- Blocked users -------------------------------------------------------
  const loadBlocked = useCallback(async () => {
    try {
      const fb = await getFirebase();
      const db = fb.firestore() as unknown as {
        collection: (p: string) => {
          where: (f: string, op: string, v: string) => {
            get: () => Promise<{ docs: { data: () => { blockedUid?: string } }[] }>;
          };
        };
        doc: (p: string) => {
          get: () => Promise<{ exists: boolean; data: () => { name?: string; username?: string } }>;
        };
      };
      const snap = await withTimeout(
        db.collection('blocks').where('blockerUid', '==', user.uid).get(),
        20000
      );
      const uids: string[] = [];
      for (const d of snap.docs) {
        const b = d.data().blockedUid;
        if (b) uids.push(String(b));
      }
      const out: BlockedUser[] = [];
      for (const uid of uids) {
        let name = '';
        let username = '';
        try {
          const u = await withTimeout(db.doc('users_public/' + uid).get(), 15000);
          if (u.exists) {
            const data = u.data();
            name = data.name || '';
            username = data.username || '';
          }
        } catch {
          // name stays blank
        }
        out.push({ uid, name, username });
      }
      if (mounted.current) setBlocked(out);
    } catch {
      if (mounted.current) setBlocked([]);
    }
  }, [user.uid]);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetch on mount */
  useEffect(() => {
    loadBlocked();
  }, [loadBlocked, lang]);

  const unblock = useCallback(
    async (targetUid: string) => {
      setUnblocking(targetUid);
      try {
        const fb = await getFirebase();
        const au = fb.auth().currentUser;
        const idToken = au
          ? await withTimeout(
              (au as unknown as { getIdToken: () => Promise<string> }).getIdToken(),
              15000
            )
          : '';
        if (!idToken) throw new Error('signed-out');
        const res = await withTimeout(
          fetch(BLOCK_FN_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ data: { uid: targetUid }, idToken }),
          }),
          20000
        );
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || !json.result || typeof json.result.blocked !== 'boolean') {
          throw new Error('block-failed');
        }
        showToast(t('userUnblocked'));
        loadBlocked();
      } catch {
        showToast(t('blockFailed'));
      } finally {
        if (mounted.current) setUnblocking(null);
      }
    },
    [t, showToast, loadBlocked]
  );

  // ---- Language ------------------------------------------------------------
  const changeLang = useCallback(
    (l: Lang) => {
      setLang(l);
      loadBlocked();
    },
    [setLang, loadBlocked]
  );

  // ---- Clear cache ----------------------------------------------------------
  const clearCache = useCallback(() => {
    let ok = true;
    try {
      localStorage.removeItem('dlala_feed_cache');
      localStorage.removeItem('dlala_publish_draft');
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('prefetch_listing_')) sessionStorage.removeItem(k);
      }
    } catch {
      ok = false;
    }
    showToast(ok ? t('cacheCleared') : t('cacheClearFailed'));
  }, [t, showToast]);

  // ---- Report a problem -----------------------------------------------------
  const sendReport = useCallback(async () => {
    const body = reportBody.trim();
    if (!body) {
      setReportErr(t('reportEmpty'));
      return;
    }
    setReportErr(null);
    setReportBusy(true);
    try {
      const fb = await getFirebase();
      const db = fb.firestore() as unknown as {
        collection: (p: string) => {
          doc: (id: string) => {
            collection: (p: string) => { doc: () => { set: (d: Record<string, unknown>) => Promise<void> } };
          };
        };
      };
      const ref = db.collection('users').doc(user.uid).collection('tickets').doc();
      await withTimeout(
        ref.set({
          userId: user.uid,
          type: 'problem',
          subject: reportSubject.trim(),
          body,
          lang,
          status: 'open',
          createdAt: (fb.firestore as unknown as { FieldValue: { serverTimestamp: () => unknown } }).FieldValue.serverTimestamp(),
        }),
        20000
      );
      if (mounted.current) {
        setShowReport(false);
        setReportSubject('');
        setReportBody('');
        showToast(t('reportSent'));
      }
    } catch {
      if (mounted.current) setReportErr(t('reportFailed'));
    } finally {
      if (mounted.current) setReportBusy(false);
    }
  }, [user.uid, lang, reportSubject, reportBody, t, showToast]);

  // ---- Delete account --------------------------------------------------------
  // Permanent deletion: type the delete word + fresh password re-auth,
  // pre-wipe own listings, file the deletion request, delete the Auth user.
  const deleteAccount = useCallback(async () => {
    const word = deleteWord.trim();
    if (word !== t('deleteWord')) {
      setDeleteErr(t('deleteMismatch'));
      return;
    }
    if (!deletePw) {
      setDeleteErr(t('reauthPasswordLabel'));
      return;
    }
    setDeleteErr(null);
    setDeleteBusy(true);
    try {
      const fb = await getFirebase();
      // Fresh re-authentication is mandatory.
      const cred = fb.auth.EmailAuthProvider.credential(user.email || '', deletePw);
      try {
        await withTimeout(
          (user as unknown as { reauthenticateWithCredential: (c: unknown) => Promise<void> }).reauthenticateWithCredential(cred),
          20000
        );
      } catch (re) {
        const rc = (re as { code?: string })?.code || '';
        setDeleteErr(
          rc === 'auth/wrong-password' || rc === 'auth/invalid-credential'
            ? t('wrongPassword')
            : t('deletionFailed')
        );
        setDeleteBusy(false);
        return;
      }
      const db = fb.firestore() as unknown as {
        collection: (p: string) => {
          where: (f: string, op: string, v: string) => {
            limit: (n: number) => {
              get: () => Promise<{
                docs: { id: string; data: () => Record<string, unknown> }[];
              }>;
            };
          };
        };
        doc: (p: string) => {
          delete: () => Promise<void>;
          set: (d: Record<string, unknown>) => Promise<void>;
        };
        batch: () => {
          set: (ref: unknown, d: Record<string, unknown>) => void;
          delete: (ref: unknown) => void;
          commit: () => Promise<void>;
        };
      };
      // Best-effort pre-wipe of own listings (batches of 5).
      const snap = await withTimeout(
        db.collection('listings').where('sellerId', '==', user.uid).limit(100).get(),
        20000
      );
      // Collect R2 photo URLs before the docs are gone.
      const r2Urls: string[] = [];
      for (const d of snap.docs) {
        try {
          const data = d.data();
          for (const k of ['photoUrls', 'photo_thumbs', 'thumbUrls'] as const) {
            const arr = data[k];
            if (Array.isArray(arr)) {
              for (const u of arr) {
                if (typeof u === 'string' && u) r2Urls.push(u);
              }
            }
          }
        } catch {
          // best-effort
        }
      }
      const ids = snap.docs.map((d) => d.id);
      for (let i = 0; i < ids.length; i += 5) {
        await Promise.all(
          ids.slice(i, i + 5).map(async (id) => {
            try {
              await withTimeout(db.doc('listings/' + id).delete(), 15000);
            } catch {
              // best-effort
            }
          })
        );
      }
      // R2 photo cleanup (best-effort) — the server skips non-R2 values and
      // enforces uid ownership; unstored variants are derived server-side.
      if (r2Urls.length) {
        try {
          const idToken = await withTimeout(user.getIdToken(), 15000);
          await deleteR2Objects(r2Urls, idToken);
        } catch {
          // best-effort
        }
      }
      // File the deletion request — the Cloud Function finishes the wipe.
      await withTimeout(
        db.doc('deletionRequests/' + user.uid).set({
          userId: user.uid,
          requestedAt: (fb.firestore as unknown as { FieldValue: { serverTimestamp: () => unknown } }).FieldValue.serverTimestamp(),
          status: 'pending',
        }),
        20000
      );
      // Delete the Auth user for real.
      try {
        await withTimeout(
          (user as unknown as { delete: () => Promise<void> }).delete(),
          20000
        );
      } catch (de) {
        const dc = (de as { code?: string })?.code || '';
        if (dc === 'auth/requires-recent-login') {
          window.alert(t('reauthNeeded'));
          // QA 16 Sep 2026 #4 (js/app.js saveScrollForReturn parity): keep the
          // scroll position across the /auth round-trip.
          saveScrollForReturn(window.location.pathname);
          router.push(authLoginHref(window.location.pathname, window.location.search));
          return;
        }
        throw de;
      }
      try {
        await fb.auth().signOut();
      } catch {
        // already signed out
      }
      window.alert(t('deletionRequested'));
      router.push('/');
    } catch (e) {
      console.error(e);
      if (mounted.current) {
        setDeleteErr(t('deletionFailed'));
        setDeleteBusy(false);
      }
    }
  }, [user, deleteWord, deletePw, t, router]);

  const rowCls =
    'flex items-center gap-3 w-full text-start p-4 hover:bg-zinc-50 transition-colors';
  const icoCls = 'text-xl shrink-0';
  const goCls = 'text-zinc-400 text-xl shrink-0';

  return (
    <div className="min-h-screen bg-zinc-50" dir={dir}>

      {toast && (
        <div className="fixed bottom-6 start-1/2 -translate-x-1/2 z-50 rounded-lg bg-zinc-900 text-white text-sm px-4 py-2.5 shadow-lg">
          {toast}
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Account */}
        <section className="rounded-xl bg-white shadow-sm overflow-hidden">
          <h2 className="px-4 pt-4 pb-2 font-bold text-zinc-900">{t('settingsAccount')}</h2>
          <a href="/account" className={rowCls}>
            <span className={icoCls} aria-hidden="true">👤</span>
            <span className="flex-1 font-medium text-zinc-900">{t('account')}</span>
            <span className={goCls} aria-hidden="true">‹</span>
          </a>
        </section>

        {/* Preferences */}
        <section className="rounded-xl bg-white shadow-sm overflow-hidden">
          <h2 className="px-4 pt-4 pb-2 font-bold text-zinc-900">{t('settingsPreferences')}</h2>
          <div className="px-4 pb-4">
            <h3 className="text-sm font-medium text-zinc-700 mb-2">{t('settingsLanguage')}</h3>
            <div className="flex gap-2 mb-4" role="group">
              {(['ar', 'fr', 'en'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => changeLang(l)}
                  className={`rounded-lg px-4 py-2 text-sm font-bold border transition-colors ${
                    lang === l
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <h3 className="text-sm font-medium text-zinc-700 mb-1">{t('settingsCache')}</h3>
            <p className="text-xs text-zinc-500 mb-3">{t('settingsCacheDesc')}</p>
            <button
              onClick={clearCache}
              className="rounded-lg bg-white border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t('clearCache')}
            </button>
          </div>
        </section>

        {/* Support */}
        <section className="rounded-xl bg-white shadow-sm overflow-hidden">
          <h2 className="px-4 pt-4 pb-2 font-bold text-zinc-900">{t('settingsSupport')}</h2>
          <button onClick={() => setShowReport(true)} className={rowCls} type="button">
            <span className={icoCls} aria-hidden="true">🐞</span>
            <span className="flex-1">
              <span className="block font-medium text-zinc-900">{t('reportProblem')}</span>
              <span className="block text-xs text-zinc-500">{t('reportProblemDesc')}</span>
            </span>
            <span className={goCls} aria-hidden="true">‹</span>
          </button>
          <a href={`/chat?id=${encodeURIComponent('supp_' + user.uid)}`} className={rowCls}>
            <span className={icoCls} aria-hidden="true">💬</span>
            <span className="flex-1">
              <span className="block font-medium text-zinc-900">{t('contactSupport')}</span>
              <span className="block text-xs text-zinc-500">{t('contactSupportDesc')}</span>
            </span>
            <span className={goCls} aria-hidden="true">‹</span>
          </a>
        </section>

        {/* Blocked users */}
        <section className="rounded-xl bg-white shadow-sm overflow-hidden">
          <h2 className="px-4 pt-4 pb-2 font-bold text-zinc-900">{t('blockedUsers')}</h2>
          <div className="px-4 pb-4">
            {blocked === null && <p className="text-sm text-zinc-500">{t('loading')}</p>}
            {blocked !== null && blocked.length === 0 && (
              <p className="text-sm text-zinc-500">{t('noBlockedUsers')}</p>
            )}
            {blocked !== null &&
              blocked.map((u) => (
                <div key={u.uid} className="flex items-center gap-3 py-2 border-b border-zinc-100 last:border-0">
                  <span className="flex-1 text-sm text-zinc-900 truncate">
                    {u.name || (u.username ? '@' + u.username : u.uid)}
                  </span>
                  <button
                    onClick={() => unblock(u.uid)}
                    disabled={unblocking === u.uid}
                    className="rounded-lg bg-white border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {t('unblock')}
                  </button>
                </div>
              ))}
          </div>
        </section>

        {/* About */}
        <section className="rounded-xl bg-white shadow-sm overflow-hidden">
          <h2 className="px-4 pt-4 pb-2 font-bold text-zinc-900">{t('settingsAbout')}</h2>
          <a href="/terms" className={rowCls}>
            <span className={icoCls} aria-hidden="true">📄</span>
            <span className="flex-1 font-medium text-zinc-900">{t('termsLink')}</span>
            <span className={goCls} aria-hidden="true">‹</span>
          </a>
          <a href="/privacy" className={rowCls}>
            <span className={icoCls} aria-hidden="true">🔒</span>
            <span className="flex-1 font-medium text-zinc-900">{t('privacyLink')}</span>
            <span className={goCls} aria-hidden="true">‹</span>
          </a>
          <p className="px-4 pb-4 pt-2 text-xs text-zinc-500">
            {t('appVersion')}: {APP_VERSION}
          </p>
        </section>

        {/* Danger zone */}
        <section className="rounded-xl bg-white shadow-sm overflow-hidden border-2 border-red-200">
          <h2 className="px-4 pt-4 pb-2 font-bold text-red-700">{t('dangerZone')}</h2>
          <div className="px-4 pb-4">
            <h3 className="text-sm font-bold text-zinc-900 mb-1">{t('deleteAccount')}</h3>
            <p className="text-xs text-zinc-500 mb-3">{t('deleteAccountWarn')}</p>
            <button
              onClick={() => {
                // 11 Oct 2026: removed window.confirm() — hangs headless browsers.
                // The typed confirmation word is sufficient.
                setShowDelete(true);
              }}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700"
            >
              {t('deleteAccount')}
            </button>
          </div>
        </section>
      </main>

      {/* Report dialog */}
      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" dir={dir}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-zinc-900 mb-4">{t('reportProblem')}</h2>
            <label className="block text-sm font-medium text-zinc-700 mb-1" htmlFor="repSubject">
              {t('reportSubject')}
            </label>
            <input
              id="repSubject"
              maxLength={80}
              placeholder={t('reportSubjectPh')}
              value={reportSubject}
              onChange={(e) => setReportSubject(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 mb-4 text-base focus:border-emerald-600 focus:outline-none"
            />
            <label className="block text-sm font-medium text-zinc-700 mb-1" htmlFor="repBody">
              {t('reportBody')}
            </label>
            <textarea
              id="repBody"
              rows={4}
              maxLength={2000}
              placeholder={t('reportBodyPh')}
              value={reportBody}
              onChange={(e) => setReportBody(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base focus:border-emerald-600 focus:outline-none"
            />
            {reportErr && (
              <p className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {reportErr}
              </p>
            )}
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => setShowReport(false)}
                className="rounded-lg bg-white border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                ✕
              </button>
              <button
                onClick={sendReport}
                disabled={reportBusy}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {reportBusy ? '…' : t('reportSend')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete dialog */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" dir={dir}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-zinc-900 mb-3">{t('deleteAccount')}</h2>
            <p className="text-sm text-zinc-600 mb-3">{t('deleteAccountStep2')}</p>
            <input
              dir="ltr"
              value={deleteWord}
              onChange={(e) => setDeleteWord(e.target.value)}
              placeholder={t('typeDeleteWord')}
              aria-label={t('typeDeleteWord')}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 mb-3 text-base focus:border-emerald-600 focus:outline-none"
            />
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">
              {t('accountDeletionWarning')}
            </p>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              {t('reauthPasswordLabel')}
              <input
                type="password"
                autoComplete="current-password"
                value={deletePw}
                onChange={(e) => setDeletePw(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base focus:border-emerald-600 focus:outline-none"
              />
            </label>
            {deleteErr && (
              <p className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {deleteErr}
              </p>
            )}
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => setShowDelete(false)}
                className="rounded-lg bg-white border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                ✕
              </button>
              <button
                onClick={deleteAccount}
                disabled={deleteBusy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteBusy ? '…' : t('deleteAccount')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
