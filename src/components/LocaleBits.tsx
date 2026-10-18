// Shared client-side locale bits for server-rendered error views (R54).
//
// R54 root fix (18 Oct 2026): server components must NEVER read the
// dlala_lang cookie — the edge cache cannot vary by cookie (Vary: Cookie via
// next.config.ts + vercel.json and Cache-Control: private via the proxy were
// all verified ineffective live 18 Oct 2026), so any cookie-dependent SSR
// poisons every locale. SSR is language-invariant (Arabic); the UI language
// applies client-side via useLang() (useSyncExternalStore, server snapshot
// 'ar' — no hydration mismatch), the same Round-107 pattern the homepage,
// search and wanted shells already use.

'use client';

import type { ReactNode } from 'react';
import { useLang } from '@/lib/i18n';

/** dir wrapper that follows the UI language (client-side). */
export function LocaleDir({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { lang } = useLang();
  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className={className}>
      {children}
    </div>
  );
}

/** Localized "retry" label for transient-error views. */
export function RetryLabel() {
  const { t } = useLang();
  return <>{t('retry')}</>;
}
