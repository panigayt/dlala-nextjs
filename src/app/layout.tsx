import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import "./chrome.css";
import "./vitrine.css";
import "./guides.css";
import SiteChrome from "@/components/SiteChrome";
import PendingActionApplier from "@/components/PendingActionApplier";
import ScrollRestoreArmer from "@/components/ScrollRestoreArmer";
import { cookies } from "next/headers";

// 11 Oct 2026: language-aware metadata — was hardcoded Arabic in EN/FR mode.
export async function generateMetadata(): Promise<Metadata> {
  const lang = (await cookies()).get("dlala_lang")?.value || "ar";
  const titles: Record<string, string> = {
    ar: "دلالة — سوق الجزائر للإعلانات المبوبة",
    fr: "Dlala — Petites annonces en Algérie",
    en: "Dlala — Classifieds in Algeria",
  };
  const descs: Record<string, string> = {
    ar: "موقع دلالة: إعلانات مبوبة مجانية في الجزائر — سيارات، عقارات، هواتف، والمزيد.",
    fr: "Dlala : petites annonces gratuites en Algérie — voitures, immobilier, téléphones et plus.",
    en: "Dlala: free classifieds in Algeria — cars, real estate, phones and more.",
  };
  return {
    title: titles[lang] || titles.ar,
    description: descs[lang] || descs.ar,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* Round 160 — 0.0.0.39 index.html parity: preconnect to the image
            and data hosts so the first card image / Firestore fetch skips
            DNS+TCP+TLS setup (saves ~200-500ms on mobile). */}
        <link rel="preconnect" href="https://firebasestorage.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://firestore.googleapis.com" crossOrigin="anonymous" />
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
      </body>
    </html>
  );
}
