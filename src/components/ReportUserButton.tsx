'use client';

// Shared "report user" button + dialog — extracted from
// src/app/seller/[uid]/SellerActions.tsx (Round 76), now also used by the
// listing page's seller card (js/listing.js loadSeller full-card parity:
// the legacy listing seller card carries #repUserBtn next to the
// "view store/profile" button).
//
// Behavior (verbatim js/market.js openReportDialog user-target parity):
// - Guests see the button; tap → login nudge, then /auth (R4-D1).
// - Signed-in: verified-email gate (requireVerified parity, reload pattern),
//   then the dialog with reason + details + optional evidence photo (R2).
// - Deterministic id {reporterUid}_user_{targetUid} — one report per reporter
//   per user; the create-only rule rejects duplicates as permission-denied,
//   which maps to "already reported" (0.0.0.36 F-15), not a generic failure.
// - Evidence-photo orphan cleanup on failed writes (0.0.0.43 Round 38 parity).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState } from '@/lib/firebase-client';
import { useLang } from '@/lib/i18n';
import { } from '@/lib/firebase-compat';
import { withTimeout } from '@/lib/timeout';
import { authLoginHref } from '@/lib/auth-return';
import { saveScrollForReturn } from '@/lib/scroll-restore';
import { uploadToR2, deleteR2Objects } from '@/lib/r2-upload';

// All user-facing strings come from the shared trilingual store
// (js/i18n.{ar,fr,en}.js parity); legacy report reasons use the dynamic
// key pattern t('reason' + r[0].toUpperCase() + r.slice(1))
// (js/market.js:713 parity).

