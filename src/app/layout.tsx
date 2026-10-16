import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Suspense } from "react";
import "./globals.css";
import "./chrome.css";
import "./vitrine.css";
import "./guides.css";
import SiteChrome from "@/components/SiteChrome";
import PendingActionApplier from "@/components/PendingActionApplier";
import ScrollRestoreArmer from "@/components/ScrollRestoreArmer";
import SwRegister from "@/components/SwRegister";

// 12 Oct 2026 (Round 11 Team 1): FULLY STATIC root metadata.
// Root cause fix for Round 10 T1: the previous root generateMetadata did
// `await cookies()` to pick a language, which deferred the ENTIRE merged
// metadata chain to request time — canonical / og:url / robots were ABSENT
// from the server <head> on prerendered pages (real SEO impact).
// Static here is the correct trade-off: crawlers get the ar fallback
// (consistent with the hardcoded <html lang="ar" dir="rtl"> below), and
// real users get the pre-paint dlala_lang cookie script (also below) which
// flips lang/dir before first paint. Child routes still own their own
// language-aware generateMetadata; the root default/template applies only
// where children don't set one.
export const metadata: Metadata = {
  metadataBase: new URL("https://www.dzdlala.com"),
  title: {
    default: "دلالة — سوق الجزائر للإعلانات المبوبة",
    // Round 11 (12 Oct 2026): template is "%s" (no suffix) — every child
    // route already returns a fully branded title ("البحث — دلالة",
    // "Buying guides | DLALA", "… — DLALA"); the old "%s | دلالة" suffix
    // produced double/triple branding ("البحث — دلالة | دلالة").
    template: "%s",
  },
  description:
    "موقع دلالة: إعلانات مبوبة مجانية في الجزائر — سيارات، عقارات، هواتف، والمزيد.",
  // Round 11 (12 Oct 2026): NO root canonical — a site-wide canonical of "/"
  // would wrongly claim https://www.dzdlala.com/ as canonical for every page
  // lacking its own (seller, privacy, terms, announcements…). Those pages
  // should set their own canonicals (follow-up); home/listing/guides/search
  // already do. No canonical is neutral; a wrong one is harmful.

  openGraph: {
    type: "website",
    siteName: "دلالة",
    locale: "ar",
    url: "/",
    title: "دلالة — سوق الجزائر للإعلانات المبوبة",
    description:
      "موقع دلالة: إعلانات مبوبة مجانية في الجزائر — سيارات، عقارات، هواتف، والمزيد.",
  },
  robots: {
    index: true,
    follow: true,
  },
  // Round 45 (15 Oct 2026): build/deploy marker. Lets the audit loop (and
  // Zak) tell a stale deployment from a fresh one: fetch any page, read
  // <meta name="dlala-build">, compare against the latest main commit.
  // Vercel injects VERCEL_GIT_COMMIT_SHA at build time; local builds say
  // "local". Pure metadata — zero behavioral impact, root layout stays
  // sync + fully static (no cookies()/headers() — see the 12 Oct warning
  // above).
  other: {
    "dlala-build":
      (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
  },
};

// Round 7 Team 9 (12 Oct 2026): the viewport meta was NEVER present in the
// App Router tree (only the legacy server-rendered model pages had it) —
// mobile browsers fell back to the ~980px default layout viewport and the
// whole site rendered zoomed-out on phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* 16 Oct 2026: Google Analytics 4 (dlala-85cea property).
            strategy="afterInteractive" = non-blocking; page renders first,
            analytics loads after. Zero impact on perceived speed. */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-VTX14GJMFL"
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-VTX14GJMFL');`}
        </Script>
        {/* 12 Oct 2026: pre-paint lang/dir from the dlala_lang cookie.
            The root layout must stay a SYNC server component — awaiting
            cookies() here forces every route dynamic and breaks the
            production build ("/_not-found" + "/account" prerender errors).
            This inline script runs before first paint, so FR/EN users never
            see an Arabic-flash; no-JS/crawlers keep the ar/rtl fallback.
            (Preview CSP allows 'unsafe-inline' for scripts.)
            Round 31 Fix B: also check localStorage (cookie may miss on
            first navigation, but localStorage has the user's choice).
            Round 42: PREFER PATH LOCALE — /fr/... and /en/... URLs set
            lang/dir from location.pathname FIRST (fresh visitors have no
            cookie yet; without this, /fr/ pages shipped lang="ar"). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var l=null;try{var p=location.pathname;if(/^\\/fr(\\/|$)/.test(p))l='fr';else if(/^\\/en(\\/|$)/.test(p))l='en';}catch(e){}if(!l){var m=document.cookie.match(/(?:^|;\\s*)dlala_lang=(fr|en|ar)/);l=m?m[1]:null;}if(!l){try{var s=localStorage.getItem('dlala_lang');if(s==='fr'||s==='en'||s==='ar')l=s;}catch(e){}}if(!l)l='ar';document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr';}catch(e){}`,
          }}
        />
        {/* Round 160 — 0.0.0.39 index.html parity: preconnect to the image
            and data hosts so the first card image / Firestore fetch skips
            DNS+TCP+TLS setup (saves ~200-500ms on mobile). */}
        <link rel="preconnect" href="https://firebasestorage.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://firestore.googleapis.com" crossOrigin="anonymous" />
        {/* 14 Oct 2026 (image-speed): preconnect to the R2 image host — every
            feed card thumbnail is served from here and it was missing, so the
            first image paid full DNS+TCP+TLS (~1-3 RTTs, ~1s on slow mobile).
            Host derived from R2_PUBLIC_URL (no hardcode); skipped when unset. */}
        {(() => {
          try {
            const base = process.env.R2_PUBLIC_URL || '';
            const host = base ? new URL(base).host : '';
            return host ? (
              <link rel="preconnect" href={`https://${host}`} crossOrigin="anonymous" />
            ) : null;
          } catch {
            return null;
          }
        })()}
      </head>
      <body className="min-h-screen antialiased">
        <SiteChrome>{children}</SiteChrome>
        {/* R3 (Zak ordered): applies a pending favorite saved before login —
            js/app.js:132 onAuthStateChanged hook parity */}
        <PendingActionApplier />
        {/* QA 16 Sep 2026 #4: restore the pre-login scroll position after an
            auth bounce — js/app.js armScroll parity. Suspense: usePathname()
            must not run during static prerender; the armer is a no-UI
            side-effect component, so a null fallback is safe. */}
        <Suspense fallback={null}>
          <ScrollRestoreArmer />
        </Suspense>
        {/* 14 Oct 2026 (Zak ordered): register the image-cache service worker.
            Images only — repeat views load listing photos from cache. */}
        <SwRegister />
      </body>
    </html>
  );
}
