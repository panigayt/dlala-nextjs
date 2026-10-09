// AuthGate — wrapper for auth-required pages.
//
// Mirrors js/app.js bootAuthGated() + requireAuth(): waits for the Firebase
// auth session to restore, then redirects to /auth when signed out.
// Shows a loading spinner while the session resolves (12s timeout with
// retry UI, mirroring the 18 Sep 2026 Zak-approved pattern).

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getFirebase, withTimeout, type CompatUser } from '@/lib/firebase-compat';
import { useLang } from '@/lib/i18n';

interface AuthGateProps {
  children: (user: CompatUser) => ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const { lang, t } = useLang();
  const [user, setUser] = useState<CompatUser | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const mounted = useRef(true);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    (async () => {
      try {
        const fb = await withTimeout(getFirebase(), 12000);
        if (cancelled || !mounted.current) return;
        unsubRef.current = fb.auth().onAuthStateChanged((u) => {
          if (!mounted.current) return;
          if (u) {
            setUser(u);
          } else {
            // Not signed in — bounce to /auth (requireAuth behavior).
            window.location.href = '/auth';
          }
        });
        // Safety: if onAuthStateChanged never fires within 12s, show retry.
        setTimeout(() => {
          if (mounted.current && !cancelled && !unsubRef.current) {
            setTimedOut(true);
          }
        }, 12000);
      } catch {
        if (mounted.current && !cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, []);

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  if (loadError || timedOut) {
    return (
      <div className="min-h-screen bg-zinc-50" dir={dir}>
        <PageHeader title="" />
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
        <PageHeader title="" />
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
