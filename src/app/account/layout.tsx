// Account layout — noindex (R8-6, 18 Oct 2026).
//
// /account is Disallowed in robots.txt but was serving 200 with the root
// layout's default `index, follow` robots meta (client page cannot export
// generateMetadata). This server layout overrides it to noindex, nofollow
// to match robots.txt.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
