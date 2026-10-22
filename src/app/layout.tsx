import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import "./chrome.css";
import "./vitrine.css";
import "./guides.css";
import SiteChrome from "@/components/SiteChrome";
import ChromeWithLang from "@/components/ChromeWithLang";
import PendingActionApplier from "@/components/PendingActionApplier";
import ScrollRestoreArmer from "@/components/ScrollRestoreArmer";
import SwRegister from "@/components/SwRegister";
import ErrorReporter from "@/components/ErrorReporter";
import GaLoader from "@/components/GaLoader";

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
  // 17 Oct 2026 (audit): apple-touch-icon was missing. Emits
  // <link rel="apple-touch-icon" href="/icon-512.png"> in <head>.
  // public/icon-512.png verified present (the same file og:image uses).
  icons: {
    apple: "/icon-512.png",
  },
  // R53 Team C (18 Oct 2026, Zak): PWA completeness — fullscreen launch from
  // the home screen. capable=true emits <meta name="apple-mobile-web-app-capable"
  // content="yes"> (iOS standalone); the modern "mobile-web-app-capable" is
  // added via `other` below. title="دلالة" sets the home-screen app label;
  // statusBarStyle="default" matches the white background_color. Pure metadata
  // — zero behavioral impact, root layout stays sync + fully static.
  appleWebApp: {
    capable: true,
    title: "دلالة",
    statusBarStyle: "default",
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
    // R53 Team C (18 Oct 2026, Zak): the modern "mobile-web-app-capable" is
    // already emitted by appleWebApp.capable above — this is the legacy
    // Apple-prefixed tag for older iOS Safari (fullscreen home-screen launch).
    "apple-mobile-web-app-capable": "yes",
  },
};

// Round 7 Team 9 (12 Oct 2026): the viewport meta was NEVER present in the
// App Router tree (only the legacy server-rendered model pages had it) —
// mobile browsers fell back to the ~980px default layout viewport and the
// whole site rendered zoomed-out on phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 17 Oct 2026 (audit): theme-color — the logo's emerald green. Emits
  // <meta name="theme-color" content="#0d7a4f"> in <head>; matches the PWA
  // manifest's theme_color (src/app/manifest.ts).
  themeColor: "#0d7a4f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* 16 Oct 2026: Google Analytics 4 (dlala-85cea property).
            Fix Round 3 (22 Oct 2026): gtag/js (159.8 KB) no longer loads
            here — GaLoader (mounted in <body>) injects it only after the
            window load event + idle, or first interaction, so it never
            competes with first paint on weak connections. */}
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
        {/* K-C1 (audit round 2, 18 Oct 2026): ChromeWithLang wraps SiteChrome
            in ForcedLang when the URL has a /fr or /en prefix, so the
            header/footer SSR in the correct language instead of Arabic.
            Suspense: usePathname() is a client hook unavailable during static
            prerender — the fallback renders the default (Arabic) chrome,
            which the client then corrects on hydration for /fr|en paths.
            R13 AX-F1 (18 Oct 2026) ROOT CAUSE: the fallback used to render
            {children} too — so every dynamic page was emitted TWICE in the
            server HTML (fallback tree + primary tree): duplicate <main>,
            duplicate headings, and duplicate JSON-LD. No page-level move of
            the JSON-LD script could ever fix it (verified via curl: R13
            shell-level move still counted 2; R15b BB-2's sibling-of-ListingDir
            move also still counted 2 with 2x </main>). The fallback keeps the
            chrome only; page content streams exactly once via the primary
            tree. */}
        <Suspense fallback={<SiteChrome>{null}</SiteChrome>}>
          <ChromeWithLang>{children}</ChromeWithLang>
        </Suspense>
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
        {/* 21 Oct 2026 (Zak approved): client error telemetry restored —
            the 14 Oct cutover dropped the /report-error rewrite and the
            reporter script. Tiny, lazy, no Firebase imports. */}
        <ErrorReporter />
        {/* Fix Round 3 (22 Oct 2026): deferred GA4 — see GaLoader.tsx. */}
        <GaLoader />
      </body>
    </html>
  );
}
