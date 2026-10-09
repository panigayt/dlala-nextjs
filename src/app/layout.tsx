import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "دلالة — سوق الجزائر للإعلانات المبوبة",
  description: "موقع دلالة: إعلانات مبوبة مجانية في الجزائر — سيارات، عقارات، هواتف، والمزيد.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
