'use client';
// 11 Oct 2026: Client-side wanted badge that responds to language switches.
// The parent page is a Server Component, so a server-rendered badge would
// stay in the old language when the user switches via the client-side
// language switcher.
import { useLang } from '@/lib/i18n';

export default function WantedBadge() {
  const { t } = useLang();
  // 11 Oct 2026: dark amber gradient — exact 0.0.0.39 parity (was light blue).
  return (
    <span
      className="mt-2 inline-block rounded-full px-3 py-1 text-sm font-bold text-white"
      style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}
    >
      {t('wantedBadge')}
    </span>
  );
}
