// Trilingual 404 — Next.js App Router not-found boundary.
//
// Faithful port of ~/workspace/dlala-040/404.html:
//   - Pure static content: renders the message + home buttons with no JS.
//   - Exact legacy copy (AR/FR/EN), emerald #0b6b4f theme, "D" mark.
//
// KEEP IN SYNC with src/proxy-404.ts TRILINGUAL_404_HTML: the Edge proxy
// (Round 14, Zak's "نفذ 404 حقيقي") returns that static HTML with a REAL
// HTTP 404 status for missing listing/seller/announcement docs — before
// this boundary can even render. If the copy/layout here changes, update
// the proxy HTML too, and vice versa.

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-xl px-5 py-[10vh] text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-[18px] flex h-[84px] w-[84px] items-center justify-center rounded-[22px] bg-[#0b6b4f] text-[52px] font-extrabold text-white"
        >
          D
        </div>
        <h1 className="mb-4 text-[64px] font-bold text-[#0b6b4f]">404</h1>
        <p lang="ar" dir="rtl" className="mb-2.5 text-lg text-zinc-700">
          عذراً، هذه الصفحة غير موجودة.
        </p>
        <p lang="fr" dir="ltr" className="mb-2.5 text-lg text-zinc-700">
          Désolé, cette page n&rsquo;existe pas.
        </p>
        <p lang="en" dir="ltr" className="mb-2.5 text-lg text-zinc-700">
          Sorry, this page does not exist.
        </p>
        <nav className="mt-[26px] flex flex-col gap-2.5" aria-label="التنقل الرئيسي / Navigation principale / Main navigation">
          <Link
            href="/"
            lang="ar"
            dir="rtl"
            className="block rounded-xl bg-[#0b6b4f] px-8 py-3 text-[17px] text-white"
          >
            العودة إلى الرئيسية
          </Link>
          <Link
            href="/"
            lang="fr"
            dir="ltr"
            className="block rounded-xl border-2 border-[#0b6b4f] bg-white px-8 py-3 text-[17px] text-[#0b6b4f]"
          >
            Retour à l&rsquo;accueil
          </Link>
          <Link
            href="/"
            lang="en"
            dir="ltr"
            className="block rounded-xl border-2 border-[#0b6b4f] bg-white px-8 py-3 text-[17px] text-[#0b6b4f]"
          >
            Back to home
          </Link>
        </nav>
      </main>
    </div>
  );
}
