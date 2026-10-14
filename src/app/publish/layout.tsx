import type { Metadata } from 'next';
import { SITE } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'نشر إعلان — دلالة',
  alternates: { canonical: `${SITE}/publish` },
  robots: { index: false, follow: false },
};

export default function PublishLayout({ children }: { children: React.ReactNode }) {
  return children;
}
