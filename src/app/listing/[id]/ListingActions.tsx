'use client';

// Listing detail interactive actions — mirrors js/listing.js:
// - Favorite button (♡/♥ toggle, guest nudge → /auth, optimistic flip with
//   server reconciliation, per-listing in-flight guard, listingFavoriters doc
//   parity with js/app.js toggleFavorite).
// - Contact seller button (guest nudge → /auth, verified-email gate,
//   double-tap guard, find-or-create conversation → /chat/[id]).
// - Propose price button (js/listing.js onProposePrice): guest nudge → /auth,
//   verified-email gate, dialog with amount input; on submit the
//   conversation opens with ?offer=<amt> (URL param + sessionStorage
//   fallback — the chat page pre-fills the proposal, never auto-sends).
//   Buyer-only (hidden for owner); disabled on sold listings (LIS-1).
// - Share button (verbatim js/market.js shareListing): canonical
//   dzdlala.com/listing.html?id= URL (works in browsers, the Android app's
//   deep-link routing, and iOS Safari). navigator.share when available,
//   otherwise a WhatsApp / Facebook / copy-link dialog. Visible to everyone,
//   including the owner (legacy parity: owners hide favorite/contact/report
//   but keep share).
// - Report ad button (js/listing.js onReportAd + js/market.js
//   openReportDialog): guest nudge first (LIS-4), then the verified-email
//   gate (requireVerified inside openReportDialog), then a dialog with a
//   reason select + optional details + optional evidence photo (R2).
//   Deterministic id {uid}_listing_{id} — one report per reporter per ad;
//   the create-only rule rejects duplicates as permission-denied, which maps
//   to "already reported" (0.0.0.36 F-15), not a generic failure.
//   Evidence-photo orphan cleanup on failed writes (0.0.0.43 Round 38
//   Team H parity).
// Legacy behavior notes:
// - LIS-4: guests tapping favorite/contact/report get a toast explaining why,
//   then login — never a silent bounce to /auth.
// - The favorite button renders neutral until the isFavorite check resolves
//   (never a false ♡/♥); guests default to ♡.
// - Owner viewing their own listing: favorite/contact/report are HIDDEN
//   entirely; share stays visible.
// - Sold listing: contact is disabled; favorite/report/share still work.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState } from '@/lib/firebase-client';
import { getFirebase, withTimeout } from '@/lib/firebase-compat';
import { uploadToR2, deleteR2Objects } from '@/lib/r2-upload';
import { authLoginHref } from '@/lib/auth-return';
import { saveScrollForReturn } from '@/lib/scroll-restore';
import { tasteNoteFav } from '@/lib/taste';
import { useLang } from '@/lib/i18n';

// Report reasons — verbatim order from js/market.js REPORT_REASONS; labels
// via t('reasonX') (legacy: t('reason' + r[0].toUpperCase() + r.slice(1))).
const REASON_IDS = ['scam', 'fake', 'prohibited', 'spam', 'abuse', 'other'] as const;

function reasonLabel(id: string, t: (k: string) => string): string {
  return t('reason' + id[0].toUpperCase() + id.slice(1));
}

// Canonical share URL — verbatim js/market.js shareListing (the '?id=' form
// is routed by the Android app AND served by hosting, so one URL works in
// browsers, the app, and iOS Safari).
const shareUrlFor = (listingId: string) =>
  'https://dzdlala.com/listing.html?id=' + listingId;

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

interface Props {
  listingId: string;
  sellerId: string;
  title: string; // localized (ar) title, denormalized into the fav doc
  price: number;
  photoUrl: string;
  sold: boolean;
}

function showToast(setToast: (m: string | null) => void, msg: string, timer: { current: number | null }) {
  setToast(msg);
  if (timer.current) window.clearTimeout(timer.current);
  timer.current = window.setTimeout(() => setToast(null), 2600);
}

