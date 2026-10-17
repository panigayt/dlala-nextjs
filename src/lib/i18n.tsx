// Trilingual strings for the account pages (Group B).
//
// Verbatim from js/i18n.{ar,fr,en}.js (production 0.0.0.43).
// Language stored in localStorage 'dlala_lang' (default 'ar'),
// mirroring js/i18n.js exactly.

'use client';

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';

import { t, type Lang } from './i18n-strings';

export type { Lang };

// Legacy helpers (kept for compatibility).
export function getLang(): Lang {
  if (typeof window === 'undefined') return 'ar';
  try {
    const l = localStorage.getItem('dlala_lang');
    if (l === 'fr' || l === 'en' || l === 'ar') return l;
  } catch {
    // ignore
  }
  return 'ar';
}

export function setLangStorage(lang: Lang) {
  try {
    localStorage.setItem('dlala_lang', lang);
  } catch {
    // ignore
  }
  writeLangCookie(lang);
}
// ---------------------------------------------------------------------------
// App-wide language store — ONE language for the whole app.
//
// Bug fixed (Round 106): useLang() used to keep per-component useState, so
// the header's language switcher only re-rendered the header — page content
// (conversations, settings, account, favorites, my-listings, my-follows,
// feed strips, banners…) stayed stuck in its mount language, and pages with
// FR/EN strings but no switcher of their own could never switch at all.
// Legacy js/i18n.js setLang() re-renders the whole page via onLangChange();
// this module-level store + useSyncExternalStore is the React equivalent:
// every mounted useLang() consumer re-renders on every switch, with zero
// call-site changes (all 16 consumers share the API below unchanged).
// ---------------------------------------------------------------------------

let appLang: Lang | null = null; // null = not initialized yet (SSR-safe)
const langListeners = new Set<() => void>();

function readStoredLang(): Lang {
  if (typeof window === 'undefined') return 'ar';
  try {
    // 14 Oct 2026 (Zak ordered «اصلح»): cookie FIRST — matches the pre-paint
    // script (cookie-first) and the server (which only sees the cookie).
    // Previously localStorage-first here could flip the language AFTER
    // hydration when the two disagreed (pre-paint had already applied the
    // cookie language). The switcher writes both atomically, so this only
    // matters in artificially constructed conflict states — now they agree.
    const m = document.cookie.match(/(?:^|;\s*)dlala_lang=(ar|fr|en)(?:;|$)/);
    if (m) return m[1] as Lang;
    const l = window.localStorage.getItem('dlala_lang');
    if (l === 'fr' || l === 'en' || l === 'ar') return l;
  } catch {
    // ignore — corrupted storage keeps the default
  }
  return 'ar';
}

// Round 133: mirror the language into a cookie so server-side
// generateMetadata can localize <title> (localStorage is client-only).
function writeLangCookie(l: Lang): void {
  try {
    document.cookie = 'dlala_lang=' + l + '; path=/; max-age=31536000; SameSite=Lax';
  } catch {
    // ignore — persistence is best-effort
  }
}

// Round 133: legacy js/app.js updatePageTitle() parity — the tab title
// follows the language immediately on switch (no reload needed).
// Maps the current pathname to a PAGE_TITLES key; dynamic pages
// (listing/seller/announcement detail, guides, model pages) keep their
// server-rendered content title and return null.
export function titleKeyForPath(pathname: string): string | null {
  const p = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (p === '/') return 'title_home';
  const seg = p.split('/')[1] || '';
  switch (seg) {
    case 'publish': return 'title_publish';
    case 'favorites': return 'title_favorites';
    case 'my-follows': return 'title_myFollows';
    case 'conversations': return 'title_conversations';
    case 'chat': return 'title_chat';
    case 'account': return 'title_account';
    case 'my-listings': return 'title_myListings';
    case 'settings': return 'title_settings';
    case 'auth': return 'title_auth';
    case 'auth-action': return 'title_authAction';
    case 'alerts': return 'title_alerts';
    case 'privacy': return 'title_privacy';
    case 'terms': return 'title_terms';
    case 'vitrine': return 'title_vitrine';
    case 'wanted': return 'title_wanted';
    case 'announcements': return 'title_announcements';
    case 'store-verify': return 'title_storeVerify';
    case 'my-store': return 'title_myStore';
    case 'search': return 'title_search'; // Round 11 (12 Oct 2026): was title_home — client updateDocTitle overwrote the tab with the home title on hydration
    default: return null;
  }
}

