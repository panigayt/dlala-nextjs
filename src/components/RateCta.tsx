'use client';

// Rating entry point ("★ قيّم هذا المستخدم") — mirrors js/seller.js
// loadRateCta + js/market.js rateableDeals/openRatingDialog/submitRating.
//
// Zak's rule: ratings exist only after a buyer-confirmed transaction —
// mutual 5-star + mandatory written comment justifying the stars (not
// saved/shown otherwise). The client writes only the rating document
// (deterministic id {conversationId}_{raterId}); the public rating /
// ratingCount counters are owned by the recalcRating Cloud Function.
//
// - Guests see nothing (legacy loadRateCta returns early for guests).
// - Own profile: nothing.
// - Signed-in viewer: one button per rateable deal — conversations where
//   dealConfirmedByBuyer === true, the other party is this seller, and I
//   haven't rated this conversation yet. Click opens the rating dialog.
// - The dialog requires stars (1-5) and a non-empty comment (mandatory,
//   maxlength 1000) — throws 'stars' / 'comment' on violation like legacy.
// - requireVerified parity: the cached user object is reloaded before the
//   emailVerified check (it stays stale after the user clicks the link in
//   another tab).
// - On success: toast, dialog close, router.refresh() (the server-rendered
//   RatingsList revalidates), and the CTA list reloads (the rated deal
//   disappears).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
// Round 12: firebase-client user → CDN path. btnSecondaryCls is a pure CSS
// string const on the new module — no SDK loader involved.
import { useAuthState, btnSecondaryCls } from '@/lib/firebase';
import { useLang } from '@/lib/i18n';
import { useModalDialog } from '@/lib/use-modal-dialog';
import {
  fetchRateableDeals,
  submitRating,
  type RateableDeal,
} from '@/lib/ratings';

// Verbatim strings from js/i18n.{ar,fr,en}.js
const STRINGS = {
  ar: {
    rateThisUser: 'قيّم هذا المستخدم',
    yourComment: 'تعليقك',
    commentHint: 'اشرح سبب تقييمك (إجباري)…',
    selectStars: 'اختر عدد النجوم أولاً.',
    commentRequired: 'التعليق إجباري — لن يُحفظ التقييم بدونه.',
    submitRating: 'إرسال التقييم',
    ratingSent: 'تم إرسال تقييمك.',
    alreadyRated: 'لقد قيّمت هذه الصفقة من قبل.',
    ratingFailed: 'تعذّر إرسال التقييم. حاول مجدداً.',
    verifyToRate:
      'أرسلنا لك رابط التفعيل. فعّل بريدك لتتمكن من النشر ومراسلة البائعين.',
    close: 'إغلاق',
  },
  fr: {
    rateThisUser: 'Évaluer cet utilisateur',
    yourComment: 'Votre commentaire',
    commentHint: 'Expliquez votre note (obligatoire)…',
    selectStars: 'Choisissez d’abord le nombre d’étoiles.',
    commentRequired:
      'Le commentaire est obligatoire — l’avis ne sera pas enregistré sans lui.',
    submitRating: 'Envoyer l’avis',
    ratingSent: 'Votre avis a été envoyé.',
    alreadyRated: 'Vous avez déjà évalué cette transaction.',
    ratingFailed: 'Échec de l’envoi. Réessayez.',
    verifyToRate:
      'Nous vous avons envoyé le lien d’activation. Activez votre e-mail pour publier et contacter les vendeurs.',
    close: 'Fermer',
  },
  en: {
    rateThisUser: 'Rate this user',
    yourComment: 'Your comment',
    commentHint: 'Explain your rating (required)…',
    selectStars: 'Select the number of stars first.',
    commentRequired:
      'A comment is required — the rating will not be saved without one.',
    submitRating: 'Submit rating',
    ratingSent: 'Your rating has been sent.',
    alreadyRated: 'You already rated this deal.',
    ratingFailed: 'Could not send the rating. Try again.',
    verifyToRate:
      'We sent you the activation link. Verify your email to publish and message sellers.',
    close: 'Close',
  },
} as const;

type Lang3 = keyof typeof STRINGS;

