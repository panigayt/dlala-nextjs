'use client';

// Follow/unfollow button — mirrors
// js/app.js (onFollowBtnTap / toggleFollow / paintFollowBtn) and the
// seller.html follow-btn behavior.
// Used by the public seller page AND the listing-page seller card
// (js/listing.js: the listing seller card carries a follow button).
//
// - Non-owner profiles get a Follow button; guests get the login nudge
//   (toast, then /auth) — never a silent bounce.
// - The button hides entirely for the owner (can't follow yourself).
// - Optimistic toggle with server reconciliation on failure (never lies).
// - Per-store in-flight guard (double-tap race, FIX-WEB-043 class).
// - Follow doc id: follows/{followerUid}_{storeUid} (followDocId parity).
// - On follow: best-effort in-app notification in the followed user's
//   inbox (R84 H-2: AFTER the batch commits; never inside it). The
//   notification is intentionally NOT deleted on unfollow (FIX-WEB-005).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState } from '@/lib/firebase';
// 11 Oct 2026: withTimeout now in @/lib/timeout — no firebase-compat import.
import { withTimeout } from '@/lib/timeout';
import { authLoginHref } from '@/lib/auth-return';
import { saveScrollForReturn } from '@/lib/scroll-restore';
import { useLang } from '@/lib/i18n';
// Round 29 D3 (18 Oct 2026): keep the 'dlala_followed_v1' first-paint
// cache in sync on follow/unfollow — the homepage boost otherwise stays
// stale until the auth-settled refresh self-heals.
import { bumpFollowedCache } from '@/lib/followBoost';

