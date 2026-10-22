import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

// Same metadata as src/app/not-found.tsx's generateMetadata (locale is
// fixed by the route): a page that throws notFound() keeps its OWN
// metadata chain in Next, so without this the tab title fell back to
// the root default instead of the localized 404 title.
export const metadata: Metadata = {
  title: 'Page non trouvée | Dlala',
  description:
    "عذراً، هذه الصفحة غير موجودة. / Désolé, cette page n'existe pas. / Sorry, this page does not exist.",
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Page non trouvée | Dlala',
    description: 'عذراً، هذه الصفحة غير موجودة.',
  },
};


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
