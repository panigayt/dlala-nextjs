'use client';

// Ratings list — mirrors js/seller.js loadRatings:
// stars (0..5 clamped), rater name, comment; empty + error+retry states.
// The data is fetched server-side (fetchSellerRatings, SSR-visible to
// guests); the retry button re-runs the route's server components via
// router.refresh() so a transient failure recovers without a full reload.

import { useRouter } from 'next/navigation';
import type { SellerRating } from '@/lib/firestore';
import { useLang } from '@/lib/i18n';

export default function RatingsList({
  ratings,
  failed,
}: {
  ratings: SellerRating[] | null;
  failed: boolean;
}) {
  const router = useRouter();
  // Round 111: strings follow the UI language (js/i18n.js parity) —
  // verbatim keys from js/i18n.{ar,fr,en}.js.
  const { t, lang } = useLang();
  return (
    <div className="rounded-xl bg-white shadow-sm p-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <h2 className="text-lg font-bold text-zinc-900 mb-4">{t('ratingsTitle')}</h2>
      {failed ? (
        <div className="text-center py-4">
          <p className="text-zinc-600 text-sm mb-3">⚠️ {t('errorGeneric')}</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded-lg bg-emerald-700 text-white font-bold px-5 py-2 hover:bg-emerald-800"
          >
            {t('retry')}
          </button>
        </div>
      ) : !ratings || ratings.length === 0 ? (
        <p className="text-zinc-400 text-sm text-center py-4">⭐ {t('noRatingsYet')}</p>
      ) : (
        <ul className="space-y-4">
          {ratings.map((r) => (
            <li key={r.id} className="border-b border-zinc-100 pb-4 last:border-0 last:pb-0">
              <div className="text-amber-500" aria-label={`${r.stars} / 5`}>
                {'★'.repeat(r.stars)}
                {'☆'.repeat(5 - r.stars)}
              </div>
              {r.raterName && (
                <div className="mt-1 text-sm font-medium text-zinc-900">{r.raterName}</div>
              )}
              {r.comment && <p className="mt-1 text-sm text-zinc-700">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
