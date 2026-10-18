// Trilingual 404 — Next.js App Router not-found boundary.
//
// Faithful port of ~/workspace/dlala-040/404.html:
//   - Pure static content: renders the message + home buttons with no JS.
//   - Exact legacy copy (AR/FR/EN), emerald #0b6b4f theme, "D" mark.
//
// R15b BC-1 (18 Oct 2026): locale-aware. /fr/* and /en/* URLs render the
// French/English variant (lang, dir, title) instead of always Arabic.
// The locale is read from the request pathname via headers().
//
// KEEP IN SYNC with src/proxy-404.ts TRILINGUAL_404_HTML: the Edge proxy
// (Round 14, Zak's "نفذ 404 حقيقي") returns that static HTML with a REAL
// HTTP 404 status for missing listing/seller/announcement docs — before
// this boundary can even render. If the copy/layout here changes, update
// the proxy HTML too, and vice versa.

import Link from 'next/link';
import type { Metadata } from 'next';
import { headers } from 'next/headers';

type Locale = 'ar' | 'fr' | 'en';

async function getLocale(): Promise<Locale> {
  try {
    const h = await headers();
    // Next.js provides the pathname via x-pathname (proxy) or we fall back
    // to the referer-less default. The proxy sets x-pathname for 404s it
    // doesn't handle itself (e.g. /fr/listing/*).
    const pathname =
      h.get('x-pathname') || h.get('x-invoke-path') || '';
    if (pathname.startsWith('/fr/') || pathname === '/fr') return 'fr';
    if (pathname.startsWith('/en/') || pathname === '/en') return 'en';
  } catch {
    // headers() unavailable — default to Arabic
  }
  return 'ar';
}

// SEO: this boundary renders on a REAL HTTP 404. Next.js unconditionally
// injects <meta name="robots" content="noindex"/> for it. Locale-aware
// title/description; restrictive robots always.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title =
    locale === 'fr'
      ? 'Page non trouvée | Dlala'
      : locale === 'en'
        ? 'Page not found | Dlala'
        : 'صفحة غير موجودة | دلالة';
  return {
    title,
    description:
      "عذراً، هذه الصفحة غير موجودة. / Désolé, cette page n'existe pas. / Sorry, this page does not exist.",
    robots: { index: false, follow: false },
    openGraph: { title, description: 'عذراً، هذه الصفحة غير موجودة.' },
  };
}

export default async function NotFound() {
  const locale = await getLocale();
  const htmlLang = locale;
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  // Highlight the matching language's message and button first.
  const order: Locale[] = locale === 'ar' ? ['ar', 'fr', 'en'] : locale === 'fr' ? ['fr', 'ar', 'en'] : ['en', 'ar', 'fr'];

  const messages: Record<Locale, { text: string; cta: string }> = {
    ar: { text: 'عذراً، هذه الصفحة غير موجودة.', cta: 'العودة إلى الرئيسية' },
    fr: { text: "Désolé, cette page n'existe pas.", cta: "Retour à l'accueil" },
    en: { text: 'Sorry, this page does not exist.', cta: 'Back to home' },
  };

  return (
    <div className="min-h-screen bg-white" lang={htmlLang} dir={dir}>
      <main id="main-content" className="mx-auto max-w-xl px-5 py-[10vh] text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-[18px] flex h-[84px] w-[84px] items-center justify-center rounded-[22px] bg-[#0b6b4f] text-[52px] font-extrabold text-white"
        >
          D
        </div>
        <h1 className="mb-4 text-[64px] font-bold text-[#0b6b4f]">404</h1>
        {order.map((l) => (
          <p
            key={l}
            lang={l}
            dir={l === 'ar' ? 'rtl' : 'ltr'}
            className="mb-2.5 text-lg text-zinc-700"
          >
            {messages[l].text}
          </p>
        ))}
        <nav
          className="mt-[26px] flex flex-col gap-2.5"
          aria-label="التنقل الرئيسي / Navigation principale / Main navigation"
        >
          {order.map((l, i) => (
            <Link
              key={l}
              href={l === 'ar' ? '/' : `/${l}/`}
              lang={l}
              dir={l === 'ar' ? 'rtl' : 'ltr'}
              className={
                i === 0
                  ? 'block rounded-xl bg-[#0b6b4f] px-8 py-3 text-[17px] text-white'
                  : 'block rounded-xl border-2 border-[#0b6b4f] bg-white px-8 py-3 text-[17px] text-[#0b6b4f]'
              }
            >
              {messages[l].cta}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
