import { notFound } from 'next/navigation';

// Fix Round 3 (22 Oct 2026) — React errors #419/#418 root fix (together
// with the src/proxy.ts fall-through wrap and ChromeWithLang).
// Detail pages are single-locale BY DESIGN (R19 BC-1): /fr/seller/<uid>
// is a 404 — there is no French listing route, language applies
// client-side on /listing/<id>. Until now the URL matched NO route, so
// the root not-found boundary was rendered by resuming the generic
// pathname-less PPR shell: the resume tree mismatched the shell
// (Context vs Suspense → Minified React error #419, digest 916544469)
// and the chrome hydrated in Arabic against the French client render
// (→ error #418). This real route renders the trilingual not-found UI
// in a fresh per-segment render (correct chrome language, zero React
// errors); the proxy wraps it with the real HTTP 404 status, because
// under PPR a notFound() thrown this deep streams after the shell.
export default function FrSellerByDesign404() {
  notFound();
}
