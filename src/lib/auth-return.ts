// Auth return-flow helpers — js/app.js safeReturnUrl + js/auth.js authReturnTarget
// parity, ported to Next.js routes (16 Sep 2026 legacy semantics):
//
// - safeReturnUrl: internal paths only (open-redirect guard — legacy allowed
//   same-directory .html files only; here only /-prefixed internal paths).
// - authReturnTarget: sanitized ?return=, L2 fix (16 Sep 2026) — /auth itself
//   is never a valid return target (wasted reload hop); default /account
//   (legacy defaulted to account.html).
// - authLoginHref: guest-nudge target carrying the current page as ?return=
//   (legacy guestNudgeThenLogin / requireAuth parity).

/**
 * Internal-path-only allow-list for ?return= targets.
 * Rejects absolute URLs, protocol-relative //, backslashes and any charset
 * outside the safe path/query set. Returns the value unchanged when valid.
 */
export function safeReturnUrl(v: string | null | undefined): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (!/^\/(?!\/)[A-Za-z0-9_\-./~?#=&+%]*$/.test(v)) return null;
  if (v.includes('\\')) return null;
  return v;
}

/**
 * Sanitized sign-in continuation target for the /auth page.
 * Reads the raw (decoded) ?return= value — callers pass
 * new URLSearchParams(window.location.search).get('return').
 */
export function authReturnTarget(raw: string | null | undefined): string {
  try {
    const t = safeReturnUrl(raw);
    // L2 fix (js/auth.js): /auth itself is not a valid return target.
    if (t && !/^\/auth([?#]|$)/.test(t)) return t;
    return '/account';
  } catch {
    return '/account';
  }
}

/**
 * /auth href carrying the current page as ?return= — guest-nudge landing
 * (legacy guestNudgeThenLogin + requireAuth parity). Safe to call from any
 * 'use client' component via window.location at event time.
 */
export function authLoginHref(pathname: string, search: string): string {
  const here = pathname + (search ? (search.startsWith('?') ? search : '?' + search) : '');
  return '/auth?return=' + encodeURIComponent(here);
}
