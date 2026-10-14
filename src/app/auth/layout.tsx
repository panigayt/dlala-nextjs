import type { Metadata } from 'next';
import { SITE } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'تسجيل الدخول — دلالة',
  alternates: { canonical: `${SITE}/auth` },
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
