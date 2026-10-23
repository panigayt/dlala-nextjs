// Trilingual strings for the account pages (Group B).
//
// Verbatim from js/i18n.{ar,fr,en}.js (production 0.0.0.43).
// Language stored in localStorage 'dlala_lang' (default 'ar'),
// mirroring js/i18n.js exactly.

'use client';

import { createContext, useCallback, useContext, useEffect, useReducer, useSyncExternalStore, type ReactNode } from 'react';

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
// Bug fix (21 Oct 2026, Zak report): explicit user switch vs URL-forced
// language. On /fr and /en routes the whole subtree (header included, via
// ChromeWithLang) sits inside <ForcedLang>, and useLang() returned
// `forced ?? store` — so tapping AR/FR/EN updated the store, the cookie and
// <html lang/dir> but changed NOTHING visible: the buttons looked dead.
// langOverride records an explicit switch (header, settings, chat, or a
// cross-tab storage event): once set, it wins over the URL-forced language
// for the rest of the session. It is module state only — a fresh page load
// resets it to null, so /fr and /en still land in their URL language and
// SSR stays language-invariant (R54 untouched).
let langOverride: Lang | null = null;
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
    // Round 205 (audit R1, A1): first-visit /fr + /en — no cookie or
    // localStorage yet, so the URL path is the only language signal. Sniff
    // the /fr or /en prefix before falling back to 'ar', mirroring the
    // pre-paint script in layout.tsx (which already sniffs the path).
    try {
      const p = window.location.pathname;
      if (p === '/fr' || p.startsWith('/fr/')) return 'fr';
      if (p === '/en' || p.startsWith('/en/')) return 'en';
    } catch {
      // ignore — corrupted location keeps the default
    }
  } catch {
    // ignore — corrupted storage keeps the default
  }
  return 'ar';
}

// Round 133: mirror the language into a cookie so server-side
// generateMetadata can localize <title> (localStorage is client-only).
function writeLangCookie(l: Lang): void {
  try {
    // R24-6 (24 Oct 2026): + Secure — the site is HTTPS-only behind HSTS
    // preload, so the language cookie never needs a plaintext hop.
    document.cookie = 'dlala_lang=' + l + '; path=/; max-age=31536000; SameSite=Lax; Secure';
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

/** Current app-wide language (initializes from localStorage on first call).
 *  Returns the EFFECTIVE store language — an explicit-switch override, when
 *  present, is the user's current language. This is also the
 *  useSyncExternalStore snapshot in useLang(): it must change whenever the
 *  override changes, even when appLang itself does not (e.g. store already
 *  'ar' on a /fr page, user taps AR) — otherwise React sees an identical
 *  snapshot, skips the re-render, and the switch looks dead again. */
export function getAppLang(): Lang {
  ensureLangInit();
  return langOverride ?? (appLang as Lang);
}

/** Switch the app-wide language: persists to localStorage, updates
 *  <html lang/dir>, and notifies every mounted useLang() consumer
 *  (legacy js/i18n.js onLangChange() re-render parity). */
export function setAppLang(l: Lang): void {
  ensureLangInit();
  // No early return when only the override changes: on a /fr page with the
  // store already at 'ar', tapping AR must still lift the forced French.
  if (appLang === l && langOverride === l) return;
  appLang = l;
  langOverride = l;
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

/** R23-4 fix (24 Oct 2026): prefix→locale sync for localized APP routes
 *  (/fr/publish, /en/publish). Every other /fr|/en surface self-corrects
 *  from its URL prefix because its visible content is entirely
 *  ForcedLang-driven (home, guides, landings). The publish routes were
 *  the exception: their gate detours through the UNPREFIXED /auth page,
 *  whose language comes from this store — and the store is cookie-first,
 *  so any visitor carrying a dlala_lang cookie for another language
 *  (the audit's crawl state; any returning user opening a shared
 *  localized link) got an Arabic login wall under a French/English
 *  title, with <html lang/dir> flipped to ar/rtl by applyDocLang.
 *  Syncing the store to the URL language on mount makes the whole
 *  journey — publish page, auth detour, post-login return — end in the
 *  URL's language + dir, in both the cookie and cookie-less branches.
 *  An explicit in-session switch (langOverride) still wins: this sync
 *  only repairs a store that was never deliberately set this session. */
export function syncAppLangToUrl(l: Lang): void {
  ensureLangInit();
  if (langOverride !== null) return;
  if (appLang !== l) setAppLang(l);
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
// 21 Oct 2026: the forced language is the page's INITIAL language only —
// an explicit switch via setAppLang sets langOverride, which outranks it
// (see useLang) so the switcher works on prefixed pages too.
// ---------------------------------------------------------------------------
const ForcedLangContext = createContext<Lang | null>(null);

export function ForcedLang({
  value,
  children,
}: {
  // Fix Round 3 (22 Oct 2026): Lang | null — ChromeWithLang now renders
  // the provider unconditionally (see ChromeWithLang.tsx); a null value
  // is semantically identical to no provider (the context default).
  value: Lang | null;
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
  // 21 Oct 2026 (switcher fix, part 3): guarantee a re-render on EVERY
  // explicit switch. useSyncExternalStore re-renders only when its
  // snapshot changes — but on a forced page the snapshot can already
  // equal the tapped language (store 'ar' on /fr, user taps AR):
  // snapshot 'ar' -> 'ar', React bails out, and the page stays in the
  // forced language even though langOverride was set. This plain
  // subscription bumps a local counter on every store notification, so
  // the render below always re-reads the current langOverride.
  const [, bumpLang] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeLang(bumpLang), []);
  // Precedence: an explicit user switch (this session) wins over the
  // URL-forced language, which wins over the cookie store. Before the
  // 21 Oct 2026 fix the forced language won unconditionally, which made
  // the switcher a no-op on every /fr and /en page.
  const lang = langOverride ?? forced ?? storeLang;
  const setLang = useCallback((l: Lang) => setAppLang(l), []);
  const tr = useCallback((k: string) => t(k, lang), [lang]);
  return { lang, setLang, t: tr };
}