export default function RateCta({
  uid,
  rateeName,
}: {
  uid: string;
  rateeName: string;
}) {
  const router = useRouter();
  const auth = useAuthState();
  const { lang } = useLang();
  const STR = STRINGS[(lang as Lang3) in STRINGS ? (lang as Lang3) : 'ar'];
  const [deals, setDeals] = useState<RateableDeal[] | null>(null);
  const [active, setActive] = useState<RateableDeal | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const mounted = useRef(true);
  const toastTimer = useRef<number | null>(null);
  // R32-4: shared dialog keyboard/focus behavior — useModalDialog.
  // The close guard matches the overlay click's (!sending).
  const dialogRef = useModalDialog({
    open: !!active,
    onClose: () => {
      if (!sending) setActive(null);
    },
  });

  const signedIn = auth.status === 'signed-in';
  const user = signedIn ? auth.user : null;
  const client = signedIn ? auth.client : null;
  const isOwn = !!(user && user.uid === uid);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      if (mounted.current) setToast(null);
    }, 2600);
  }, []);

  const loadDeals = useCallback(async () => {
    if (!user || !client || user.uid === uid) return;
    try {
      const d = await fetchRateableDeals(client, user.uid, uid);
      if (mounted.current) setDeals(d);
    } catch {
      if (mounted.current) setDeals([]);
    }
  }, [user, client, uid]);

  // Auth-triggered load (js/seller.js: the auth-dependent bits refresh when
  // authReady resolves). Async only — no synchronous setState in the effect.
  useEffect(() => {
    if (auth.status !== 'signed-in' || !user || !client || user.uid === uid)
      return;
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchRateableDeals(client, user.uid, uid);
        if (!cancelled && mounted.current) setDeals(d);
      } catch {
        if (!cancelled && mounted.current) setDeals([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, user, client, uid]);

  const openDialog = useCallback(
    async (d: RateableDeal) => {
      if (!user) return;
      // requireVerified parity — reload first: the cached user object stays
      // stale (false) after the user clicks the link in another tab.
      try {
        await user.reload();
      } catch {
        /* offline — use cached */
      }
      if (!user.emailVerified) {
        showToast(STR.verifyToRate);
        return;
      }
      setStars(0);
      setComment('');
      setErr(null);
      setSending(false);
      setActive(d);
    },
    [user, showToast, STR]
  );

  const onSubmit = useCallback(async () => {
    if (!user || !client || !active || sending) return;
    setErr(null);
    if (!stars) {
      setErr(STR.selectStars);
      return;
    }
    if (!comment.trim()) {
      setErr(STR.commentRequired);
      return;
    }
    setSending(true);
    try {
      await submitRating({
        client,
        user,
        conversationId: active.conversationId,
        listingId: active.listingId,
        rateeId: active.rateeId,
        stars,
        comment,
      });
      if (mounted.current) {
        setActive(null);
        showToast(STR.ratingSent);
      }
      // The rated deal is no longer rateable; the server-rendered ratings
      // list revalidates.
      router.refresh();
      loadDeals();
    } catch (e) {
      if (mounted.current) {
        const code = (e as { code?: string }).code;
        setErr(code === 'already-rated' ? STR.alreadyRated : STR.ratingFailed);
        setSending(false);
      }
    }
  }, [user, client, active, sending, stars, comment, router, loadDeals, showToast, STR]);

  // Guests and owners: legacy loadRateCta returns early — nothing rendered.
  if (auth.status !== 'signed-in' || isOwn || !deals || deals.length === 0) {
    return null;
  }

  return (
    <>
      {/* 11 Oct 2026: dir follows language (was hardcoded rtl). */}
      <div className="mt-4 flex flex-wrap" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {deals.map((d) => (
          <button
            key={d.conversationId}
            type="button"
            onClick={() => openDialog(d)}
            className={btnSecondaryCls}
            style={{ margin: '0 6px 6px 0' }}
          >
            ★ {STR.rateThisUser}
            {d.listingTitle ? ` — ${d.listingTitle}` : ''}
          </button>
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          onClick={() => !sending && setActive(null)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={STR.rateThisUser}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">{STR.rateThisUser}</h3>
              <button
                type="button"
                onClick={() => setActive(null)}
                aria-label={STR.close}
                disabled={sending}
                // Round 6 (18 Oct 2026): 44px touch target (was ~24px).
                className="rounded px-2 py-1 text-xl leading-none text-zinc-500 hover:bg-zinc-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-zinc-500">{rateeName}</p>
            <div className="mt-3 flex gap-1" role="radiogroup" aria-label={STR.rateThisUser}>
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={stars === i}
                  aria-label={`${i}`}
                  disabled={sending}
                  onClick={() => setStars(i)}
                  className={`text-3xl transition-colors ${
                    i <= stars ? 'text-amber-500' : 'text-zinc-300'
                  } hover:text-amber-400`}
                >
                  ★
                </button>
              ))}
            </div>
            <label className="mt-3 block text-sm font-medium text-zinc-700">
              {STR.yourComment} *
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              rows={3}
              disabled={sending}
              placeholder={STR.commentHint}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {err && (
              <div
                role="alert"
                className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {err}
              </div>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={sending}
              className="mt-3 w-full rounded-lg bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {STR.submitRating}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
