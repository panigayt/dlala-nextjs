'use client';
// 11 Oct 2026: Client-side price-reduced badge (responds to language switches).
import { useLang } from '@/lib/i18n';

export default function PriceReducedBadge() {
  const { t } = useLang();
  return (
    <span className="ms-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-sm font-semibold text-red-700">
      {t('priceReduced')}
    </span>
  );
}