// Shared follow toggle logic — mirrors js/app.js (onFollowBtnTap /
// toggleFollow / paintFollowBtn) and the seller.html follow-btn behavior.
// Extracted from FollowButton (Round 104) so the vitrine showcase header
// button (button.follow-btn[data-follow], js/app.js armFollowButtons v101)
// reuses the exact same behavior:
// - Non-owner profiles get a Follow button; guests get the login nudge
//   (toast, then /auth) — never a silent bounce.
// - The button hides entirely for the owner (can't follow yourself).
// - Optimistic toggle with server reconciliation on failure (never lies).
// - Per-store in-flight guard (double-tap race, FIX-WEB-043 class).
// - Follow doc id: follows/{followerUid}_{storeUid} (followDocId parity).
// - On follow: best-effort in-app notification in the followed user's
//   inbox (R84 H-2: AFTER the batch commits; never inside it). The
//   notification is intentionally NOT deleted on unfollow (FIX-WEB-005).
export function useFollowToggle(storeUid: string) {
  const router = useRouter();
  const auth = useAuthState();
  // Round 107: toast/button strings follow the UI language (trilingual parity).
  const { t } = useLang();
  // null = checking (never a false +/✓)
  const [following, setFollowing] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const signedIn = auth.status === 'signed-in';
  const user = signedIn ? auth.user : null;
  const client = signedIn ? auth.client : null;
  const isOwn = !!(user && user.uid === storeUid);

  // Initial follow-state check — mirrors js/listing.js refreshAuthDependent:
  // async, settles on false while logged out (correct default).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (auth.status !== 'signed-in' || !client || !user || user.uid === storeUid) {
        if (!cancelled && mounted.current) setFollowing(false);
        return;
      }
      try {
        const { db, fsMod } = client;
        const d = await withTimeout(
          fsMod.getDoc(fsMod.doc(db, `follows/${user.uid}_${storeUid}`)),
          15000
        );
        if (!cancelled && mounted.current) setFollowing(d.exists());
      } catch {
        if (!cancelled && mounted.current) setFollowing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, client, user, storeUid]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      if (mounted.current) setToast(null);
    }, 2600);
  }, []);

  const onTap = useCallback(async () => {
    if (auth.status === 'loading') return;
    if (!user || !client) {
      // Legacy parity (js/app.js onFollowBtnTap): guests get the login
      // nudge via toast, then login — never a silent bounce to /auth.
      // QA 16 Sep 2026 #4: keep the scroll position across the bounce.
      saveScrollForReturn(window.location.pathname);
      showToast(t('loginToFollow'));
      window.setTimeout(
        () => router.push(authLoginHref(window.location.pathname, window.location.search)),
        1500
      );
      return;
    }
    if (user.uid === storeUid) return;
    if (inFlight.current) return; // double-tap race guard
    inFlight.current = true;
    const { db, fsMod } = client;
    const wasOn = !!following;
    setFollowing(!wasOn); // optimistic flip (v101 pattern)
    try {
      const ref = fsMod.doc(db, `follows/${user.uid}_${storeUid}`);
      const snap = await withTimeout(fsMod.getDoc(ref), 15000);
      const batch = fsMod.writeBatch(db);
      const isFollow = !snap.exists();
      if (!isFollow) {
        batch.delete(ref);
        // FIX-WEB-005 (js/app.js): the follow notification in the followed
        // user's inbox is intentionally NOT deleted here — rules allow
        // notification delete only by the inbox owner.
      } else {
        // v116 (5 Oct 2026): the follow doc is the ONLY write. The
        // onFollowWrite Cloud Function maintains followerCount server-side.
        batch.set(ref, {
          followerId: user.uid,
          storeId: storeUid,
          createdAt: fsMod.serverTimestamp(),
        });
      }
      await withTimeout(batch.commit(), 15000);
      // Round 29 D3 (18 Oct 2026): update the first-paint followed cache
      // immediately — the homepage boost must not stay stale until the
      // next auth-settled refresh.
      bumpFollowedCache(storeUid, isFollow);
      if (isFollow) {
        // R84 H-2 (js/app.js): the follow notification is written in a
        // SEPARATE best-effort write AFTER the follow batch commits.
        try {
          // 11 Oct 2026: unique ID per follow — deterministic ID failed on re-follow
          // (doc exists → update denied by rules).
          const followerName = user.displayName || '';
          const notifId = `follow_${user.uid}_${Date.now()}`;
          await withTimeout(
            fsMod.setDoc(
              fsMod.doc(db, `users/${storeUid}/notifications/${notifId}`),
              {
                type: 'follow',
                // Legacy js/app.js parity (v101 follow-notif): the stored title
                // is written in the FOLLOWER's (writer's) UI language via the
                // followedYou template — was hardcoded Arabic (Round 131 fix).
                title: t('followedYou').replace('{name}', followerName),
                body: '',
                createdAt: fsMod.serverTimestamp(),
                read: false,
                fromUid: user.uid,
                data: {
                  followerUid: user.uid,
                  followerName,
                  followedUid: storeUid,
                },
              }
            ),
            15000
          );
        } catch {
          /* notification is best-effort; the follow already committed */
        }
      }
      if (mounted.current) setFollowing(isFollow);
    } catch (e) {
      console.error(e);
      // BUG-5 class (js/listing.js): never trust the in-memory state here.
      // Ask the server for the truth so the UI self-corrects.
      try {
        const truth = await withTimeout(
          fsMod.getDoc(fsMod.doc(db, `follows/${user.uid}_${storeUid}`)),
          8000
        );
        const exists = truth.exists();
        if (mounted.current) setFollowing(exists);
        // Round 29 D3: reconcile the first-paint cache with server truth.
        bumpFollowedCache(storeUid, exists);
      } catch {
        if (mounted.current) setFollowing(wasOn);
        // Round 29 D3: the toggle failed — the pre-toggle state stands.
        bumpFollowedCache(storeUid, wasOn);
      }
      showToast(t('errorGeneric'));
    } finally {
      inFlight.current = false;
    }
  }, [auth.status, user, client, following, storeUid, router, showToast, t]);

  return { following, isOwn, toast, onTap };
}

export default function FollowButton({
  storeUid,
  className,
}: {
  storeUid: string;
  // Optional full button class override (e.g. the boutique hero's
  // .bh-follow-btn, 0.0.0.39 parity). The `on` suffix is appended when
  // following. Default keeps the standard rounded-xl emerald button.
  className?: string;
}) {
  const { following, isOwn, toast, onTap } = useFollowToggle(storeUid);
  const { t } = useLang();

  if (isOwn) return null;

  const btnClass = className
    ? `${className}${following ? ' on' : ''}`
    : `w-full rounded-xl px-6 py-3 font-bold transition-colors ${
        following
          ? 'bg-white border border-zinc-300 text-zinc-700 hover:bg-zinc-50'
          : 'bg-emerald-700 text-white hover:bg-emerald-800'
      }`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onTap}
        aria-pressed={following ? 'true' : 'false'}
        className={btnClass}
      >
        {following ? `✓ ${t('following')}` : `+ ${t('follow')}`}
      </button>
      {toast && (
        <div
          role="status"
          // 20 Oct 2026: same guest-toast fix as FavoriteToggle — fixed,
          // viewport-capped, wrapping (the nowrap absolute toast overflowed
          // phone screens in FR/EN).
          className="fixed bottom-4 left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm leading-snug text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
