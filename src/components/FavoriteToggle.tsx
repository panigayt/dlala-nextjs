'use client';

// Interactive favorite heart for feed listing cards — mirrors js/app.js
// toggleFavorite + the HOM-5 delegated .fav-inline click handler
// (21 Sep 2026 option B: inline heart + count in a white pill next to the
// price, photo stays clean).
//
// - Renders the ♡/♥ glyph + count pill (Zak 21 Sep option B white-pill
//   model, approved the same day).
// - The pill sits inside the card <a>, so the tap must not navigate —
//   preventDefault + stopPropagation (delegated in legacy, per-button here).
// - Own listings render NOTHING (legacy listingCard: `!isMine` —
//   stripOwnHearts parity); the parent skips sold listings
//   (`l.status !== 'sold'`).
// - Guests get the login nudge (LIS-4: toast explaining why, then /auth) —
//   never a silent bounce.
// - The heart renders neutral (♡) until the favorite check resolves —
//   never a false ♥ (js/listing.js refreshAuthDependent parity).
// - Zak 21 Sep tap-feedback fix: the glyph AND the count move on the tap
//   frame (optimistic ±1); the server result reconciles afterwards.
// - Per-listing in-flight guard (double-tap race, M6 class); on failure
//   the server's authoritative state wins (BUG-5 class — never lies).
// - M-2 (19 Sep 2026): the client writes ONLY the favorite doc +
//   listingFavoriters tracking doc. The listing favoriteCount is
//   maintained server-side by triggers — never written by the client.
// - A successful toggle is taste behavior: tasteNoteFav fires even before
//   the favorites snapshot refreshes (js/app.js toggleFavorite parity).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState } from '@/lib/firebase-client';
import { withTimeout } from '@/lib/firebase-compat';
import { tasteNoteFav } from '@/lib/taste';

// Verbatim strings from js/i18n.ar.js
const STR = {
  favorites: 'المفضلة',
  loginToFavorite: 'سجّل الدخول لإضافة الإعلان إلى المفضلة',
  errorGeneric: 'حدث خطأ — حاول مجدداً',
};

interface DocRefLike {
  get: () => Promise<{ exists: boolean }>;
}

interface BatchLike {
  set: (ref: unknown, data: Record<string, unknown>) => void;
  delete: (ref: unknown) => void;
  commit: () => Promise<void>;
}

interface FieldValueLike {
  serverTimestamp: () => unknown;
}

interface Props {
  listingId: string;
  sellerId: string;
  /** Server-rendered favorite count from the listing doc. */
  initialCount: number;
  /** Localized (ar) title — denormalized into the favorite doc. */
  title: string;
  price: number;
  photoUrl: string;
}

