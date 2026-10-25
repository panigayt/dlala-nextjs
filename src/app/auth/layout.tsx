import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SITE } from '@/lib/seo';
import { t } from '@/lib/i18n-strings';

// R38-1 primary (locale-aware server title) — REFINED GATE (25 Oct 2026):
// the first version of this fix was dropped because cookies() in
// generateMetadata streams the <title> into <body> in raw bytes (the 17 Oct
// PPR regression the privacy page's static metadata avoids). That gate
// applies to INDEXABLE pages, whose head crawlers read raw. /auth is
// noindex (robots index:false, follow:false below) — crawlers do not
// consume its head title, and the browser tab title is correct either
// way (React relocates streamed tags into <head> on the client).
// The primary is REQUIRED here, not optional: replication proved the
// systemic SiteChrome effect sets the French title on navigation and
// Next's LATE static-metadata application then overwrites it with the
// Arabic static title ~500ms later. Only a locale-correct server title
// survives that late application.
export async function generateMetadata(): Promise<Metadata> {
  const raw = (await cookies()).get('dlala_lang')?.value;
  const l = raw === 'fr' || raw === 'en' ? raw : 'ar';
  return {
    title: t('title_auth', l),
    alternates: { canonical: `${SITE}/auth` },
    robots: { index: false, follow: false },
  };
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
