// Scroll-position restore across the auth bounce (js/app.js parity).
//
// QA 16 Sep 2026 (#4): an auth bounce loses the feed scroll position.
// Legacy `guestNudgeThenLogin` calls `saveScrollForReturn()` before sending
// the guest to auth.html?return=..., and `restoreFeedScroll()` (armed on every
// page's DOMContentLoaded, 1200ms deferred so the feed can paint, one-shot)
// puts the user back where they were after login.
//
// The Next.js equivalents:
// - every guest-nudge → /auth?return=... call site calls saveScrollForReturn()
//   before the redirect (matching legacy's save-before-toast-delay);
// - ScrollRestoreArmer (root layout) arms restoreFeedScroll() on every
//   pathname change (the SPA equivalent of "every page load").
export const SCROLL_RESTORE_KEY = 'dlala_scroll_restore';

/** 15 minutes — legacy ignores a restore older than this. */
const STALE_MS = 15 * 60 * 1000;
/** 1200ms — legacy defers the restore so the feed paints before the jump. */
const ARM_DELAY_MS = 1200;

interface ScrollStash {
  path: string;
  y: number;
  ts: number;
}

/**
 * Save the current scroll position for the return trip through /auth.
 * Never throws (storage may be unavailable — the restore is then skipped,
 * like legacy).
 */
export function saveScrollForReturn(pathname: string): void {
  try {
    const stash: ScrollStash = {
      path: pathname,
      y: typeof window !== 'undefined' ? window.scrollY || 0 : 0,
      ts: Date.now(),
    };
    sessionStorage.setItem(SCROLL_RESTORE_KEY, JSON.stringify(stash));
  } catch {
    /* ignore */
  }
}

/**
 * One-shot restore: consume the stash, and if it belongs to the current
 * page and is fresh, jump back to the saved scroll position. Legacy verbatim
 * semantics (js/app.js restoreFeedScroll).
 */
export function restoreFeedScroll(): void {
  try {
    const raw = sessionStorage.getItem(SCROLL_RESTORE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(SCROLL_RESTORE_KEY);
    const s = JSON.parse(raw) as Partial<ScrollStash> | null;
    if (!s || typeof location === 'undefined') return;
    if (location.pathname !== s.path) return;
    if (Date.now() - (s.ts || 0) > STALE_MS) return; // stale — ignore
    const y = Number(s.y) || 0;
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  } catch {
    /* ignore */
  }
}

/**
 * Arm the one-shot restore, deferred so the feed paints before the jump.
 * Called on every page load / pathname change, like legacy's armScroll.
 */
export function armScrollRestore(): void {
  try {
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(SCROLL_RESTORE_KEY);
    } catch {
      /* ignore */
    }
    if (pending) setTimeout(() => restoreFeedScroll(), ARM_DELAY_MS);
  } catch {
    /* ignore */
  }
}
