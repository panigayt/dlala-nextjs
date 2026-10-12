// Dlala auth security checks — verbatim parity with js/auth.js (15 Sep 2026).
//
// 1. Disposable/temporary email domains are blocked at signup.
// 2. Plus-addressing (user+1@gmail.com) is blocked to prevent mass account
//    creation with aliases.
//    AUT-3 (16 Sep 2026): a plus-address is NOT a "disposable" email — it gets
//    its own dedicated message and must not say "disposable".

// Exact list from js/auth.js (15 Sep 2026) — keep in sync.
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  'tempmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'yopmail.com',
  'temp-mail.org',
  'throwaway.email',
  'getnada.com',
  'sharklasers.com',
  'trashmail.com',
  'dispostable.com',
];

/**
 * True when the address uses a known disposable/temporary email domain.
 * Verbatim js/auth.js: domain lowercased for the comparison; exact-match only
 * (subdomains like sub.mailinator.com do NOT match — legacy parity).
 */
export function isDisposableEmail(email: string): boolean {
  // 11 Oct 2026: strip trailing dot + match subdomains (was exact-only bypass).
  const domain = (email.split('@')[1]?.toLowerCase() || '').replace(/\.$/, '');
  return DISPOSABLE_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
}

/**
 * True when the address uses plus-addressing anywhere in the string.
 * Verbatim js/auth.js: `email.includes('+')` — the whole address is checked.
 */
export function hasPlusAddress(email: string): boolean {
  return email.includes('+');
}

/**
 * Which signup-block applies, if any. Legacy checks the disposable domain
 * FIRST and the plus-address second (a disposable+plus address shows the
 * disposable message).
 */
export function signupEmailBlock(email: string): 'disposable' | 'plus' | null {
  if (isDisposableEmail(email)) return 'disposable';
  if (hasPlusAddress(email)) return 'plus';
  return null;
}
