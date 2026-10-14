// Auth login/signup links — isolated useSearchParams() usage.
// SiteChrome (client component) cannot call useSearchParams() at its top level:
// it breaks static generation for pages like /guides/[slug] (the whole page
// falls back to client-side rendering, killing SEO). This component isolates
// the hook so SiteChrome can wrap it in <Suspense>.
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Lang } from '@/lib/i18n';

type T = (key: string) => string;

export default function AuthLinks({
  isAuthPage,
  pathname,
  t,
  onNavigate,
}: {
  isAuthPage: boolean;
  pathname: string;
  t: T;
  onNavigate?: () => void;
}) {
  const searchParams = useSearchParams();

  // NAV-4: login vs signup active state follows ?mode=signup. The login link
  // carries ?return= so the user lands back where they came from (AUT-4).
  const signupMode = searchParams.get('mode') === 'signup';
  const returnParam = !isAuthPage
    ? '?return=' + encodeURIComponent(pathname + (searchParams.toString() ? '?' + searchParams.toString() : ''))
    : '';

  // Header and drawer use logically equivalent active-state logic
  // (header: !isAuthPage || signupMode → '', drawer: isAuthPage && !signupMode → 'active').
  const loginActive = isAuthPage && !signupMode;
  const signupActive = isAuthPage && signupMode;

  return (
    <>
      <Link
        href={'/auth' + returnParam}
        className={loginActive ? 'active' : ''}
        aria-current={loginActive ? 'page' : undefined}
        onClick={onNavigate}
      >
        {t('login')}
      </Link>
      <Link
        href="/auth?mode=signup"
        className={signupActive ? 'active' : ''}
        aria-current={signupActive ? 'page' : undefined}
        onClick={onNavigate}
      >
        {t('signup')}
      </Link>
    </>
  );
}

// Static fallback for Suspense — renders during SSR/prerender without
// search params. Hydrates to the full version on the client.
export function AuthLinksFallback({ t }: { t: T }) {
  return (
    <>
      <Link href="/auth">{t('login')}</Link>
      <Link href="/auth?mode=signup">{t('signup')}</Link>
    </>
  );
}