export default function FavoriteToggle({ listingId, sellerId, initialCount, title, price, photoUrl }: Props) {
  const router = useRouter();
  const auth = useAuthState();
  // null = checking (never a false ♡/♥)
  const [fav, setFav] = useState<boolean | null>(null);
  // Net count adjustment relative to initialCount (legacy paintHeart
  // countDelta parity: ±1 per tap, reconciled with the server result).
  const [delta, setDelta] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const toastTimer = useRef<number | null>(null);

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

  // Initial favorite-state check — mirrors js/listing.js
  // refreshAuthDependent: async, settles on false while logged out (the
  // correct default). The heart stays neutral until then.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (auth.status !== 'signed-in' || !client || !user || user.uid === sellerId) {
        if (!cancelled && mounted.current) setFav(false);
        return;
      }
      try {
        const d = await withTimeout(
          (client.db.doc(`favorites/${user.uid}/items/${listingId}`) as unknown as DocRefLike).get(),
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

  const showToastThenAuth = useCallback(
    (msg: string) => {
      setToast(msg);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => {
        if (mounted.current) setToast(null);
        router.push('/auth');
      }, 1500);
    },
    [router]
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      if (mounted.current) setToast(null);
    }, 2600);
  }, []);

  const onTap = useCallback(
    async (e: React.MouseEvent) => {
      // The pill sits inside the card <a> — the tap must not navigate
      // (HOM-5 parity: preventDefault + stopPropagation).
      e.preventDefault();
      e.stopPropagation();
      if (auth.status === 'loading') return;
      if (!user || !client) {
        // LIS-4 parity: guests get the login nudge via toast, then login —
        // never a silent bounce to /auth.
        showToastThenAuth(STR.loginToFavorite);
        return;
      }
      if (user.uid === sellerId) return; // own — not rendered anyway
      if (inFlight.current) return; // double-tap race guard (M6 class)
      inFlight.current = true;
      // Zak 21 Sep tap-feedback fix: flip the heart AND the count on THIS
      // frame; reconcile with the real toggle result afterwards.
      const wasOn = !!fav;
      const optimisticOn = !wasOn;
      setFav(optimisticOn);
      setDelta((d) => d + (optimisticOn ? 1 : -1));
      try {
        const favRef = client.db.doc(`favorites/${user.uid}/items/${listingId}`);
        const trackRef = client.db.doc(`listingFavoriters/${listingId}/users/${user.uid}`);
        const snap = await withTimeout((favRef as unknown as DocRefLike).get(), 15000);
        const batch = client.db.batch() as unknown as BatchLike;
        if (snap.exists) {
          batch.delete(favRef);
          // 4 Oct 2026 (v113, legacy parity): also remove from
          // listingFavoriters.
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
            createdAt: (client.FieldValue as unknown as FieldValueLike).serverTimestamp(),
          });
          // 4 Oct 2026 (v113, legacy parity): seller discovery without
          // collectionGroup.
          batch.set(trackRef, {
            createdAt: (client.FieldValue as unknown as FieldValueLike).serverTimestamp(),
          });
        }
        await withTimeout(batch.commit(), 15000);
        const added = !snap.exists;
        if (mounted.current) {
          if (added !== optimisticOn) {
            // Server disagrees with the guess — correct the count too.
            setFav(added);
            setDelta((d) => d + (added ? 1 : -1));
          } else {
            setFav(added);
          }
        }
        // js/app.js toggleFavorite parity: a successful toggle IS new
        // behavior — the taste stamp refreshes even before the favorites
        // snapshot does. Never breaks the toggle.
        try {
          tasteNoteFav(listingId);
        } catch {
          /* never break the favorite toggle */
        }
      } catch (err) {
        console.error(err);
        // BUG-5 class (legacy): never trust the in-memory state here. Ask
        // the server for the truth so the UI self-corrects instead of
        // lying; the count falls back to the server-rendered base.
        try {
          const truth = await withTimeout(
            (client.db.doc(`favorites/${user.uid}/items/${listingId}`) as unknown as DocRefLike).get(),
            8000
          );
          if (mounted.current) {
            setFav(truth.exists);
            setDelta(0);
          }
        } catch {
          if (mounted.current) {
            setFav(wasOn);
            setDelta(0);
          }
        }
        showToast(STR.errorGeneric);
      } finally {
        inFlight.current = false;
      }
    },
    [auth.status, user, client, fav, listingId, sellerId, title, price, photoUrl, showToastThenAuth, showToast]
  );

  // Own listings get no heart at all (legacy listingCard !isMine /
  // stripOwnHearts parity — the check runs after auth resolves).
  if (isOwn) return null;

  const count = Math.max(0, initialCount + delta);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onTap}
        aria-pressed={fav === true}
        aria-busy={fav === null}
        aria-label={STR.favorites}
        className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-600 shadow-sm"
      >
        <span aria-hidden="true">{fav === true ? '♥' : '♡'}</span>
        <span>{count}</span>
      </button>
      {toast && (
        <span
          role="status"
          className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </span>
      )}
    </span>
  );
}
