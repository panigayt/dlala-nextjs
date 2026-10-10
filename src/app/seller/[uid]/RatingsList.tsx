'use client';

// Ratings list — mirrors js/seller.js loadRatings:
// stars (0..5 clamped), rater name, comment; empty + error+retry states.
// The data is fetched server-side (fetchSellerRatings, SSR-visible to
// guests); the retry button re-runs the route's server components via
// router.refresh() so a transient failure recovers without a full reload.

import { useRouter } from 'next/navigation';
import type { SellerRating } from '@/lib/firestore';

// Verbatim strings from js/i18n.ar.js
const STR = {
  ratingsTitle: 'التقييمات',
  noRatingsYet: 'لا توجد تقييمات بعد.',
  errorGeneric: 'حدث خطأ — حاول مجدداً',
  retry: 'إعادة المحاولة',
};

export default function RatingsList({
  ratings,
  failed,
}: {
  ratings: SellerRating[] | null;
  failed: boolean;
}) {
  const router = useRouter();
  return (
    <div className="rounded-xl bg-white shadow-sm p-6" dir="rtl">
      <h2 className="text-lg font-bold text-zinc-900 mb-4">{STR.ratingsTitle}</h2>
      {failed ? (
        <div className="text-center py-4">
          <p className="text-zinc-600 text-sm mb-3">⚠️ {STR.errorGeneric}</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded-lg bg-emerald-700 text-white font-bold px-5 py-2 hover:bg-emerald-800"
          >
            {STR.retry}
          </button>
        </div>
      ) : !ratings || ratings.length === 0 ? (
        <p className="text-zinc-400 text-sm text-center py-4">⭐ {STR.noRatingsYet}</p>
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
