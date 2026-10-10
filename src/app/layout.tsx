import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import "./chrome.css";
import "./vitrine.css";
import "./guides.css";
import SiteChrome from "@/components/SiteChrome";
import PendingActionApplier from "@/components/PendingActionApplier";
import ScrollRestoreArmer from "@/components/ScrollRestoreArmer";

export const metadata: Metadata = {
  title: "دلالة — سوق الجزائر للإعلانات المبوبة",
  description: "موقع دلالة: إعلانات مبوبة مجانية في الجزائر — سيارات، عقارات، هواتف، والمزيد.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
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
