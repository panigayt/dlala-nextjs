'use client';

// Ratings list — mirrors js/seller.js loadRatings:
// stars (0..5 clamped), rater name, comment; empty + error+retry states.
// The data is fetched server-side (fetchSellerRatings, SSR-visible to
// guests); the retry button re-runs the route's server components via
// router.refresh() so a transient failure recovers without a full reload.

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import type { SellerRating } from '@/lib/firestore';
import { useLang } from '@/lib/i18n';
import { getFirebaseBundled } from '@/lib/firebase';
import { withTimeout } from '@/lib/timeout';

export default function RatingsList({
  ratings,
  failed,
  profileUid,
}: {
  ratings: SellerRating[] | null;
  failed: boolean;
  profileUid?: string;
}) {
  const router = useRouter();
  const { t, lang } = useLang();
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  // 11 Oct 2026: track reported reviews — prevents duplicate spam.
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  // 11 Oct 2026: track error vs success — errors were showing in green.
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Lazy-load the Firebase SDK — keeps it off the initial page chunk.
    getFirebaseBundled()
      .then(({ auth }) => {
      const user = auth.currentUser;
      if (mounted) setCurrentUid(user ? user.uid : null);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const isOwner = profileUid && currentUid && profileUid === currentUid;

  const handleReport = async (rating: SellerRating) => {
    // 11 Oct 2026: prevent duplicate reports for the same review.
    if (!isOwner || reporting || reported.has(rating.id)) return;
    // 11 Oct 2026: removed native confirm() — it hangs headless browsers.
    // The button label is clear enough; the action is reversible via admin.
    setReporting(rating.id);
    try {
      // Lazy-load the Firebase SDK — keeps it off the initial page chunk.
      const { db, fsMod, auth } = await getFirebaseBundled();
      // Use the existing /reports collection (targetType='review').
      // Rules: only the reviewed user may report; shape validated server-side.
      // 11 Oct 2026: deterministic ID — prevents duplicate reports on retry/reload.
      const reportId = `${currentUid}_review_${rating.id}`;
      const user = auth.currentUser;
      // 11 Oct 2026: 15s timeout — prevents browser hang if Firestore stalls.
      await withTimeout(
        fsMod.setDoc(fsMod.doc(db, `reports/${reportId}`), {
          reporterId: currentUid,
          reporterName: user?.displayName || '',
          targetType: 'review',
          targetId: rating.id,
          targetTitle: `Review by ${rating.raterName || 'user'}`,
          targetUserId: (rating as { raterId?: string }).raterId || '',
          reason: 'abuse',
          details: `Reported review: ${rating.stars}/5 - ${rating.comment || ''}`.slice(0, 2000),
          photoUrl: '',
          status: 'new',
          createdAt: fsMod.serverTimestamp(),
        }),
        15000
      );
      setMessage(t('reportSent'));
      setMessageIsError(false);
      // 11 Oct 2026: mark as reported — disables the button.
      setReported((prev) => new Set(prev).add(rating.id));
    } catch (e) {
      console.error(e);
      // 11 Oct 2026: permission-denied = duplicate (deterministic ID exists).
      const code = (e as { code?: string })?.code || '';
      setMessage(code === 'permission-denied' ? t('reportExists') : t('reportFailed'));
      setMessageIsError(true);
    } finally {
      setReporting(null);
    }
  };
  return (
    <div className="rounded-xl bg-white shadow-sm p-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <h2 className="text-lg font-bold text-zinc-900 mb-4">{t('ratingsTitle')}</h2>
      {message && (
        <p className={`mb-3 text-sm rounded-lg px-3 py-2 ${
          messageIsError
            ? 'text-red-700 bg-red-50'
            : 'text-emerald-700 bg-emerald-50'
        }`}>{message}</p>
      )}
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
          {ratings.map((r) => {
            // 11 Oct 2026: clamp stars 0..5 — negative crashes repeat().
            const stars = Math.max(0, Math.min(5, Math.round(r.stars || 0)));
            return (
            <li key={r.id} className="border-b border-zinc-100 pb-4 last:border-0 last:pb-0">
              <div className="text-amber-500" aria-label={`${stars} / 5`}>
                {'★'.repeat(stars)}
                {'☆'.repeat(5 - stars)}
              </div>
              {r.raterName && (
                <div className="mt-1 text-sm font-medium text-zinc-900">{r.raterName}</div>
              )}
              {r.comment && <p className="mt-1 text-sm text-zinc-700">{r.comment}</p>}
              {isOwner && (
                <button
                  type="button"
                  onClick={() => handleReport(r)}
                  // 11 Oct 2026: disable ALL while any report in flight.
                  disabled={reporting !== null || reported.has(r.id)}
                  className="mt-2 text-xs text-zinc-500 underline hover:text-zinc-700 disabled:opacity-50"
                >
                  {reporting === r.id ? '...' : t('reportReview')}
                </button>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
