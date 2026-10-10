import type { Metadata } from "next";
import "./globals.css";
import "./chrome.css";
import SiteChrome from "@/components/SiteChrome";
import PendingActionApplier from "@/components/PendingActionApplier";

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
      </body>
    </html>
  );
}
