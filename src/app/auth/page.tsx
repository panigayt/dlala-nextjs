'use client';

// Dlala auth page — client component (interactive, no SSR needed).
//
// Uses the shared Firebase **compat** SDK loader (src/lib/firebase-compat):
// auth + firestore compat SDKs at runtime from the gstatic CDN (same 10.12.0
// version the production SPA uses). Runtime <script> injection keeps the SDKs
// out of the Next.js bundle entirely — zero bundler issues.
//
// Signup creates the account atomically (js/auth.js parity):
//  1. Username registry pre-check BEFORE the Auth account is created
//     (m-15: a taken handle must not leave an Auth account with no user doc).
//  2. Atomic batch: users/{uid} profile doc + usernames/{lower} registry,
//     with every required field (termsAcceptedAt = one-time legal evidence).
//  3. Mandatory terms checkbox — no acceptance, no account.
//  4. Email-verification gate — nobody proceeds to / unverified.
// A retry-after-commit (L9) and a post-login orphan heal (P2) keep accounts
// structurally valid even when a network blip interrupts signup.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getFirebase,
  withAuthRetry,
  withTimeout,
  type CompatAuth,
  type CompatUser,
  type FirebaseCompat,
} from '../../lib/firebase-compat';
import { authReturnTarget } from '../../lib/auth-return';
import { useLang } from '../../lib/i18n';
import {
  isDisposableEmail,
  hasPlusAddress,
} from '../../lib/auth-security';

// Friendly localized messages for Firebase auth errors.
// Mirrors js/auth.js authErrorMessage() exactly:
// wrong-password/user-not-found -> "incorrect credentials"; network/timeout ->
// "connection problem". Never blame credentials for a network fault, and never
// surface raw codes or raw JS errors.
function authErrorMessage(e: unknown, t: (k: string) => string, fallbackKey: string): string {
  const code = (e as { code?: string } | null)?.code || '';
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
      return t('loginError');
    case 'auth/invalid-email':
      return t('resetEmailInvalid');
    case 'auth/network-request-failed':
    case 'auth/timeout':
    case 'deadline-exceeded':
    case 'sdk-load-failed':
      return t('authConnectionProblem');
    case 'auth/email-already-in-use':
      return t('authEmailInUse');
    case 'auth/weak-password':
      return t('authWeakPassword');
    case 'auth/too-many-requests':
      return t('authTooManyRequests');
    case 'auth/user-disabled':
      return t('authUserDisabled');
    default:
      return t(fallbackKey);
  }
}

// --- Firestore helpers (js/auth.js parity) ---

interface DocRefLike {
  get: () => Promise<{ exists: () => boolean }>;
}

function fieldValue(fb: FirebaseCompat) {
  return (fb.firestore as unknown as { FieldValue: { serverTimestamp: () => unknown } }).FieldValue;
}

// Atomic batch: users/{uid} profile doc + usernames/{lower} registry.
// Mirrors js/auth.js ensureUserDoc() — rules-compliant create with every
// required field (termsAcceptedAt = one-time acceptance, legal evidence).
async function ensureUserDoc(fb: FirebaseCompat, uid: string, name: string, username: string): Promise<void> {
  const db = fb.firestore();
  const snap = await withTimeout((db.doc('users/' + uid) as unknown as DocRefLike).get());
  if (snap.exists()) return;
  const batch = db.batch();
  batch.set(db.doc('users/' + uid), {
    name: name || '',
    username: username || '',
    verified: false,
    isAdmin: false,
    emailVerified: false,
    rating: 0,
    ratingCount: 0,
    confirmedDeals: 0,
    boostCredits: 0,
    phone: '',
    termsAcceptedAt: fieldValue(fb).serverTimestamp(),
    createdAt: fieldValue(fb).serverTimestamp(),
  });
  batch.set(db.doc('usernames/' + username.toLowerCase()), { userId: uid });
  await withTimeout(batch.commit());
}