function Modal({
  title,
  onClose,
  children,
  lang,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  lang: 'ar' | 'fr' | 'en';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={title}
            className="rounded px-2 py-1 text-xl leading-none text-zinc-500 hover:bg-zinc-100"
          >
            ✕
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

// Verbatim REPORT_REASONS order from js/market.js:708.
const REASONS = ['scam', 'fake', 'prohibited', 'spam', 'abuse', 'other'] as const;

export default function ReportUserButton({
  uid,
  targetTitle,
  className,
}: {
  uid: string;
  targetTitle: string;
  className?: string;
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const auth = useAuthState();
  const [toast, setToast] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [repReason, setRepReason] = useState<string>('scam');
  const [repDetails, setRepDetails] = useState('');
  const [repPhoto, setRepPhoto] = useState<File | null>(null);
  const [repError, setRepError] = useState<string | null>(null);
  const [repSending, setRepSending] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const timerRef = toastTimer;
    return () => {
      mounted.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const signedIn = auth.status === 'signed-in';
  const user = signedIn ? auth.user : null;
  const client = signedIn ? auth.client : null;
  const isOwn = !!(user && user.uid === uid);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      if (mounted.current) setToast(null);
    }, 2600);
  }, []);

  const guestNudgeThenLogin = useCallback(
    (msg: string) => {
      // QA 16 Sep 2026 #4 (js/app.js saveScrollForReturn parity): keep the
      // scroll position across the /auth round-trip.
      saveScrollForReturn(window.location.pathname);
      showToast(msg);
      window.setTimeout(() => {
        router.push(authLoginHref(window.location.pathname, window.location.search));
      }, 1500);
    },
    [router, showToast]
  );

  const onReportClick = useCallback(async () => {
    if (auth.status === 'loading') return;
    if (!user || !client) {
      // R4-D1 (js/seller.js renderSellerExtras): guest gets the toast nudge
      // before the auth redirect — never a silent bounce.
      guestNudgeThenLogin(t('loginToReportUser'));
      return;
    }
    if (user.uid === uid) return; // owner never sees this button
    // Verified-email gate (requireVerified parity — same reload pattern as
    // the listing actions: the cached user object stays stale after the
    // user clicks the link in another tab).
    try {
      await user.reload();
    } catch {
      /* offline — use cached */
    }
    if (!user.emailVerified) {
      showToast(t('verifyToReport'));
      return;
    }
    setRepError(null);
    setReportOpen(true);
  }, [auth.status, user, client, uid, guestNudgeThenLogin, showToast, t]);

  const onSendReport = useCallback(async () => {
    if (!user || !client || repSending) return;
    setRepSending(true);
    setRepError(null);
    // Hoisted so the catch block can clean up an uploaded evidence photo
    // when the report write fails (0.0.0.43 Round 38 Team H parity).
    let photoUrl = '';
    let reportId = '';
    let idToken = '';
    try {
      const f = repPhoto;
      if (f) {
        if (!f.type.startsWith('image/') || f.size > 8 * 1024 * 1024) {
          throw new Error('photo');
        }
        idToken = await user.getIdToken();
        // R2 upload keys must match listings/{uid}/{x}/{filename} (server
        // validates the shape and the uid segment) — the report evidence
        // photo lives under the reporter's own namespace.
        const key = `listings/${user.uid}/report-user-${uid}/ev_${Date.now()}.jpg`;
        const up = await withTimeout(uploadToR2(f, key, idToken), 60000);
        photoUrl = up.publicUrl;
      }
      // 0.0.0.36 F-15: deterministic report id
      // {reporterId}_{targetType}_{targetId} — one report per reporter per
      // user. create-only rules reject the duplicate write.
      reportId = `${user.uid}_user_${uid}`;
      const reporterName = ((user.displayName || user.email || '') as string).split('@')[0];
      await withTimeout(
        client.db.doc(`reports/${reportId}`).set({
          reporterId: user.uid,
          reporterName,
          targetType: 'user',
          targetId: uid,
          targetTitle: targetTitle || '',
          targetUserId: uid,
          reason: repReason,
          details: repDetails.trim(),
          photoUrl,
          status: 'new',
          createdAt: client.FieldValue.serverTimestamp(),
        }),
        20000
      );
      setReportOpen(false);
      setRepPhoto(null);
      setRepDetails('');
      showToast(t('reportSent'));
    } catch (e) {
      console.error(e);
      // The write failed AFTER the evidence photo uploaded — if the
      // existing report (if any) doesn't point at OUR photo, our upload is
      // a pure orphan and is deleted. Any read failure keeps the photo
      // rather than risking one that committed server-side
      // (retry-after-commit).
      if (photoUrl && (e as { code?: string })?.code === 'permission-denied') {
        try {
          const existing = await withTimeout(client.db.doc(`reports/${reportId}`).get(), 8000);
          const data = existing.data() as { photoUrl?: string } | undefined;
          const committed = existing.exists && data && data.photoUrl === photoUrl;
          if (!committed) {
            const tok = idToken || (await user.getIdToken());
            await deleteR2Objects([photoUrl], tok).catch(() => {});
          }
        } catch {
          /* best-effort */
        }
      }
      const code = (e as { code?: string })?.code || '';
      setRepError(code === 'permission-denied' ? t('reportExists') : t('reportFailed'));
    } finally {
      if (mounted.current) setRepSending(false);
    }
  }, [user, client, repSending, repPhoto, repReason, repDetails, uid, targetTitle, showToast, t]);

  // Owner never sees the button (legacy sellerReportVisible parity) — the
  // listing page also hides it inside OwnerSellerCard, double guard.
  if (isOwn) return null;

  return (
    <>
      <button
        type="button"
        onClick={onReportClick}
        className={
          className ||
          'rounded-lg px-4 py-3 font-bold border bg-white border-zinc-300 text-zinc-700 hover:border-red-300'
        }
      >
        ⚑ {t('reportUser')}
      </button>

      {reportOpen && (
        <Modal title={t('reportUser')} onClose={() => !repSending && setReportOpen(false)} lang={lang}>
          <label className="block text-sm font-medium">{t('reportReason')}</label>
          <select
            value={repReason}
            onChange={(e) => setRepReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 bg-white"
          >
            {REASONS.map((v) => (
              <option key={v} value={v}>
                {t('reason' + v[0].toUpperCase() + v.slice(1))}
              </option>
            ))}
          </select>
          <label className="mt-3 block text-sm font-medium">
            {t('reportDetails')} <span className="text-zinc-400">({t('optional')})</span>
          </label>
          <textarea
            value={repDetails}
            onChange={(e) => setRepDetails(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={t('reportDetailsHint')}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
          <label className="mt-3 block text-sm font-medium">{t('reportPhoto')}</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setRepPhoto(e.target.files?.[0] || null)}
            className="mt-1 w-full text-sm"
          />
          {repError && (
            <div
              role="alert"
              className="mt-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2"
            >
              {repError}
            </div>
          )}
          <button
            type="button"
            onClick={onSendReport}
            disabled={repSending}
            className="mt-4 w-full rounded-lg bg-red-600 text-white font-bold px-5 py-2.5 disabled:opacity-50"
          >
            {t('sendReport')}
          </button>
        </Modal>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-[90vw] text-center"
        >
          {toast}
        </div>
      )}
    </>
  );
}
