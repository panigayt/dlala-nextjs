import type { Metadata } from 'next';
import { SITE } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'المفضلة — دلالة',
  alternates: { canonical: `${SITE}/favorites` },
  robots: { index: false, follow: false },
};

export default function FavoritesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
