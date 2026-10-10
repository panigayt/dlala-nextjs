'use client';

// Listing detail interactive actions — mirrors js/listing.js:
// - Favorite button (♡/♥ toggle, guest nudge → /auth, optimistic flip with
//   server reconciliation, per-listing in-flight guard, listingFavoriters doc
//   parity with js/app.js toggleFavorite).
// - Contact seller button (guest nudge → /auth, verified-email gate,
//   double-tap guard, find-or-create conversation → /chat/[id]).
// Legacy behavior notes:
// - LIS-4: guests tapping favorite/contact get a toast explaining why, then
//   login — never a silent bounce to /auth.
// - The favorite button renders neutral until the isFavorite check resolves
//   (never a false ♡/♥); guests default to ♡.
// - Owner viewing their own listing: favorite + contact are HIDDEN entirely.
// - Sold listing: contact is disabled; favorite still works.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState } from '@/lib/firebase-client';
import { withTimeout } from '@/lib/firebase-compat';

// Verbatim strings from js/i18n.ar.js
const STR = {
  favorites: 'المفضلة',
  loginToFavorite: 'سجّل الدخول لإضافة الإعلان إلى المفضلة',
  loginToContact: 'سجّل الدخول لمراسلة البائع',
  ownFavorite: 'لا يمكنك إضافة إعلانك إلى المفضلة',
  verifyToContact: 'أرسلنا لك رابط التفعيل. فعّل بريدك لتتمكن من النشر ومراسلة البائعين.',
  contactSeller: 'مراسلة البائع',
  contacting: 'جارٍ فتح المحادثة...',
  soldNotice: 'الإعلان مُباع',
  errorGeneric: 'حدث خطأ — حاول مجدداً',
};

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
  const [fav, setFav] = useState<boolean | null>(null); // null = checking / neutral
  const [toast, setToast] = useState<string | null>(null);
  const [contacting, setContacting] = useState(false);
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
      showToast(setToast, msg, toastTimer);
      window.setTimeout(() => {
        router.push('/auth');
      }, 1500);
    },
    [router]
  );

  const onFavoriteTap = useCallback(async () => {
    if (auth.status === 'loading') return;
    if (!user || !client) {
      guestNudgeThenLogin(STR.loginToFavorite);
      return;
    }
    if (user.uid === sellerId) {
      window.alert(STR.ownFavorite);
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
      showToast(setToast, STR.errorGeneric, toastTimer);
    } finally {
      favInFlight.current = false;
    }
  }, [auth.status, user, client, fav, listingId, sellerId, title, price, photoUrl, guestNudgeThenLogin]);

  const onContact = useCallback(async () => {
    if (auth.status === 'loading' || contacting) return;
    if (!user || !client) {
      guestNudgeThenLogin(STR.loginToContact);
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
        showToast(setToast, STR.verifyToContact, toastTimer);
        return;
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
        router.push(`/chat/${encodeURIComponent(found)}`);
        return;
      }
      // Create with the exact conversationCreateOk payload (legacy parity).
      const ldoc = await withTimeout(client.db.doc(`listings/${listingId}`).get(), 15000);
      const ldata = ldoc.exists ? ldoc.data() : null;
      if (!ldoc.exists || !ldata || ldata.sellerId !== sellerId) {
        showToast(setToast, STR.errorGeneric, toastTimer);
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
      router.push(`/chat/${encodeURIComponent(ref.id)}`);
    } catch (e) {
      console.error(e);
      showToast(setToast, STR.errorGeneric, toastTimer);
    } finally {
      contactInFlight.current = false;
      if (mounted.current) setContacting(false);
    }
  }, [auth.status, contacting, user, client, sellerId, sold, listingId, router, guestNudgeThenLogin]);

  // Owner viewing their own listing: hide all buyer actions
  // (favorite/contact make no sense on your own ad — js/listing.js parity).
  if (auth.status === 'signed-in' && isOwn) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-3">
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
        {fav === true ? '♥' : '♡'} {STR.favorites}
      </button>
      <button
        type="button"
        onClick={onContact}
        disabled={sold || contacting}
        title={sold ? STR.soldNotice : undefined}
        className={
          'rounded-lg px-5 py-2.5 font-bold text-white transition ' +
          (sold || contacting
            ? 'bg-emerald-700 opacity-50 cursor-not-allowed'
            : 'bg-emerald-700 hover:bg-emerald-800')
        }
      >
        {contacting ? STR.contacting : STR.contactSeller}
      </button>
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
