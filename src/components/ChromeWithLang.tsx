// ChromeWithLang: wraps SiteChrome in ForcedLang based on URL path prefix.
//
// K-C1 (audit round 2, 18 Oct 2026): SiteChrome is rendered by the root
// layout OUTSIDE any <ForcedLang> provider, so on /fr and /en pages the
// header/footer SSR'd in Arabic (useLang()'s server snapshot is 'ar').
// The per-page <ForcedLang> only covered the page body, not the chrome.
//
// Fix: this client wrapper reads the pathname, derives the forced language
// from the /fr or /en prefix (same rule as the pre-paint script in
// layout.tsx and readStoredLang() in lib/i18n.tsx), and wraps SiteChrome
// in <ForcedLang> when a prefix is present. The ForcedLang context is a
// plain React context — its value IS available during SSR, so the chrome
// now server-renders in the correct language. Non-prefixed paths render
// exactly as before (no provider, cookie store drives the language).
'use client';

import { usePathname } from 'next/navigation';
import { ForcedLang, type Lang } from '@/lib/i18n';
import SiteChrome from './SiteChrome';

function forcedLangForPath(pathname: string | null): Lang | null {
  if (!pathname) return null;
  if (pathname === '/fr' || pathname.startsWith('/fr/')) return 'fr';
  if (pathname === '/en' || pathname.startsWith('/en/')) return 'en';
  return null;
}

export default function ChromeWithLang({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const forced = forcedLangForPath(pathname);
  const chrome = <SiteChrome>{children}</SiteChrome>;
  if (forced) {
    return <ForcedLang value={forced}>{chrome}</ForcedLang>;
  }
  return chrome;
}
