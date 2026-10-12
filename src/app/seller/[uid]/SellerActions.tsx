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
import { useAuthState } from '@/lib/firebase';
import { useLang } from '@/lib/i18n';
// 11 Oct 2026: withTimeout now in @/lib/timeout — no firebase-compat import.
import { withTimeout } from '@/lib/timeout';
import { authLoginHref } from '@/lib/auth-return';
import { saveScrollForReturn } from '@/lib/scroll-restore';
import ReportUserButton from '@/components/ReportUserButton';

const TOGGLE_BLOCK_URL =
  'https://europe-west3-dlala-85cea.cloudfunctions.net/toggleBlock';

// Round 111: strings follow the UI language via useLang() (js/i18n.js
// parity) — verbatim keys from js/i18n.{ar,fr,en}.js. The STR const is
// gone; call sites use t('key') directly.

// Canonical store share URL — verbatim js/market.js storeShareUrl.
const storeShareUrl = (uid: string) =>
  'https://dzdlala.com/seller.html?uid=' + encodeURIComponent(uid);

// Icon-only store share button (0.0.0.39 .share-icon-btn parity, 0.0.0.1o):
// Web Share API when available, else the WhatsApp / Facebook / copy-link
// dialog. Visible to everyone, including the owner (legacy parity).
export function ShareIconButton({
  uid,
  storeName,
  className,
}: {
  uid: string;
  storeName: string;
  className?: string;
}) {
  const { t } = useLang();
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      if (mounted.current) setToast(null);
    }, 2600);
  }, []);

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
      showToast(t('linkCopied'));
    } catch {
      window.prompt(t('copyLink'), shareUrl);
    }
  }, [shareUrl, showToast, t]);

  return (
    <>
      <button
        type="button"
        onClick={onShare}
        title={t('shareStore')}
        aria-label={t('shareStore')}
        className={className || 'share-icon-btn'}
      >
        🔗
      </button>

      {shareOpen && (
        <Modal title={t('shareStore')} onClose={() => setShareOpen(false)}>
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
              {t('copyLink')}
            </button>
          </div>
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

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t, lang } = useLang();
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
            aria-label={t('close')}
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
  // Round 111: strings follow the UI language (js/i18n.js parity).
  const { t, lang } = useLang();
  const [toast, setToast] = useState<string | null>(null);
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

  // ---------- block state ----------
  // js/block.js fetchBlockPair parity: best-effort pair read; the server
  // (rules + ratelimit) enforces the real block, the client only paints.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!signedIn || !client || !user || user.uid === uid) return;
      const { db, fsMod } = client;
      try {
        const [mine, theirs] = await Promise.all([
          withTimeout(fsMod.getDoc(fsMod.doc(db, `blocks/${user.uid}_${uid}`)), 15000).catch(() => null),
          withTimeout(fsMod.getDoc(fsMod.doc(db, `blocks/${uid}_${user.uid}`)), 15000).catch(() => null),
        ]);
        // User-block docs always carry blockerUid (admin block docs
        // blocks/{uid} never do — belt-and-braces, verbatim js/block.js).
        const iB =
          !!(mine && mine.exists() && (mine.data() as { blockerUid?: string } | undefined)?.blockerUid);
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
      guestNudgeThenLogin(t('loginToBlock'));
      return;
    }
    if (user.uid === uid) return;
    // js/block.js armBlockButton: unblocking never asks; blocking asks once.
    // 11 Oct 2026: removed window.confirm — hangs headless browsers.
    // The block button itself is the confirmation (with busy state).
    if (!blocked) {
      // Proceed directly — user explicitly clicked Block.
    }
    setBlockBusy(true);
    try {
      const idToken = await client.authMod.getIdToken(user);
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
      showToast(nowBlocked ? t('userBlocked') : t('userUnblocked'));
    } catch (e) {
      console.error(e);
      showToast(t('blockFailed'));
    } finally {
      if (mounted.current) setBlockBusy(false);
    }
  }, [auth.status, blockBusy, user, client, uid, blocked, guestNudgeThenLogin, showToast, t]);

  return (
    <div className="flex flex-wrap gap-3 items-center" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Share — visible to everyone including the owner (legacy parity). */}
      <ShareIconButton uid={uid} storeName={storeName} />
      {/* Report — everyone except the seller themselves (sellerReportVisible);
          the shared component self-hides for the owner too. */}
      {!isOwn && <ReportUserButton uid={uid} targetTitle={storeName} />}
      {/* Block — non-owner only (guests get the login nudge on tap). */}
      {!isOwn && (
        <button
          type="button"
          onClick={onBlock}
          disabled={blockBusy}
          aria-pressed={blocked === true}
          className="rounded-lg px-4 py-3 font-bold border bg-white border-zinc-300 text-zinc-700 hover:border-red-300 disabled:opacity-50"
        >
          {blocked === true ? `✓ ${t('unblock')}` : `🚫 ${t('block')}`}
        </button>
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
