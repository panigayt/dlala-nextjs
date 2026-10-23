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

/**
 * Localized heading + body for the transient load-failure views
 * (listing + announcement pages). R25-3 (24 Oct 2026): these views used
 * to render an unconditional Arabic heading/body (lang="ar" dir="rtl")
 * with the FR/EN texts stacked underneath — a French/English user hit
 * by a fetch failure got an Arabic-headed page. Now the copy follows
 * the UI language like every other string on those pages: the keys
 * live in the i18n tables, the active language renders alone (the
 * Round-9 error.tsx pattern), and lang follows it. SSR stays
 * language-invariant Arabic (useLang's server snapshot — R54), the
 * client flips to the user's language on hydration, exactly like
 * RetryLabel and LocaleDir.
 */
export function LoadErrorText({
  titleKey,
  bodyKey,
  titleClassName,
  bodyClassName,
}: {
  titleKey: string;
  bodyKey: string;
  titleClassName?: string;
  bodyClassName?: string;
}) {
  const { lang, t } = useLang();
  return (
    <>
      <h1 className={titleClassName} lang={lang}>
        {t(titleKey)}
      </h1>
      <p className={bodyClassName} lang={lang}>
        {t(bodyKey)}
      </p>
    </>
  );
}
