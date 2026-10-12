'use client';

// Email-action handler — mirrors js/auth-action.js.
// Firebase Auth's emails (address verification, password reset) point here
// instead of the default Firebase handler. Handles:
//   ?mode=verifyEmail&oobCode=...   -> applyActionCode -> success screen
//   ?mode=resetPassword&oobCode=... -> verifyPasswordResetCode (reveals the
//      account email) -> new-password form -> confirmPasswordReset -> success
// continueUrl: honored only for same-origin / dzdlala.com targets —
// everything else falls back to / (open-redirect hardening).
//
// All user-facing strings are verbatim from js/i18n.ar.js (production).

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  getFirebaseCdn,
  LoadingSpinner,
  inputCls,
  btnCls,
} from '@/lib/firebase';
import { useLang } from '@/lib/i18n';

// User-facing strings — t('...') keys verbatim from js/i18n.{ar,fr,en}.js
// (js/auth-action.js). Round 118: hardcoded Arabic STR replaced with useLang()
// from the shared app-wide language store (js/i18n.js setLang parity).

type Stage = 'working' | 'invalid' | 'error' | 'verifyDone' | 'resetForm' | 'resetDone';

// Only same-origin (or the production host over https) may receive the
// post-action redirect. Firebase continue URLs are attacker-influenced
// input (they ride in the email link), so this must stay strict.
function safeContinueUrl(raw: string | null): string {
  const fallback = '/';
  if (!raw || typeof window === 'undefined') return fallback;
  try {
    const u = new URL(raw, window.location.origin);
    const host = (u.hostname || '').toLowerCase();
    const me = (window.location.hostname || '').toLowerCase();
    const allowed =
      host === me || host === 'dzdlala.com' || host === 'www.dzdlala.com';
    if (!allowed) return fallback;
    if (u.protocol === 'https:') return u.href;
    if (u.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1'))
      return u.href;
    return fallback;
  } catch {
    return fallback;
  }
}

function isInvalidCodeError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code || '';
  return (
    code === 'auth/expired-action-code' ||
    code === 'auth/invalid-action-code' ||
    code === 'auth/user-not-found' ||
    code === 'auth/user-disabled'
  );
}

function AuthActionInner() {
  const { t, lang } = useLang();
  const params = useSearchParams();
  const mode = params.get('mode') || '';
  const oobCode = params.get('oobCode') || '';
  // Computed during render (client-only) — no setState-in-effect needed.
  const continueUrl = safeContinueUrl(params.get('continueUrl'));
  const [stage, setStage] = useState<Stage>(oobCode ? 'working' : 'invalid');
  const [email, setEmail] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ranRef = useRef(false);
  const oobRef = useRef(oobCode);

  useEffect(() => {
    // Action codes are single-use — never re-run after completion.
    if (ranRef.current) return;
    ranRef.current = true;
    if (!oobCode) return; // stage already 'invalid' from initial state

    (async () => {
      try {
        const { auth, authMod } = await getFirebaseCdn();
        if (mode === 'verifyEmail') {
          await authMod.applyActionCode(auth, oobCode);
          setStage('verifyDone');
        } else if (mode === 'resetPassword') {
          // Verifies the code is valid AND reveals which account it is for —
          // an expired/tampered code throws here, before any form is shown.
          const em = await authMod.verifyPasswordResetCode(auth, oobCode);
          setEmail(em || '');
          setStage('resetForm');
        } else {
          setStage('invalid');
        }
      } catch (e) {
        // A non-code error (network, etc.) means the LINK may be fine —
        // never show the "invalid link" screen for it (legacy auth-action.js
        // shows a generic error alert in this case).
        if (isInvalidCodeError(e)) setStage('invalid');
        else setStage('error');
      }
    })();
    // All setState calls above are in async continuations (after await) —
    // no synchronous setState in the effect body.
  }, [params, mode, oobCode]);

  async function doConfirmReset(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    if (pw1.length < 8) {
      setFormError(t('authWeakPassword'));
      return;
    }
    if (pw1 !== pw2) {
      setFormError(t('passwordsNoMatch'));
      return;
    }
    setSaving(true);
    try {
      const { auth, authMod } = await getFirebaseCdn();
      await authMod.confirmPasswordReset(auth, oobRef.current, pw1);
      // A password change revokes EVERY session, including this browser's —
      // sign out locally now and say so explicitly.
      try {
        await authMod.signOut(auth);
      } catch {
        /* best-effort */
      }
      setStage('resetDone');
    } catch (e) {
      if (isInvalidCodeError(e)) setStage('invalid');
      else setFormError(t('errorGeneric'));
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main className="max-w-md mx-auto px-4 py-10">
        <div className="rounded-2xl bg-white shadow-sm p-6 text-center">
          {stage === 'working' && (
            <div>
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-emerald-200 border-t-emerald-700" />
              <p className="mt-4 text-zinc-600">{t('loading')}</p>
            </div>
          )}

          {stage === 'invalid' && (
            <div>
              <div className="text-5xl mb-4">🔗</div>
              <h1 className="text-xl font-bold text-zinc-900 mb-4">
                {t('actionLinkInvalid')}
              </h1>
              <a href="/auth" className={btnCls + ' inline-block no-underline'}>
                {t('login')}
              </a>
            </div>
          )}

          {stage === 'error' && (
            <div>
              <div className="text-5xl mb-4">⚠️</div>
              <h1 className="text-xl font-bold text-zinc-900 mb-4">
                {t('errorGeneric')}
              </h1>
              <button
                type="button"
                className={btnCls}
                onClick={() => window.location.reload()}
              >
                {t('retry')}
              </button>
            </div>
          )}

          {stage === 'verifyDone' && (
            <div>
              <div className="text-5xl mb-4">✅</div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">
                {t('verifyEmailDone')}
              </h1>
              <a
                href={continueUrl}
                className={btnCls + ' inline-block no-underline'}
              >
                {t('continueToSite')}
              </a>
            </div>
          )}

          {stage === 'resetForm' && (
            <div className="text-start">
              <h1 className="text-xl font-bold text-zinc-900 mb-2 text-center">
                {t('newPasswordTitle')}
              </h1>
              {email && (
                <p className="text-sm text-zinc-500 mb-5 text-center" dir="ltr">
                  {email}
                </p>
              )}
              {formError && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}
              <form onSubmit={doConfirmReset} noValidate>
                <label
                  htmlFor="aaPw1"
                  className="block text-sm font-medium text-zinc-700 mb-1"
                >
                  {t('newPassword')}
                </label>
                <input
                  id="aaPw1"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  minLength={8}
                  className={inputCls + ' mb-4 text-left'}
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  required
                />
                <label
                  htmlFor="aaPw2"
                  className="block text-sm font-medium text-zinc-700 mb-1"
                >
                  {t('confirmNewPassword')}
                </label>
                <input
                  id="aaPw2"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  minLength={8}
                  className={inputCls + ' mb-5 text-left'}
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  required
                />
                <button type="submit" className={btnCls} disabled={saving}>
                  {saving ? t('loading') : t('saveNewPassword')}
                </button>
              </form>
            </div>
          )}

          {stage === 'resetDone' && (
            <div>
              <div className="text-5xl mb-4">✅</div>
              <h1 className="text-xl font-bold text-zinc-900 mb-2">
                {t('passwordChanged')}
              </h1>
              <p className="text-sm text-zinc-600 mb-5">
                {t('signedOutAllSessions')}
              </p>
              <a href="/auth" className={btnCls + ' inline-block no-underline'}>
                {t('login')}
              </a>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function AuthActionPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AuthActionInner />
    </Suspense>
  );
}
