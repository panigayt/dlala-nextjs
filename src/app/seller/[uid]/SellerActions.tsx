'use client';

// Seller page action buttons — mirrors js/seller.js renderSellerProfile:
//
// - Share store (🔗): js/market.js shareStore — Web Share API when
//   available, else the WhatsApp / Facebook / copy-link dialog. Visible to
//   everyone, including the owner (legacy parity).
// - Report user (⚑): hidden for self (sellerReportVisible — guests DO see
//   it); guests get the login nudge first (R4-D1), then the verified-email
//   gate (requireVerified parity inside openReportDialog), then the dialog
//   with reason + details + optional evidence photo (R2). Deterministic id
//   {reporterUid}_user_{targetUid} — one report per reporter per user; the
//   create-only rule rejects duplicates as permission-denied, which maps to
//   "already reported" (0.0.0.36 F-15), not a generic failure. Evidence-photo
//   orphan cleanup on failed writes (0.0.0.43 Round 38 Team H parity).
// - Block user (🚫): hidden for self; guests get the login nudge; confirm
//   before blocking (never before unblocking); toggles through the
//   toggleBlock Cloud Function; label paints from the pair state
//   (js/block.js armBlockButton / paintBlockButton parity).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState } from '@/lib/firebase-client';
import { withTimeout } from '@/lib/firebase-compat';
import { uploadToR2, deleteR2Objects } from '@/lib/r2-upload';

const TOGGLE_BLOCK_URL =
  'https://europe-west3-dlala-85cea.cloudfunctions.net/toggleBlock';

// Verbatim strings from js/i18n.ar.js
const STR = {
  shareStore: 'مشاركة المتجر',
  reportUser: 'الإبلاغ عن المستخدم',
  loginToReportUser: 'سجّل الدخول للإبلاغ عن مستخدم',
  loginToBlock: 'سجّل الدخول لحظر مستخدم',
  verifyToReport: 'أرسلنا لك رابط التفعيل. فعّل بريدك لتتمكن من النشر ومراسلة البائعين.',
  block: 'حظر',
  unblock: 'إلغاء الحظر',
  blockConfirm: 'حظر هذا المستخدم؟ لن تتمكنا من مراسلة بعضكما بعد الآن.',
  blockFailed: 'تعذّر تحديث الحظر — حاول مجدداً.',
  userBlocked: 'تم حظر المستخدم.',
  userUnblocked: 'تم إلغاء حظر المستخدم.',
  reportReason: 'سبب البلاغ',
  reportDetails: 'تفاصيل إضافية',
  reportDetailsHint: 'اشرح ما حدث…',
  reportPhoto: 'صورة دليل (اختياري)',
  optional: 'اختياري',
  sendReport: 'إرسال البلاغ',
  reportSent: 'تم إرسال البلاغ. شكراً لك.',
  reportFailed: 'تعذّر إرسال البلاغ. حاول مجدداً.',
  reportExists: 'لقد أبلغت عن هذا مسبقاً.',
  copyLink: 'نسخ الرابط',
  linkCopied: 'تم نسخ الرابط.',
  close: 'إغلاق',
  errorGeneric: 'حدث خطأ — حاول مجدداً',
};

// Verbatim REPORT_REASONS order from js/market.js.
const REASONS: ReadonlyArray<readonly [string, string]> = [
  ['scam', 'احتيال'],
  ['fake', 'إعلان وهمي'],
  ['prohibited', 'محتوى محظور'],
  ['spam', 'إزعاج / سبام'],
  ['abuse', 'إساءة'],
  ['other', 'أخرى'],
];

// Canonical store share URL — verbatim js/market.js storeShareUrl.
const storeShareUrl = (uid: string) =>
  'https://dzdlala.com/seller.html?uid=' + encodeURIComponent(uid);

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
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
      dir="rtl"
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
            aria-label={STR.close}
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