// Collision-safe username claim for the login heal path (legacy P2).
// Prefers the signup-chosen handle (recovered from sessionStorage); falls
// back to a deterministic derivation with a uid-suffix collision escape.
async function claimUsername(
  fb: FirebaseCompat,
  uid: string,
  preferred: string | null,
  fallbackName: string
): Promise<string> {
  const db = fb.firestore();
  const candidates: string[] = [];
  if (preferred && /^[a-z0-9._]{3,20}$/.test(preferred)) candidates.push(preferred);
  let base = (fallbackName || 'user').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 16);
  if (base.length < 3) base = 'user';
  candidates.push(base);
  candidates.push((base + '_' + uid.slice(0, 4)).toLowerCase().slice(0, 20));
  for (const c of candidates) {
    if (!/^[a-z0-9._]{3,20}$/.test(c)) continue;
    try {
      const snap = await withTimeout((db.doc('usernames/' + c) as unknown as DocRefLike).get());
      if (!snap.exists()) return c;
    } catch {
      // treat as taken, try the next candidate
    }
  }
  return (base.slice(0, 11) + '_' + uid.slice(0, 7)).toLowerCase().slice(0, 20);
}

type Mode = 'login' | 'signup' | 'reset' | 'verify';

// Signup-chosen profile stashed so a post-signup network failure can still
// create the exact user doc on the next sign-in (P2 orphan heal).
const PENDING_KEY = 'dlala_pending_profile';

