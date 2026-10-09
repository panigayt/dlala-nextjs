'use client';

// Dlala auth page — client component (interactive, no SSR needed).
//
// Uses the Firebase **compat** SDK loaded at runtime from the gstatic CDN
// (same 10.12.0 version the production SPA uses). Runtime <script> injection
// keeps the SDK out of the Next.js bundle entirely — zero bundler issues,
// zero SDK bytes on any other page.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCjll9nUDSbf9h8oS0s9xRyl1S0Qh9qO5M',
  authDomain: 'dlala-85cea.firebaseapp.com',
  projectId: 'dlala-85cea',
};

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.0/';
const APP_SDK = SDK_BASE + 'firebase-app-compat.js';
const AUTH_SDK = SDK_BASE + 'firebase-auth-compat.js';

// Arabic user-facing strings — verbatim from js/i18n.ar.js (production).
const STR = {
  loginError: 'بيانات الدخول غير صحيحة',
  errorGeneric: 'حدث خطأ — حاول مجدداً',
  resetLinkSent: 'تم إرسال رابط الاستعادة إلى بريدك',
  resetEmailInvalid: 'أدخل بريداً إلكترونياً صالحاً',
  authConnectionProblem: 'مشكلة في الاتصال — تحقق من الإنترنت وحاول مجدداً',
  authEmailInUse: 'هذا البريد مسجّل بالفعل — سجّل الدخول',
  authTooManyRequests: 'محاولات كثيرة — انتظر قليلاً ثم حاول مجدداً',
  authUserDisabled: 'هذا الحساب معطّل — تواصل مع الدعم',
  authWeakPassword: 'كلمة المرور ضعيفة جداً — استخدم 8 أحرف على الأقل',
  pleaseWait: 'جارٍ الانتظار...',
  sdkLoadFailed: 'تعذر تحميل خدمة الدخول — تحقق من الاتصال وحاول مجدداً',
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('sdk-load-failed'));
    document.head.appendChild(s);
  });
}

interface FirebaseCompat {
  apps: unknown[];
  initializeApp: (cfg: typeof FIREBASE_CONFIG) => unknown;
  auth: (() => FirebaseAuthCompat) & {
    Auth: { Persistence: { LOCAL: string } };
  };
}

interface FirebaseAuthCompat {
  setPersistence: (p: string) => Promise<void>;
  signInWithEmailAndPassword: (email: string, pass: string) => Promise<{ user: FirebaseUserCompat }>;
  createUserWithEmailAndPassword: (email: string, pass: string) => Promise<{ user: FirebaseUserCompat }>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  onAuthStateChanged: (cb: (u: FirebaseUserCompat | null) => void) => () => void;
}

interface FirebaseUserCompat {
  updateProfile: (p: { displayName?: string }) => Promise<void>;
  sendEmailVerification: () => Promise<void>;
}

let authInitP: Promise<FirebaseAuthCompat> | null = null;

async function getAuth(): Promise<FirebaseAuthCompat> {
  if (authInitP) return authInitP;
  authInitP = (async () => {
    await loadScript(APP_SDK);
    await loadScript(AUTH_SDK);
    const fb = (window as unknown as { firebase?: FirebaseCompat }).firebase;
    if (!fb) throw new Error('sdk-load-failed');
    if (fb.apps.length === 0) fb.initializeApp(FIREBASE_CONFIG);
    const auth = fb.auth();
    try {
      await auth.setPersistence(fb.auth.Auth.Persistence.LOCAL);
    } catch {
      // persistence failure is non-fatal (private mode etc.)
    }
    return auth;
  })();
  return authInitP;
}

// Friendly localized messages for Firebase auth errors.
// Mirrors js/auth.js authErrorMessage() exactly:
// wrong-password/user-not-found -> "incorrect credentials"; network/timeout ->
// "connection problem". Never blame credentials for a network fault.
function authErrorMessage(e: unknown, fallback: string): string {
  const code = (e as { code?: string } | null)?.code || '';
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
      return STR.loginError;
    case 'auth/invalid-email':
      return STR.resetEmailInvalid;
    case 'auth/network-request-failed':
    case 'auth/timeout':
    case 'sdk-load-failed':
      return STR.authConnectionProblem;
    case 'auth/email-already-in-use':
      return STR.authEmailInUse;
    case 'auth/weak-password':
      return STR.authWeakPassword;
    case 'auth/too-many-requests':
      return STR.authTooManyRequests;
    case 'auth/user-disabled':
      return STR.authUserDisabled;
    default:
      return fallback;
  }
}