export default function SellerActions({
  uid,
  storeName,
}: {
  uid: string;
  storeName: string;
}) {
  const router = useRouter();
  const auth = useAuthState();
  const [toast, setToast] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [repReason, setRepReason] = useState<string>('scam');
  const [repDetails, setRepDetails] = useState('');
  const [repPhoto, setRepPhoto] = useState<File | null>(null);
  const [repError, setRepError] = useState<string | null>(null);
  const [repSending, setRepSending] = useState(false);
  // null = checking (never a false 🚫/✓) — js/block.js paintBlockButton
  // keeps the default label until the pair state resolves.
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
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
      showToast(msg);
      window.setTimeout(() => {
        router.push('/auth');
      }, 1500);
    },
    [router, showToast]
  );

  // ---------- block state ----------
  // js/block.js fetchBlockPair parity: best-effort pair read; the server
  // (rules + ratelimit) enforces the real block, the client only paints.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!signedIn || !client || !user || user.uid === uid) return;
      try {
        const [mine, theirs] = await Promise.all([
          withTimeout(client.db.doc(`blocks/${user.uid}_${uid}`).get(), 15000).catch(() => null),
          withTimeout(client.db.doc(`blocks/${uid}_${user.uid}`).get(), 15000).catch(() => null),
        ]);
        // User-block docs always carry blockerUid (admin block docs
        // blocks/{uid} never do — belt-and-braces, verbatim js/block.js).
        const iB =
          !!(mine && mine.exists && (mine.data() as { blockerUid?: string } | undefined)?.blockerUid);
        void theirs;
        if (!cancelled && mounted.current) setBlocked(iB);
      } catch {
        if (!cancelled && mounted.current) setBlocked(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, client, user, uid]);

  const onBlock = useCallback(async () => {
    if (auth.status === 'loading' || blockBusy) return;
    if (!user || !client) {
      guestNudgeThenLogin(STR.loginToBlock);
      return;
    }
    if (user.uid === uid) return;
    // js/block.js armBlockButton: unblocking never asks; blocking asks once.
    if (!blocked) {
      if (!window.confirm(STR.blockConfirm)) return;
    }
    setBlockBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(TOGGLE_BLOCK_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ data: { uid }, idToken }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.result || typeof json.result.blocked !== 'boolean') {
        throw new Error('blockFailed');
      }
      const nowBlocked = json.result.blocked as boolean;
      if (mounted.current) setBlocked(nowBlocked);
      showToast(nowBlocked ? STR.userBlocked : STR.userUnblocked);
    } catch (e) {
      console.error(e);
      showToast(STR.blockFailed);
    } finally {
      if (mounted.current) setBlockBusy(false);
    }
  }, [auth.status, blockBusy, user, client, uid, blocked, guestNudgeThenLogin, showToast]);

  // ---------- share ----------
  const shareUrl = storeShareUrl(uid);

  const onShare = useCallback(() => {
    const nav = window.navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    // js/market.js shareStore: Web Share API when available, else the
    // WhatsApp / Facebook / copy-link dialog.
    if (typeof nav.share === 'function') {
      nav.share({ title: 'DLALA', text: storeName || 'DLALA', url: shareUrl }).catch(() => {});
      return;
    }
    setShareOpen(true);
  }, [storeName, shareUrl]);

  const onCopyLink = useCallback(async () => {
    try {
      await window.navigator.clipboard.writeText(shareUrl);
      setShareOpen(false);
      showToast(STR.linkCopied);
    } catch {
      window.prompt(STR.copyLink, shareUrl);
    }
  }, [shareUrl, showToast]);

  // ---------- report ----------
  const onReportClick = useCallback(async () => {
    if (auth.status === 'loading') return;
    if (!user || !client) {
      // R4-D1 (js/seller.js renderSellerExtras): guest gets the toast nudge
      // before the auth redirect — UX consistency with the listing page.
      guestNudgeThenLogin(STR.loginToReportUser);
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
      showToast(STR.verifyToReport);
      return;
    }
    setRepError(null);
    setReportOpen(true);
  }, [auth.status, user, client, uid, guestNudgeThenLogin, showToast]);

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
          targetTitle: storeName || '',
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
      showToast(STR.reportSent);
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
      setRepError(code === 'permission-denied' ? STR.reportExists : STR.reportFailed);
    } finally {
      if (mounted.current) setRepSending(false);
    }
  }, [user, client, repSending, repPhoto, repReason, repDetails, uid, storeName, showToast]);

  return (
    <div className="flex flex-wrap gap-3 items-center" dir="rtl">
      {/* Share — visible to everyone including the owner (legacy parity). */}
      <button
        type="button"
        onClick={onShare}
        title={STR.shareStore}
        aria-label={STR.shareStore}
        className="rounded-lg px-4 py-3 font-bold border bg-white border-zinc-300 text-zinc-700 hover:border-emerald-500"
      >
        🔗
      </button>
      {/* Report — everyone except the seller themselves (sellerReportVisible). */}
      {!isOwn && (
        <button
          type="button"
          onClick={onReportClick}
          className="rounded-lg px-4 py-3 font-bold border bg-white border-zinc-300 text-zinc-700 hover:border-red-300"
        >
          ⚑ {STR.reportUser}
        </button>
      )}
      {/* Block — non-owner only (guests get the login nudge on tap). */}
      {!isOwn && (
        <button
          type="button"
          onClick={onBlock}
          disabled={blockBusy}
          aria-pressed={blocked === true}
          className="rounded-lg px-4 py-3 font-bold border bg-white border-zinc-300 text-zinc-700 hover:border-red-300 disabled:opacity-50"
        >
          {blocked === true ? `✓ ${STR.unblock}` : `🚫 ${STR.block}`}
        </button>
      )}

      {shareOpen && (
        <Modal title={STR.shareStore} onClose={() => setShareOpen(false)}>
          <div className="flex flex-wrap gap-2">
            <a
              className="rounded-lg bg-emerald-700 text-white font-bold px-4 py-2"
              href={`https://wa.me/?text=${encodeURIComponent((storeName || 'DLALA') + ' — DLALA')}%20${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener"
            >
              WhatsApp
            </a>
            <a
              className="rounded-lg border border-zinc-300 font-bold px-4 py-2"
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener"
            >
              Facebook
            </a>
            <button
              type="button"
              onClick={onCopyLink}
              className="rounded-lg border border-zinc-300 font-bold px-4 py-2"
            >
              {STR.copyLink}
            </button>
          </div>
        </Modal>
      )}

      {reportOpen && (
        <Modal title={STR.reportUser} onClose={() => !repSending && setReportOpen(false)}>
          <label className="block text-sm font-medium">{STR.reportReason}</label>
          <select
            value={repReason}
            onChange={(e) => setRepReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 bg-white"
          >
            {REASONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <label className="mt-3 block text-sm font-medium">
            {STR.reportDetails} <span className="text-zinc-400">({STR.optional})</span>
          </label>
          <textarea
            value={repDetails}
            onChange={(e) => setRepDetails(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={STR.reportDetailsHint}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
          <label className="mt-3 block text-sm font-medium">{STR.reportPhoto}</label>
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
            {STR.sendReport}
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
    </div>
  );
}
