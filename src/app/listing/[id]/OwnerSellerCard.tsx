'use client';

// Owner view of the seller card — mirrors js/listing.js refreshAuthDependent:
// when the signed-in viewer IS the seller, the seller card is replaced with
// a compact "✓ إعلانك" (t('yourListing')) indicator.

import type { ReactNode } from 'react';
import { useAuthState } from '@/lib/firebase-client';
import { useLang } from '@/lib/i18n';

export default function OwnerSellerCard({
  sellerId,
  children,
}: {
  sellerId: string | undefined;
  children: ReactNode;
}) {
  const auth = useAuthState();
  // Round 108: trilingual AR/FR/EN (js/i18n.js parity) — t('yourListing').
  const { t, lang } = useLang();
  const isOwn =
    !!sellerId &&
    auth.status === 'signed-in' &&
    !!auth.user &&
    auth.user.uid === sellerId;

  if (isOwn) {
    return (
      <div className="mt-4 rounded-xl bg-white shadow-sm p-5">
        <h2 className="text-lg font-semibold">{t('seller')}</h2>
        <span
          className="mt-2 inline-block rounded-full bg-emerald-100 text-emerald-800 font-bold px-4 py-1.5"
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
        >
          ✓ {t('yourListing')}
        </span>
      </div>
    );
  }
  return <>{children}</>;
}