export default function ListingActions({ listingId, sellerId, title, price, photoUrl, sold }: Props) {
  const router = useRouter();
  const auth = useAuthState();
  // Round 108: trilingual AR/FR/EN (js/i18n.js parity) — replaces the
  // hardcoded STR object; re-renders on language switch.
  const { t } = useLang();
  const [fav, setFav] = useState<boolean | null>(null); // null = checking / neutral
  const [toast, setToast] = useState<string | null>(null);
  const [contacting, setContacting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [repReason, setRepReason] = useState<string>('scam');
  const [repDetails, setRepDetails] = useState('');
  const [repPhoto, setRepPhoto] = useState<File | null>(null);
  const [repError, setRepError] = useState<string | null>(null);
  const [repSending, setRepSending] = useState(false);
  // Propose price dialog (js/listing.js onProposePrice).
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmt, setOfferAmt] = useState('');
  const [offerSending, setOfferSending] = useState(false);
  const offerInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);
  const favInFlight = useRef(false);
  const contactInFlight = useRef(false);
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
  const isOwn = !!(user && user.uid === sellerId);

  // Favorite state check — mirrors js/listing.js refreshAuthDependent.
  // The check runs async; guests settle on false (isFavorite returns false
  // while logged out — correct default). The button renders neutral until
  // then (never a false ♡/♥).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (auth.status !== 'signed-in' || !client || !user || user.uid === sellerId) {
        if (!cancelled && mounted.current) setFav(false);
        return;
      }
      try {
        const d = await withTimeout(
          client.db.doc(`favorites/${user.uid}/items/${listingId}`).get(),
          15000
        );
        if (!cancelled && mounted.current) setFav(d.exists);
      } catch {
        // Check failed (e.g. offline): settle on the safe default, not a
        // permanent loading shimmer (js/listing.js parity).
        if (!cancelled && mounted.current) setFav(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, client, user, listingId, sellerId]);

  const guestNudgeThenLogin = useCallback(
    (msg: string) => {
      // QA 16 Sep 2026 #4 (js/app.js saveScrollForReturn parity): keep the
      // scroll position across the /auth round-trip.
      saveScrollForReturn(window.location.pathname);
      showToast(setToast, msg, toastTimer);
      window.setTimeout(() => {
        router.push(authLoginHref(window.location.pathname, window.location.search));
      }, 1500);
    },
    [router]
  );

  const shareUrl = shareUrlFor(listingId);

  const onShare = useCallback(() => {
    const nav = window.navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      // 19 Sep 2026 note in legacy: the app intercept is silent, so the
      // catch swallows the "user cancelled" noise too.
      nav.share({ title: 'DLALA', text: title, url: shareUrl }).catch(() => {});
      return;
    }
    setShareOpen(true);
  }, [title, shareUrl]);

  const onCopyLink = useCallback(async () => {
    try {
      await window.navigator.clipboard.writeText(shareUrl);
      setShareOpen(false);
      // 19 Sep 2026 (legacy): visible in-page confirmation, not alert().
      showToast(setToast, t('linkCopied'), toastTimer);
    } catch {
      // Legacy fallback when the clipboard API is unavailable/blocked.
      window.prompt(t('copyLink'), shareUrl);
    }
  }, [shareUrl, t]);

  // Report ad — js/listing.js onReportAd: guest nudge first (LIS-4), then
  // openReportDialog which itself requires a verified email (requireVerified).
  const onReportClick = useCallback(async () => {
    if (auth.status === 'loading') return;
    if (!user || !client) {
      guestNudgeThenLogin(t('loginToReport'));
      return;
    }
    if (user.uid === sellerId) return; // owner never sees this button
    // Verified-email gate (requireVerified parity — same reload pattern as
    // the contact button: the cached user object stays stale after the user
    // clicks the link in another tab).
    try {
      await user.reload();
    } catch {
      /* offline — use cached */
    }
    if (!user.emailVerified) {
      showToast(setToast, t('verifyToContact'), toastTimer);
      return;
    }
    setRepError(null);
    setReportOpen(true);
  }, [auth.status, user, client, sellerId, guestNudgeThenLogin, t]);

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
        const key = `listings/${user.uid}/report-${listingId}/ev_${Date.now()}.jpg`;
        const up = await withTimeout(uploadToR2(f, key, idToken), 60000);
        photoUrl = up.publicUrl;
      }
      // Legacy userName(currentUser): displayName || email, before the '@'.
      const reporterName = ((user.displayName || user.email || '') as string).split('@')[0];
      // 0.0.0.36 F-15: deterministic report id — one report per reporter
      // per ad. create-only rules reject the duplicate write, so the same
      // reporter can never flood the admin inbox with repeats.
      reportId = `${user.uid}_listing_${listingId}`;
      await withTimeout(
        client.db.doc(`reports/${reportId}`).set({
          reporterId: user.uid,
          reporterName,
          targetType: 'listing',
          targetId: listingId,
          targetTitle: title || '',
          targetUserId: sellerId || '',
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
      showToast(setToast, t('reportSent'), toastTimer);
    } catch (e) {
      console.error(e);
      // The write failed AFTER the evidence photo uploaded — if the
      // existing report (if any) doesn't point at OUR photo, our upload is
      // a pure orphan and is deleted. Any read failure keeps the photo
      // rather than risking one that committed server-side
      // (retry-after-commit).
      if (photoUrl && (e as { code?: string })?.code === 'permission-denied') {
        try {
          const existing = await withTimeout(
            client.db.doc(`reports/${reportId}`).get(),
            8000
          );
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
  }, [user, client, repSending, repPhoto, repReason, repDetails, listingId, sellerId, title, t]);

  const onFavoriteTap = useCallback(async () => {
    if (auth.status === 'loading') return;
    if (!user || !client) {
      guestNudgeThenLogin(t('loginToFavorite'));
      return;
    }
    if (user.uid === sellerId) {
      window.alert(t('ownFavorite'));
      return;
    }
    if (favInFlight.current) return; // same class as M6 fix in toggleFavorite
    favInFlight.current = true;
    // v99 perf (js/listing.js): flip the heart on THIS frame; reconcile
    // with the server after.
    const wasOn = !!fav;
    setFav(!wasOn);
    try {
      const favRef = client.db.doc(`favorites/${user.uid}/items/${listingId}`);
      const trackRef = client.db.doc(`listingFavoriters/${listingId}/users/${user.uid}`);
      const snap = await withTimeout(favRef.get(), 15000);
      const batch = client.db.batch();
      if (snap.exists) {
        batch.delete(favRef);
        // 4 Oct 2026 (v113, legacy parity): also remove from listingFavoriters
        batch.delete(trackRef);
      } else {
        // M-2 (legacy): the client writes ONLY the favorite doc — the
        // listing favoriteCount is maintained server-side by triggers.
        batch.set(favRef, {
          listingId,
          title: { ar: title },
          price: price || 0,
          photoUrl: photoUrl || '',
          // 4 Oct 2026 (v112, legacy parity): sellerId denormalized so the
          // seller can query their favoriters via collectionGroup.
          sellerId: sellerId || '',
          createdAt: client.FieldValue.serverTimestamp(),
        });
        // 4 Oct 2026 (v113, legacy parity): seller discovery without
        // collectionGroup.
        batch.set(trackRef, { createdAt: client.FieldValue.serverTimestamp() });
      }
      await withTimeout(batch.commit(), 15000);
      if (mounted.current) setFav(!snap.exists);
      // js/taste.js tasteNoteFav (via js/app.js toggleFavorite): a
      // successful toggle IS new behavior — the taste stamp refreshes even
      // before the favorites snapshot does.
      try {
        tasteNoteFav(listingId);
      } catch {
        /* never break the favorite toggle */
      }
    } catch (e) {
      console.error(e);
      // BUG-5 fix (legacy): never trust the in-memory state here. Ask the
      // server for the truth; if unreachable, report not-applied so the UI
      // self-corrects instead of lying.
      try {
        const truth = await withTimeout(
          client.db.doc(`favorites/${user.uid}/items/${listingId}`).get(),
          8000
        );
        if (mounted.current) setFav(truth.exists);
      } catch {
        if (mounted.current) setFav(wasOn);
      }
      showToast(setToast, t('errorGeneric'), toastTimer);
    } finally {
      favInFlight.current = false;
    }
  }, [auth.status, user, client, fav, listingId, sellerId, title, price, photoUrl, guestNudgeThenLogin, t]);

  // Shared find-or-create conversation logic (js/listing.js onContact).
  // offerAmt rides into the chat URL as ?offer= (OF-1: bulletproof) and is
  // also stashed in sessionStorage (fallback for older flows). The chat
  // page pre-fills the proposal amount — never auto-sends.
  const openConversation = useCallback(async (offerAmt: number | null) => {
    if (auth.status === 'loading' || contacting) return;
    if (!user || !client) {
      guestNudgeThenLogin(offerAmt !== null ? t('loginToOffer') : t('loginToContact'));
      return;
    }
    if (user.uid === sellerId) return; // cannot message yourself
    if (sold) return;
    if (contactInFlight.current) return; // P2 (16 Sep 2026): double-tap guard
    contactInFlight.current = true;
    setContacting(true);
    try {
      // requireVerified (legacy): reload for a fresh emailVerified — the
      // cached user object stays stale after clicking the link in another tab.
      try {
        await user.reload();
      } catch {
        /* offline — use cached */
      }
      if (!user.emailVerified) {
        showToast(setToast, t('verifyToContact'), toastTimer);
        return;
      }
      // OF-1: carry the entered amount into the chat two ways — the ?offer=
      // URL param and sessionStorage (fallback). Done up-front so a nav
      // race can't lose it.
      const offerQ =
        offerAmt !== null && Number(offerAmt) > 0
          ? `?offer=${encodeURIComponent(String(offerAmt))}`
          : '';
      if (offerAmt !== null && Number(offerAmt) > 0) {
        try {
          window.sessionStorage.setItem(`dlala_offer_${listingId}`, String(offerAmt));
        } catch {
          /* storage unavailable — URL param is the bulletproof path */
        }
      }
      // Find an existing thread: participants query only (rules deny
      // buyerId/listingId queries — T24), then filter client-side.
      const snap = await withTimeout(
        client.db.collection('conversations').where('participants', 'array-contains', user.uid).get(),
        20000
      );
      let found: string | null = null;
      snap.forEach((d) => {
        const dd = d.data();
        if (!found && dd && dd.listingId === listingId) found = d.id;
      });
      if (found) {
        router.push(`/chat/${encodeURIComponent(found)}${offerQ}`);
        return;
      }
      // Create with the exact conversationCreateOk payload (legacy parity).
      const ldoc = await withTimeout(client.db.doc(`listings/${listingId}`).get(), 15000);
      const ldata = ldoc.exists ? ldoc.data() : null;
      if (!ldoc.exists || !ldata || ldata.sellerId !== sellerId) {
        showToast(setToast, t('errorGeneric'), toastTimer);
        return;
      }
      const sts = client.FieldValue.serverTimestamp();
      const ref = client.db.collection('conversations').doc();
      await withTimeout(
        ref.set({
          buyerId: user.uid,
          sellerId,
          participants: [user.uid, sellerId],
          listingId,
          dealConfirmedByBuyer: false,
          dealConfirmPending: false,
          hiddenFor: [],
          phoneRequestBy: '',
          phoneRequestStatus: 'none',
          phoneRequestCount: 0,
          lastMessage: null,
          unread: { [user.uid]: 0, [sellerId]: 0 },
          lastReadAt: { [user.uid]: null, [sellerId]: null },
          createdAt: sts,
          updatedAt: sts,
        }),
        15000
      );
      router.push(`/chat/${encodeURIComponent(ref.id)}${offerQ}`);
    } catch (e) {
      console.error(e);
      showToast(setToast, t('errorGeneric'), toastTimer);
    } finally {
      contactInFlight.current = false;
      if (mounted.current) setContacting(false);
    }
  }, [auth.status, contacting, user, client, sellerId, sold, listingId, router, guestNudgeThenLogin, t]);

  const onContact = useCallback(() => {
    void openConversation(null);
  }, [openConversation]);

  // Propose price — js/listing.js onProposePrice: guest nudge, verified
  // gate, then a dialog (title + label + number input + hint). The action
  // button validates the amount, disables itself with a loading label,
  // closes the dialog, and opens the conversation with the offer attached.
  const onProposeClick = useCallback(async () => {
    if (auth.status === 'loading' || offerSending) return;
    if (!user || !client) {
      guestNudgeThenLogin(t('loginToOffer'));
      return;
    }
    if (user.uid === sellerId || sold) return;
    // requireVerified (legacy parity — same reload pattern as contact).
    try {
      await user.reload();
    } catch {
      /* offline — use cached */
    }
    if (!user.emailVerified) {
      showToast(setToast, t('verifyToContact'), toastTimer);
      return;
    }
    setOfferAmt('');
    setOfferOpen(true);
  }, [auth.status, offerSending, user, client, sellerId, sold, guestNudgeThenLogin, t]);

  const onOfferGo = useCallback(() => {
    const amt = Number(offerAmt);
    if (!(amt > 0)) {
      showToast(setToast, t('offerInvalid'), toastTimer);
      offerInputRef.current?.focus();
      return;
    }
    // OF-1: prevent double-taps while the conversation lookup runs.
    setOfferSending(true);
    setOfferOpen(false);
    void openConversation(amt).finally(() => {
      if (mounted.current) setOfferSending(false);
    });
  }, [offerAmt, openConversation, t]);

  // Owner actions — js/listing.js: editBtn → publish.html?edit=<id>;
  // deleteOwnListing: confirm → deletedAds audit + listing delete in one
  // batch (atomic) → Storage/R2 photo cleanup best-effort → back to home.
  const onEdit = useCallback(() => {
    router.push('/publish?edit=' + encodeURIComponent(listingId));
  }, [router, listingId]);

  const onDelete = useCallback(async () => {
    if (auth.status === 'loading' || deleting) return;
    if (!user || !client || user.uid !== sellerId) return;
    if (!window.confirm(t('deleteConfirm'))) return;
    setDeleting(true);
    try {
      const listingRef = client.db.doc(`listings/${listingId}`);
      const d = await withTimeout(listingRef.get(), 15000);
      if (!d.exists) {
        router.push('/');
        return;
      }
      const l = d.data() as Record<string, unknown>;
      if (l.sellerId !== user.uid) {
        window.alert(t('errorGeneric'));
        return;
      }
      const batch = client.db.batch();
      const lt = l.title as { ar?: string } | string | undefined;
      batch.set(client.db.collection('deletedAds').doc(), {
        sellerId: user.uid,
        listingId,
        title:
          typeof lt === 'object' ? lt?.ar || '' : typeof lt === 'string' ? lt : '',
        sellerName: user.displayName || '',
        deletedAt: client.FieldValue.serverTimestamp(),
        reason: 'owner',
        adminId: '',
      });
      batch.delete(listingRef);
      // 0.0.0.36 C-R52-1 (legacy parity): a deleted listing must not linger
      // as a stale Vitrine pick.
      batch.update(client.db.doc(`users/${user.uid}`), {
        vitrineIds: client.FieldValue.arrayRemove(listingId),
      });
      await withTimeout(batch.commit(), 20000);
      // Photo cleanup (best-effort, my-listings parity): legacy Firebase
      // Storage URLs first, then R2 (the server skips non-R2 values and
      // enforces uid ownership).
      const urls: string[] = [
        ...(Array.isArray(l.photoUrls) ? l.photoUrls : []),
        ...(Array.isArray(l.thumbUrls) ? l.thumbUrls : []),
        ...(Array.isArray(l.photo_thumbs) ? l.photo_thumbs : []),
      ].filter((u): u is string => typeof u === 'string' && !!u);
      try {
        const fb = await getFirebase();
        const storage = fb.storage() as unknown as {
          ref: (p: string) => { delete: () => Promise<void> };
        };
        await Promise.all(
          urls.map(async (u) => {
            try {
              await storage.ref(u).delete();
            } catch {
              // ignore missing objects
            }
          })
        );
      } catch {
        // non-fatal
      }
      try {
        const idToken = await user.getIdToken();
        await deleteR2Objects(urls, idToken);
      } catch {
        // non-fatal
      }
      router.push('/');
    } catch (e) {
      console.error(e);
      window.alert(t('errorGeneric'));
    } finally {
      if (mounted.current) setDeleting(false);
    }
  }, [auth.status, deleting, user, client, sellerId, listingId, router, t]);

  // Owner viewing their own listing: hide buyer actions (favorite/contact/
  // offer/report make no sense on your own ad) but KEEP share — js/listing.js
  // parity (owner actions are Edit, Delete, Share).
  const showBuyerActions = !(auth.status === 'signed-in' && isOwn);

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {showBuyerActions && (
        <button
          type="button"
          onClick={onFavoriteTap}
          aria-pressed={fav === true}
          aria-busy={fav === null}
          className={
            'rounded-lg px-5 py-2.5 font-bold border transition ' +
            (fav === true
              ? 'bg-red-50 border-red-300 text-red-600'
              : 'bg-white border-zinc-300 text-zinc-700 hover:border-red-300')
          }
        >
          {fav === true ? '♥' : '♡'} {t('favorites')}
        </button>
      )}
      {showBuyerActions && (
        <button
          type="button"
          onClick={onContact}
          disabled={sold || contacting}
          title={sold ? t('soldNotice') : undefined}
          className={
            'rounded-lg px-5 py-2.5 font-bold text-white transition ' +
            (sold || contacting
              ? 'bg-emerald-700 opacity-50 cursor-not-allowed'
              : 'bg-emerald-700 hover:bg-emerald-800')
          }
        >
          {contacting ? t('contacting') : t('contactSeller')}
        </button>
      )}
      {showBuyerActions && (
        <button
          type="button"
          onClick={onProposeClick}
          disabled={sold || offerSending}
          title={sold ? t('soldNotice') : undefined}
          className={
            'rounded-lg px-5 py-2.5 font-bold border bg-white transition ' +
            (sold || offerSending
              ? 'border-zinc-300 text-zinc-400 opacity-50 cursor-not-allowed'
              : 'border-amber-400 text-amber-700 hover:border-amber-500')
          }
        >
          {offerSending ? t('loading') : `💰 ${t('proposePrice')}`}
        </button>
      )}
      <button
        type="button"
        onClick={onShare}
        className="rounded-lg px-5 py-2.5 font-bold border bg-white border-zinc-300 text-zinc-700 hover:border-emerald-500"
      >
        ↗ {t('shareAd')}
      </button>
      {showBuyerActions && (
        <button
          type="button"
          onClick={onReportClick}
          className="rounded-lg px-5 py-2.5 font-bold border bg-white border-zinc-300 text-zinc-700 hover:border-red-300"
        >
          ⚑ {t('reportAd')}
        </button>
      )}
      {/* Owner actions — js/listing.js parity: Edit + Delete (Share stays
          visible for everyone). Buyer actions are hidden above. */}
      {auth.status === 'signed-in' && isOwn && (
        <>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg px-5 py-2.5 font-bold border bg-white border-zinc-300 text-zinc-700 hover:border-emerald-500"
          >
            ✏️ {t('edit')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="rounded-lg px-5 py-2.5 font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? t('deleting') : `🗑 ${t('delete')}`}
          </button>
        </>
      )}
      {shareOpen && (
        <Modal title={t('shareAd')} onClose={() => setShareOpen(false)}>
          <div className="flex flex-wrap gap-2">
            <a
              className="rounded-lg bg-emerald-700 text-white font-bold px-4 py-2"
              href={`https://wa.me/?text=${encodeURIComponent(title + ' — DLALA')}%20${encodeURIComponent(shareUrl)}`}
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
      {reportOpen && (
        <Modal title={t('reportAd')} onClose={() => !repSending && setReportOpen(false)}>
          <label className="block text-sm font-medium">{t('reportReason')}</label>
          <select
            value={repReason}
            onChange={(e) => setRepReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 bg-white"
          >
            {REASON_IDS.map((v) => (
              <option key={v} value={v}>
                {reasonLabel(v, t)}
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
      {offerOpen && (
        <Modal title={t('proposePrice')} onClose={() => !offerSending && setOfferOpen(false)}>
          <label className="block text-sm font-medium">{t('yourOffer')}</label>
          <input
            ref={offerInputRef}
            type="number"
            min={1}
            dir="ltr"
            value={offerAmt}
            onChange={(e) => setOfferAmt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOfferGo();
            }}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-left"
            inputMode="numeric"
          />
          <p className="mt-2 text-[13px] text-zinc-500">{t('offerHint')}</p>
          <button
            type="button"
            onClick={onOfferGo}
            disabled={offerSending}
            className="mt-4 w-full rounded-lg bg-emerald-700 text-white font-bold px-5 py-2.5 disabled:opacity-50"
          >
            {offerSending ? t('loading') : t('openChatFirst')}
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
