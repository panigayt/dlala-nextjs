import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SITE } from '@/lib/seo';
import { t } from '@/lib/i18n-strings';

// R38-1 primary (locale-aware server title) — same refined gate as
// auth/layout.tsx: /favorites is noindex, so the raw-byte head-placement
// concern for indexable pages does not apply; the locale-correct server
// title is what survives Next's late metadata application on navigation.
export async function generateMetadata(): Promise<Metadata> {
  const raw = (await cookies()).get('dlala_lang')?.value;
  const l = raw === 'fr' || raw === 'en' ? raw : 'ar';
  return {
    title: t('title_favorites', l),
    alternates: { canonical: `${SITE}/favorites` },
    robots: { index: false, follow: false },
  };
}

export default function FavoritesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