export default function AuthPage() {
  const router = useRouter();
  // Round 110: all user-facing strings come from the shared i18n store
  // (js/i18n.js setLang parity) — the header language switcher
  // re-renders this page in the chosen language.
  const { t, lang } = useLang();
  // js/auth.js boot parity: ?mode=signup starts guests on the signup form
  // (lazy init — no setState-in-effect).
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return new URLSearchParams(window.location.search).get('mode') === 'signup'
        ? 'signup'
        : 'login';
    } catch {
      return 'login';
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyDone, setVerifyDone] = useState(false);
  const mounted = useRef(true);
  const unsubRef = useRef<(() => void) | null>(null);

  // js/auth.js authReturnTarget parity — sanitized ?return= continuation
  // after sign-in / verification-continue (L2: /auth never a return target).
  const returnTarget = useCallback((): string => {
    try {
      return authReturnTarget(new URLSearchParams(window.location.search).get('return'));
    } catch {
      return '/account';
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Already signed in: verified users proceed to their return target,
    // unverified users land on the verification gate.
    let cancelled = false;
    getFirebase()
      .then((fb) => {
        if (cancelled) return;
        unsubRef.current = fb.auth().onAuthStateChanged((u) => {
          if (!mounted.current || !u) return;
          if (u.emailVerified) {
            router.push(returnTarget());
          } else {
            setVerifyEmail(u.email || '');
            setVerifyDone(false);
            setMode('verify');
          }
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      mounted.current = false;
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [router, returnTarget]);

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setError(null);
    setOkMsg(null);
  }, []);

  const showVerifyGate = useCallback((u: CompatUser | null) => {
    setVerifyEmail(u?.email || '');
    setVerifyDone(!!u?.emailVerified);
    setError(null);
    setOkMsg(null);
    setMode('verify');
  }, []);

  async function handleLogin(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOkMsg(null);
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError(t('resetEmailInvalid'));
      return;
    }
    setLoading(true);
    try {
      const fb = await getFirebase();
      const auth = fb.auth();
      const cred = await withAuthRetry(() => auth.signInWithEmailAndPassword(em, password));
      // M3: sign-in success is determined by the sign-in result itself.
      // A post-login reload() failure must NOT flip a success into a
      // failure — log it and continue with the cached verification flag.
      let verified = !!cred.user.emailVerified;
      try {
        await withTimeout(cred.user.reload());
        verified = !!cred.user.emailVerified;
      } catch (e) {
        console.error('post-login reload failed (non-fatal):', e);
      }
      // P2: heal an orphaned signup — if the user doc was never created
      // (post-signup failure), create it now so the account is complete.
      try {
        const snap = await withTimeout(
          (fb.firestore().doc('users/' + cred.user.uid) as unknown as DocRefLike).get()
        );
        if (!snap.exists()) {
          let nm = cred.user.displayName || '';
          let un: string | null = null;
          try {
            const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
            if (pending && pending.uid === cred.user.uid && pending.username) {
              nm = pending.name || nm;
              un = pending.username;
            }
          } catch {
            // no stashed profile — derive below
          }
          const claimed = await claimUsername(
            fb,
            cred.user.uid,
            un,
            nm || (cred.user.email || '').split('@')[0]
          );
          await ensureUserDoc(fb, cred.user.uid, nm, claimed);
          try {
            sessionStorage.removeItem(PENDING_KEY);
          } catch {
            // non-fatal
          }
        }
      } catch (e) {
        console.error('post-login user-doc heal failed (non-fatal):', e);
      }
      if (!mounted.current) return;
      setLoading(false);
      if (verified) {
        router.push(returnTarget());
      } else {
        showVerifyGate(cred.user);
      }
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, t, 'loginError'));
        setLoading(false);
      }
    }
  }

  async function handleSignup(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOkMsg(null);
    const displayName = name.trim();
    const handle = username.trim().toLowerCase();
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError(t('resetEmailInvalid'));
      return;
    }
    // Latin-script rules mirror the app: name Latin, handle 3-20 [a-z0-9._]
    if (!/^[A-Za-z][A-Za-z .'-]{1,38}$/.test(displayName) || !/^[a-z0-9._]{3,20}$/.test(handle)) {
      setError(t('signupError'));
      return;
    }
    // Terms are accepted exactly once, at signup — never shown again.
    if (!terms) {
      setError(t('termsRequired'));
      return;
    }
    // Client-side 8-char minimum (Firebase's server policy stays untouched).
    if (password.length < 8) {
      setError(t('authWeakPassword'));
      return;
    }
    setLoading(true);
    let fb: FirebaseCompat | null = null;
    try {
      fb = await getFirebase();
      const auth: CompatAuth = fb.auth();
      // SECURITY (15 Sep 2026): block disposable/temporary email domains.
      // js/auth.js parity — checked after the SDK loads, before the username
      // registry pre-check.
      if (isDisposableEmail(em)) {
        if (mounted.current) {
          setError(t('disposableEmail'));
          setLoading(false);
        }
        return;
      }
      // SECURITY (15 Sep 2026): block plus-addressing (user+1@gmail.com)
      // to prevent mass account creation with aliases.
      // AUT-3 (16 Sep 2026): dedicated message — a plus-address is not a
      // "disposable" email and must not say so.
      if (hasPlusAddress(em)) {
        if (mounted.current) {
          setError(t('plusEmailNotAllowed'));
          setLoading(false);
        }
        return;
      }
      // m-15: check the username registry BEFORE creating the Auth account —
      // a taken handle used to fail the post-creation batch in ensureUserDoc(),
      // leaving an Auth account with no user doc (a stuck account). The batch
      // commit still guards the TOCTOU race atomically.
      const regSnap = await withTimeout(
        (fb.firestore().doc('usernames/' + handle) as unknown as DocRefLike).get()
      );
      if (regSnap.exists()) {
        if (mounted.current) {
          setError(t('usernameTaken'));
          setLoading(false);
        }
        return;
      }
      const cred = await withAuthRetry(() => auth.createUserWithEmailAndPassword(em, password));
      // The Auth account now exists. Post-creation steps must NEVER orphan
      // it — on failure we still advance (the user doc is created idempotently
      // by ensureUserDoc on the next sign-in too) and report what happened.
      try {
        await withTimeout(cred.user.updateProfile({ displayName }));
      } catch (e) {
        console.error('updateProfile failed (non-fatal):', e);
      }
      try {
        sessionStorage.setItem(
          PENDING_KEY,
          JSON.stringify({ uid: cred.user.uid, name: displayName, username: handle })
        );
      } catch {
        // non-fatal
      }
      // Round 24: the doc-failure note must surface in the VISIBLE mode
      // (verify), never in the hidden signup form.
      let docRetryNote = false;
      try {
        await ensureUserDoc(fb, cred.user.uid, displayName, handle);
        try {
          sessionStorage.removeItem(PENDING_KEY);
        } catch {
          // non-fatal
        }
      } catch (e) {
        console.error('ensureUserDoc failed (will retry on sign-in):', e);
        docRetryNote = true;
      }
      try {
        await withTimeout(cred.user.sendEmailVerification());
      } catch (e) {
        console.error('sendEmailVerification failed (non-fatal):', e);
      }
      if (!mounted.current) return;
      setLoading(false);
      showVerifyGate(cred.user);
      if (docRetryNote) setError(t('signupDocRetry'));
    } catch (e) {
      // L9: retry-after-commit — createUser may have committed server-side
      // while the response was lost; the retry then fails with
      // email-already-in-use. Try signing in with the same credentials; if
      // it works, the account was created by our request.
      const code = (e as { code?: string } | null)?.code || '';
      if (code === 'auth/email-already-in-use') {
        try {
          const fbL9 = fb ?? (await getFirebase());
          const signInCred = await withTimeout(
            fbL9.auth().signInWithEmailAndPassword(em, password)
          );
          try {
            await withTimeout(signInCred.user.updateProfile({ displayName }));
          } catch {
            // non-fatal
          }
          try {
            await ensureUserDoc(fbL9, signInCred.user.uid, displayName, handle);
          } catch {
            // P2 heal covers this on the next sign-in
          }
          try {
            await withTimeout(signInCred.user.sendEmailVerification());
          } catch {
            // non-fatal
          }
          if (!mounted.current) return;
          setLoading(false);
          showVerifyGate(signInCred.user);
          return;
        } catch (se) {
          // Sign-in failed: genuine email-in-use by someone else.
          console.error('L9 sign-in fallback failed:', se);
        }
      }
      if (mounted.current) {
        setError(authErrorMessage(e, t, 'signupError'));
        setLoading(false);
      }
    }
  }

  async function handleReset(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOkMsg(null);
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError(t('resetEmailInvalid'));
      return;
    }
    setLoading(true);
    try {
      const fb = await getFirebase();
      await withAuthRetry(() => fb.auth().sendPasswordResetEmail(em));
      if (mounted.current) {
        setOkMsg(t('resetLinkSent'));
        setLoading(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, t, 'errorGeneric'));
        setLoading(false);
      }
    }
  }

  // Verify gate: "I verified, continue" — reloads the user and proceeds only
  // when the email is actually verified, so users are never stuck.
  async function handleVerifyContinue() {
    setError(null);
    setOkMsg(null);
    setLoading(true);
    try {
      const fb = await getFirebase();
      const u = fb.auth().currentUser;
      if (!u) {
        if (mounted.current) {
          setLoading(false);
          switchMode('login');
        }
        return;
      }
      try {
        await withTimeout(u.reload());
      } catch (e) {
        console.error('verify-continue reload failed:', e);
        if (mounted.current) {
          setError(authErrorMessage(e, t, 'errorGeneric'));
          setLoading(false);
        }
        return;
      }
      if (!mounted.current) return;
      const verified = !!u.emailVerified;
      setVerifyDone(verified);
      if (verified) {
        router.push(returnTarget());
      } else {
        // Still not verified — say so plainly, don't leave them guessing.
        setError(t('verifyStillPending'));
        setLoading(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, t, 'errorGeneric'));
        setLoading(false);
      }
    }
  }

  async function handleResend() {
    setError(null);
    setOkMsg(null);
    setLoading(true);
    try {
      const fb = await getFirebase();
      const u = fb.auth().currentUser;
      if (!u) {
        if (mounted.current) {
          setLoading(false);
          switchMode('login');
        }
        return;
      }
      await withAuthRetry(() => u.sendEmailVerification());
      if (mounted.current) {
        // Success and failure states are exclusive.
        setOkMsg(t('emailSent'));
        setLoading(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, t, 'errorGeneric'));
        setLoading(false);
      }
    }
  }

  async function handleVerifyLogout() {
    try {
      const fb = await getFirebase();
      await fb.auth().signOut();
    } catch (e) {
      // A failed sign-out must surface in the VISIBLE mode (verify), never
      // in the hidden login mode.
      console.error(e);
      if (mounted.current) setError(authErrorMessage(e, t, 'errorGeneric'));
      return;
    }
    if (mounted.current) switchMode('login');
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 text-base';
  const btnCls =
    'w-full rounded-lg bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-60 disabled:cursor-wait transition-colors';
  const btnSecondaryCls =
    'w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 transition-colors';

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className="bg-emerald-700 text-white shadow">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">
            {t('appName')}
          </Link>
          <span className="text-sm">{t('authTagline')}</span>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-10">
        <div className="rounded-2xl bg-white shadow-sm p-6">
          {mode === 'login' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">{t('login')}</h1>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <form onSubmit={handleLogin} noValidate>
                <label htmlFor="lEmail" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('email')}
                </label>
                <input
                  id="lEmail"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  className={inputCls + ' mb-4 text-left'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <label htmlFor="lPass" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('password')}
                </label>
                <input
                  id="lPass"
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  className={inputCls + ' mb-5 text-left'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button type="submit" className={btnCls} disabled={loading}>
                  {loading ? t('pleaseWait') : t('loginBtn')}
                </button>
              </form>
              <p className="mt-4 text-sm text-center">
                <button
                  type="button"
                  onClick={() => switchMode('reset')}
                  className="text-emerald-700 hover:underline"
                >
                  {t('forgotPassword')}
                </button>
              </p>
              <p className="mt-2 text-sm text-center text-zinc-600">
                {t('noAccountQ')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="text-emerald-700 font-medium hover:underline"
                >
                  {t('createAccountLink')}
                </button>
              </p>
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">{t('signup')}</h1>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <form onSubmit={handleSignup} noValidate>
                <label htmlFor="sName" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('name')}
                </label>
                <p className="text-xs text-zinc-500 mb-1">{t('nameHint')}</p>
                <input
                  id="sName"
                  dir="ltr"
                  maxLength={40}
                  autoComplete="name"
                  className={inputCls + ' mb-4 text-left'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <label htmlFor="sUser" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('username')}
                </label>
                <p className="text-xs text-zinc-500 mb-1">{t('usernameHint')}</p>
                <input
                  id="sUser"
                  dir="ltr"
                  maxLength={20}
                  autoComplete="username"
                  className={inputCls + ' mb-4 text-left'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  required
                />
                <label htmlFor="sEmail" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('email')}
                </label>
                <input
                  id="sEmail"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  className={inputCls + ' mb-4 text-left'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <label htmlFor="sPass" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('passwordMin8')}
                </label>
                <input
                  id="sPass"
                  type="password"
                  dir="ltr"
                  minLength={8}
                  autoComplete="new-password"
                  className={inputCls + ' mb-5 text-left'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <label htmlFor="sTerms" className="flex items-start gap-2 mb-5 text-sm text-zinc-700 cursor-pointer">
                  <input
                    id="sTerms"
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-emerald-700"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                  />
                  <span>
                    {t('agreeTo')}{' '}
                    <Link href="/terms" className="text-emerald-700 hover:underline">
                      {t('termsLink')}
                    </Link>
                  </span>
                </label>
                <button type="submit" className={btnCls} disabled={loading}>
                  {loading ? t('pleaseWait') : t('signupBtn')}
                </button>
              </form>
              <p className="mt-4 text-sm text-center text-zinc-600">
                {t('haveAccountQ')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-emerald-700 font-medium hover:underline"
                >
                  {t('signInLink')}
                </button>
              </p>
            </div>
          )}

          {mode === 'reset' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">{t('forgotPassword')}</h1>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              {okMsg && (
                <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                  {okMsg}
                </div>
              )}
              <form onSubmit={handleReset} noValidate>
                <label htmlFor="rEmail" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('email')}
                </label>
                <input
                  id="rEmail"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  className={inputCls + ' mb-5 text-left'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <button type="submit" className={btnCls} disabled={loading}>
                  {loading ? t('pleaseWait') : t('sendResetLink')}
                </button>
              </form>
              <p className="mt-4 text-sm text-center">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-emerald-700 font-medium hover:underline"
                >
                  {t('backToLogin')}
                </button>
              </p>
            </div>
          )}

          {mode === 'verify' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-3">{t('verifyEmailTitle')}</h1>
              <div className="mb-4 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-sm text-sky-800">
                {t('verifyEmailBody')}
              </div>
              {verifyEmail && (
                <p className="mb-2 text-sm text-zinc-600" dir="ltr" style={{ textAlign: 'right' }}>
                  {verifyEmail}
                </p>
              )}
              <p className="mb-4 text-sm text-zinc-600">
                {t('verifyStatusLabel')}{' '}
                <strong className={verifyDone ? 'text-emerald-700' : 'text-amber-700'}>
                  {verifyDone ? t('verifyStatusDone') : t('verifyStatusPending')}
                </strong>
              </p>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              {okMsg && (
                <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                  {okMsg}
                </div>
              )}
              <button type="button" className={btnCls} disabled={loading} onClick={handleVerifyContinue}>
                {loading ? t('pleaseWait') : t('verifiedContinue')}
              </button>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={btnSecondaryCls}
                  disabled={loading}
                  onClick={handleResend}
                >
                  {t('resendEmail')}
                </button>
                <button
                  type="button"
                  className={btnSecondaryCls}
                  disabled={loading}
                  onClick={handleVerifyLogout}
                >
                  {t('logout')}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
