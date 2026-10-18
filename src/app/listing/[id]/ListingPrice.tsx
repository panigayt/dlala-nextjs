// Listing price block — client-side localized (R54).
//
// R54 root fix (18 Oct 2026): SSR is language-invariant (Arabic); the price
// currency label (دج vs DZD) and the negotiable badge follow the UI language
// via useLang(). The Darija price parenthetical stays Arabic in every UI
// language (Zak, 21 Sep 2026) — it is computed server-side and passed in.

'use client';

import { useLang } from '@/lib/i18n';
import { formatPrice } from '@/lib/firestore';
import PriceReducedBadge from './PriceReducedBadge';

export default function ListingPrice({
  price,
  negotiable,
  priceWords,
  priceReduced,
}: {
  price: number;
  negotiable: boolean;
  priceWords: string;
  priceReduced: boolean;
}) {
  const { lang, t } = useLang();
  return (
    <p className="mt-2 text-3xl font-bold text-emerald-700">
      {/* Zak 18 Oct 2026: ALWAYS show the price (even "1 دج") + badge.
          Clean 2-line layout: line 1 = price + دج + badge, line 2 = Darija. */}
      <span className="whitespace-nowrap">
        <span dir="ltr">{formatPrice(price || 0, lang)}</span>
        {(negotiable || Number(price) <= 1) && (
          <span className="ms-2 text-sm font-normal bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 whitespace-nowrap align-middle">{t('negotiable')}</span>
        )}
      </span>
      {priceWords && <span className="block text-base font-normal text-zinc-500">({priceWords})</span>}
      {priceReduced && (
        <PriceReducedBadge />
      )}
    </p>
  );
}