function updateDocTitle(l: Lang): void {
  try {
    const key = titleKeyForPath(window.location.pathname);
    if (key) document.title = t(key, l);
  } catch {
    // a title must never break the page
  }
}

function applyDocLang(l: Lang): void {
  try {
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  } catch {
    // a lang/dir attribute must never break rendering
  }
}

function ensureLangInit(): void {
  if (appLang !== null) return;
  appLang = readStoredLang();
  if (typeof window !== 'undefined') {
    writeLangCookie(appLang);
    try {
      // Cross-tab sync: another tab switched language.
      window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key !== 'dlala_lang') return;
        const v = e.newValue;
        if (v === 'ar' || v === 'fr' || v === 'en') setAppLang(v);
      });
    } catch {
      // ignore
    }
  }
  if (typeof document !== 'undefined') {
    applyDocLang(appLang);
    updateDocTitle(appLang);
  }
}

/** Current app-wide language (initializes from localStorage on first call). */
export function getAppLang(): Lang {
  ensureLangInit();
  return appLang as Lang;
}

/** Switch the app-wide language: persists to localStorage, updates
 *  <html lang/dir>, and notifies every mounted useLang() consumer
 *  (legacy js/i18n.js onLangChange() re-render parity). */
export function setAppLang(l: Lang): void {
  ensureLangInit();
  if (appLang === l) return;
  appLang = l;
  try {
    window.localStorage.setItem('dlala_lang', l);
  } catch {
    // ignore — persistence is best-effort
  }
  writeLangCookie(l);
  applyDocLang(l);
  updateDocTitle(l);
  langListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // a listener must never break the switch
    }
  });
}

/** Subscribe to app-wide language changes. Returns an unsubscribe function. */
export function subscribeLang(fn: () => void): () => void {
  langListeners.add(fn);
  return () => {
    langListeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// 17 Oct 2026 (SEO audit FIX #7): forced language for URL-prefixed routes.
//
// /fr/ and /en/ homepages must render French/English regardless of the
// dlala_lang cookie. The app-wide store above is cookie-driven and shared by
// every page, so these routes wrap their subtree in <ForcedLang value="fr">
// (or "en"): useLang() then returns the forced language (and localized t())
// for every consumer inside — header, search bar, feed cards — while the
// store, the cookie, and every other page behave exactly as before.
// ---------------------------------------------------------------------------
const ForcedLangContext = createContext<Lang | null>(null);

export function ForcedLang({
  value,
  children,
}: {
  value: Lang;
  children: ReactNode;
}) {
  return (
    <ForcedLangContext.Provider value={value}>
      {children}
    </ForcedLangContext.Provider>
  );
}

// React hook: app-wide language + setter (legacy js/i18n.js setLang parity).
// All mounted consumers share one state — a switch in the header (or in
// settings, or in the chat thread) re-renders every one of them.
export function useLang(): { lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string } {
  const forced = useContext(ForcedLangContext);
  const storeLang = useSyncExternalStore<Lang>(
    subscribeLang,
    () => getAppLang(),
    () => 'ar', // server snapshot — SSR always renders Arabic
  );
  // A forced URL-prefix language wins over the cookie store.
  const lang = forced ?? storeLang;
  const setLang = useCallback((l: Lang) => setAppLang(l), []);
  const tr = useCallback((k: string) => t(k, lang), [lang]);
  return { lang, setLang, t: tr };
}
