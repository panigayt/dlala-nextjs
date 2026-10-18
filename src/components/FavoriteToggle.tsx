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
//   never a silent bounce. R3 (Zak ordered, js/app.js:843 parity): the
//   pending favorite is stashed in sessionStorage so it auto-applies after
//   the login round-trip; the button carries data-fid so the applier can
//   find and click it.
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
import { useAuthState } from '@/lib/firebase';
// (11 Oct 2026: withTimeout moved to @/lib/timeout — no firebase-compat needed.)
import { withTimeout } from '@/lib/timeout';
import { tasteNoteFav } from '@/lib/taste';
import { authLoginHref } from '@/lib/auth-return';
import { saveScrollForReturn } from '@/lib/scroll-restore';
import { savePendingAction } from '@/lib/pending-action';

import { useLang } from '@/lib/i18n';

interface Props {
  listingId: string;
  sellerId: string;
  /** Server-rendered favorite count from the listing doc. */
  initialCount: number;
  /** Localized (ar) title — denormalized into the favorite doc. */
  title: string;
  price: number;
  photoUrl: string;
  /**
   * Compact glyph-only overlay (vitrine minis, js/home.js .fav-heart.vitrine-fav
   * parity): no count pill, 30px white disc positioned by the parent.
   * The parent must be `relative`; this renders an absolute overlay.
   */
  compact?: boolean;
}

export default function FavoriteToggle({ listingId, sellerId, initialCount, title, price, photoUrl, compact }: Props) {
  const router = useRouter();
  const auth = useAuthState();
  // Round 107: toast/aria strings follow the UI language (trilingual parity).
  const { t } = useLang();
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
        const { db, fsMod } = client;
        const d = await withTimeout(
          fsMod.getDoc(fsMod.doc(db, `favorites/${user.uid}/items/${listingId}`)),
          15000
        );
        if (!cancelled && mounted.current) setFav(d.exists());
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
      // QA 16 Sep 2026 #4 (js/app.js saveScrollForReturn parity): keep the
      // feed scroll position across the /auth round-trip.
      saveScrollForReturn(window.location.pathname);
      // R3 (Zak ordered, js/app.js:843 parity): stash the pending favorite so
      // it auto-applies after the login round-trip.
      savePendingAction({ type: 'favorite', listingId });
      setToast(msg);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => {
        if (mounted.current) setToast(null);
        router.push(authLoginHref(window.location.pathname, window.location.search));
      }, 1500);
    },
    [router, listingId]
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
        showToastThenAuth(t('loginToFavorite'));
        return;
      }
      if (user.uid === sellerId) return; // own — not rendered anyway
      if (inFlight.current) return; // double-tap race guard (M6 class)
      inFlight.current = true;
      const { db, fsMod } = client;
      // Zak 21 Sep tap-feedback fix: flip the heart AND the count on THIS
      // frame; reconcile with the real toggle result afterwards.
      const wasOn = !!fav;
      const optimisticOn = !wasOn;
      setFav(optimisticOn);
      setDelta((d) => d + (optimisticOn ? 1 : -1));
      try {
        const favRef = fsMod.doc(db, `favorites/${user.uid}/items/${listingId}`);
        const trackRef = fsMod.doc(db, `listingFavoriters/${listingId}/users/${user.uid}`);
        const snap = await withTimeout(fsMod.getDoc(favRef), 15000);
        const batch = fsMod.writeBatch(db);
        if (snap.exists()) {
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
            createdAt: fsMod.serverTimestamp(),
          });
          // 4 Oct 2026 (v113, legacy parity): seller discovery without
          // collectionGroup.
          batch.set(trackRef, {
            createdAt: fsMod.serverTimestamp(),
          });
        }
        await withTimeout(batch.commit(), 15000);
        const added = !snap.exists();
        if (mounted.current) {
          if (added !== optimisticOn) {
            // Server disagrees with the guess — correct the count too.
            setFav(added);
            setDelta((d) => d + (added ? 1 : -1));
          } else {
            setFav(added);
          }
        }
        // 11 Oct 2026: only on ADD — recording on remove pollutes taste.
        // (favorites/page.tsx already fixed; this aligns the toggle paths.)
        if (added) {
          try {
            tasteNoteFav(listingId);
          } catch {
            /* never break the favorite toggle */
          }
        }
      } catch (err) {
        console.error(err);
        // BUG-5 class (legacy): never trust the in-memory state here. Ask
        // the server for the truth so the UI self-corrects instead of
        // lying; the count falls back to the server-rendered base.
        try {
          const truth = await withTimeout(
            fsMod.getDoc(fsMod.doc(db, `favorites/${user.uid}/items/${listingId}`)),
            8000
          );
          if (mounted.current) {
            setFav(truth.exists());
            setDelta(0);
          }
        } catch {
          if (mounted.current) {
            setFav(wasOn);
            setDelta(0);
          }
        }
        showToast(t('errorGeneric'));
      } finally {
        inFlight.current = false;
      }
    },
    [auth.status, user, client, fav, listingId, sellerId, title, price, photoUrl, showToastThenAuth, showToast, t]
  );

  // Own listings get no heart at all (legacy listingCard !isMine /
  // stripOwnHearts parity — the check runs after auth resolves).
  if (isOwn) return null;

  const count = Math.max(0, initialCount + delta);

  // Compact overlay for vitrine minis (js/home.js .fav-heart.vitrine-fav
  // parity): glyph-only 30px white disc, no count pill. The parent thumbnail
  // is `relative`; this anchors to its inline-start/top corner.
  if (compact) {
    return (
      <span className="absolute start-1.5 top-1.5 z-10">
        <button
          type="button"
          onClick={onTap}
          data-fid={listingId}
          aria-pressed={fav === true}
          aria-busy={fav === null}
          aria-label={t('favorites')}
          className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-white/90 text-[15px] leading-none shadow-sm"
          // Round 6 (18 Oct 2026): 44px touch target (was 30px).
          style={{ color: fav === true ? '#e0245e' : '#666' }}
        >
          <span aria-hidden="true">{fav === true ? '♥' : '♡'}</span>
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

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onTap}
        data-fid={listingId}
        aria-pressed={fav === true}
        aria-busy={fav === null}
        aria-label={t('favorites')}
        // Round 137 (0.0.0.39 .fav-inline parity): white pill, heart left
        // of count (direction ltr), 44px min touch target.
        className="inline-flex min-h-[44px] min-w-[44px] flex-none cursor-pointer items-center gap-1.5 rounded-full border border-[#e6e6e6] bg-white px-3.5 text-sm font-bold text-[#555] shadow-[0_1px_3px_rgba(0,0,0,.14)]"
        dir="ltr"
        style={{ color: fav === true ? '#e0245e' : undefined }}
      >
        <span aria-hidden="true" className="text-[20px] leading-none" style={{ color: fav === true ? '#e0245e' : '#6a6a6a' }}>
          {fav === true ? '♥' : '♡'}
        </span>
        <span className="tabular-nums">{count}</span>
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
