// AuthGate — wrapper for auth-required pages.
//
// Mirrors js/app.js bootAuthGated() + requireAuth(): waits for the Firebase
// auth session to restore, then redirects to /auth when signed out.
// Shows a loading spinner while the session resolves (12s timeout with
// retry UI, mirroring the 18 Sep 2026 Zak-approved pattern).

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { type CompatUser } from '@/lib/firebase';
import { useLang } from '@/lib/i18n';
import { authLoginHref } from '@/lib/auth-return';
import { saveScrollForReturn } from '@/lib/scroll-restore';

interface AuthGateProps {
  children: (user: CompatUser) => ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const router = useRouter();
  const { lang, t } = useLang();
  const [user, setUser] = useState<CompatUser | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const mounted = useRef(true);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let authResolved = false;
    // Round 14 T6b: the 12s safety timer lives in effect scope so the
    // cleanup can disarm it; it is disarmed on auth-resolve too (it was
    // assigned-but-never-read before).
    let authTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      let loadTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        // Lazy-load the Firebase modular SDK (gstatic CDN path, 0 bundle
        // bytes) — keeps it off the initial page chunk. Round 16 T2: this
        // is the same single Auth instance the drawer (SiteChrome) and the
        // /auth page use — auth state is observed and mutated in exactly
        // one place.
        const { getFirebaseCdn } = await import('@/lib/firebase');
        // BUG #3 (T4/20, 12 Oct 2026): the old code raced the Firebase chunk
        // load against a 12s deadline and ABANDONED the promise on timeout, so
        // a slow/flaky network left the guest stuck on the error screen
        // forever — onAuthStateChanged was never subscribed. We never abandon
        // the load: the 12s timer below only switches to the retry UI while
        // the chunks keep loading in the background. The auth subscription is
        // established exactly once, no matter how long the chunks take, and
        // when auth state resolves it clears any timeout/load-error UI.
        const clientP = getFirebaseCdn();
        // 12s UI deadline — shows «مشكلة في الاتصال» + retry while we keep
        // waiting for the chunks (manual retry = reload, same as before).
        loadTimer = setTimeout(() => {
          if (mounted.current && !cancelled) setLoadError(true);
        }, 12000);
        const client = await clientP;
        if (loadTimer) clearTimeout(loadTimer);
        if (cancelled || !mounted.current) return;
        unsubRef.current = client.authMod.onAuthStateChanged(client.auth, (u) => {
          if (!mounted.current || cancelled) return;
          authResolved = true;
          // Auth resolved — the 12s safety timer only exists for the
          // never-fires case, so disarm it.
          if (authTimer) {
            clearTimeout(authTimer);
            authTimer = null;
          }
          // Late arrival after the 12s retry UI was already shown: clear it —
          // the page recovers (bounce to /auth or render) instead of staying
          // stuck on «مشكلة في الاتصال».
          setLoadError(false);
          setTimedOut(false);
          if (u) {
            setUser(u);
          } else {
            // Not signed in — bounce to /auth (requireAuth behavior).
            // QA 16 Sep 2026 #4 (js/app.js saveScrollForReturn parity): keep the
            // scroll position across the /auth round-trip.
            saveScrollForReturn(window.location.pathname);
            router.push(authLoginHref(window.location.pathname, window.location.search));
          }
        });
        // Safety: if onAuthStateChanged never fires within 12s of subscribing,
        // show the retry UI. The callback above clears it on late arrival.
        authTimer = setTimeout(() => {
          if (mounted.current && !cancelled && !authResolved) {
            setTimedOut(true);
          }
        }, 12000);
      } catch {
        if (loadTimer) clearTimeout(loadTimer);
        // Genuine load failure (chunks errored, not merely slow) — retry UI,
        // same as before. getFirebaseCdn() resets its cached promise on
        // failure, so manual retry reloads the chunks fresh.
        if (mounted.current && !cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
      // Disarm the safety timer on unmount (its callback is already guarded
      // by `cancelled`; this just avoids a stray wake-up).
      if (authTimer) {
        clearTimeout(authTimer);
        authTimer = null;
      }
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [router]);

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  if (loadError || timedOut) {
    return (
      <div className="min-h-screen bg-zinc-50" dir={dir}>
        <PageHeader title="DLALA" />
        <main className="max-w-2xl mx-auto px-4 py-10 text-center">
          <p className="text-zinc-600 mb-4">{t('authConnectionProblem')}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-emerald-700 px-6 py-2.5 font-bold text-white hover:bg-emerald-800"
          >
            {t('retry')}
          </button>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50" dir={dir}>
        <PageHeader title="DLALA" />
        <main className="max-w-2xl mx-auto px-4 py-10 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-700" />
          <p className="mt-3 text-zinc-600">{t('loading')}</p>
        </main>
      </div>
    );
  }

  return <>{children(user)}</>;
}

// Shared page header — emerald, RTL, mirrors the legacy site header.
export function PageHeader({ title, backHref = '/' }: { title: string; backHref?: string }) {
  const { t } = useLang();
  return (
    <header className="bg-emerald-700 text-white shadow">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <a href={backHref} className="text-xl font-bold">
          {t('appName')}
        </a>
        {title ? <span className="text-sm font-medium">{title}</span> : null}
      </div>
    </header>
  );
}
