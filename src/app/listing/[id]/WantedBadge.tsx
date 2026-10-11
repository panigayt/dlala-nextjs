'use client';
// 11 Oct 2026: Client-side wanted badge that responds to language switches.
// The parent page is a Server Component, so a server-rendered badge would
// stay in the old language when the user switches via the client-side
// language switcher.
import { useLang } from '@/lib/i18n';

export default function WantedBadge() {
  const { t } = useLang();
  return (
    <span className="mt-2 inline-block rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-800">
      {t('wantedBadge')}
    </span>
  );
}