type Mode = 'login' | 'signup' | 'reset';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    // If already signed in, go home.
    let cancelled = false;
    getAuth()
      .then((auth) => {
        if (cancelled) return;
        unsubRef.current = auth.onAuthStateChanged((u) => {
          if (u && mounted.current) window.location.href = '/';
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
  }, []);

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setError(null);
    setOkMsg(null);
  }, []);

  const goHome = useCallback(() => {
    window.location.href = '/';
  }, []);

  async function handleLogin(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOkMsg(null);
    setLoading(true);
    try {
      const auth = await getAuth();
      await auth.signInWithEmailAndPassword(email.trim(), password);
      if (mounted.current) goHome();
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, STR.loginError));
        setLoading(false);
      }
    }
  }

  async function handleSignup(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOkMsg(null);
    const displayName = name.trim();
    if (!displayName) {
      setError('أدخل الاسم');
      return;
    }
    if (password.length < 8) {
      setError(STR.authWeakPassword);
      return;
    }
    setLoading(true);
    try {
      const auth = await getAuth();
      const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);
      try {
        await cred.user.updateProfile({ displayName });
      } catch {
        // non-fatal
      }
      try {
        await cred.user.sendEmailVerification();
      } catch {
        // non-fatal — user can resend later
      }
      if (mounted.current) goHome();
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, STR.errorGeneric));
        setLoading(false);
      }
    }
  }

  async function handleReset(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOkMsg(null);
    const em = email.trim();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError(STR.resetEmailInvalid);
      return;
    }
    setLoading(true);
    try {
      const auth = await getAuth();
      await auth.sendPasswordResetEmail(em);
      if (mounted.current) {
        setOkMsg(STR.resetLinkSent);
        setLoading(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, STR.errorGeneric));
        setLoading(false);
      }
    }
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 text-base';
  const btnCls =
    'w-full rounded-lg bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-60 disabled:cursor-wait transition-colors';

  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <header className="bg-emerald-700 text-white shadow">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">
            دلالة
          </Link>
          <span className="text-sm">سوق الجزائر للإعلانات المبوبة</span>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-10">
        <div className="rounded-2xl bg-white shadow-sm p-6">
          {mode === 'login' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">تسجيل الدخول</h1>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <form onSubmit={handleLogin} noValidate>
                <label htmlFor="lEmail" className="block text-sm font-medium text-zinc-700 mb-1">
                  البريد الإلكتروني
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
                  كلمة المرور
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
                  {loading ? STR.pleaseWait : 'دخول'}
                </button>
              </form>
              <p className="mt-4 text-sm text-center">
                <button
                  type="button"
                  onClick={() => switchMode('reset')}
                  className="text-emerald-700 hover:underline"
                >
                  نسيت كلمة المرور؟
                </button>
              </p>
              <p className="mt-2 text-sm text-center text-zinc-600">
                ما عندكش حساب؟{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="text-emerald-700 font-medium hover:underline"
                >
                  أنشئ واحداً
                </button>
              </p>
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">حساب جديد</h1>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <form onSubmit={handleSignup} noValidate>
                <label htmlFor="sName" className="block text-sm font-medium text-zinc-700 mb-1">
                  الاسم (باللاتينية)
                </label>
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
                <label htmlFor="sEmail" className="block text-sm font-medium text-zinc-700 mb-1">
                  البريد الإلكتروني
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
                  كلمة المرور (8 أحرف على الأقل)
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
                <button type="submit" className={btnCls} disabled={loading}>
                  {loading ? STR.pleaseWait : 'إنشاء الحساب'}
                </button>
              </form>
              <p className="mt-4 text-sm text-center text-zinc-600">
                عندك حساب؟{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-emerald-700 font-medium hover:underline"
                >
                  سجّل الدخول
                </button>
              </p>
            </div>
          )}

          {mode === 'reset' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">نسيت كلمة المرور؟</h1>
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
                  البريد الإلكتروني
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
                  {loading ? STR.pleaseWait : 'إرسال رابط الاستعادة'}
                </button>
              </form>
              <p className="mt-4 text-sm text-center">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-emerald-700 font-medium hover:underline"
                >
                  العودة لتسجيل الدخول
                </button>
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
