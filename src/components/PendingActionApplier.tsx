'use client';

// R3 pending-action applier (Zak ordered) — mirrors the onAuthStateChanged
// hook at js/app.js:132: when a signed-in user is observed, wait 1s (feed
// paint headroom) then run applyPendingAction(). Mounted once in the root
// layout, so it covers every page — like the legacy global handler.

import { useEffect, useRef } from 'react';
// Round 12: firebase-client user → CDN path. The new useAuthState() loads
// the modular SDK from gstatic lazily inside its effect (0 bundle bytes).
import { useAuthState } from '@/lib/firebase';
import { applyPendingAction } from '@/lib/pending-action';

export default function PendingActionApplier() {
  const auth = useAuthState();
  const lastUid = useRef<string | null>(null);
  const uid = auth.status === 'signed-in' ? auth.user.uid : null;
  const signedInRef = useRef(false);

  // Live signed-in flag — applyPendingAction re-checks it on every retry,
  // like legacy re-reading `currentUser`.
  useEffect(() => {
    signedInRef.current = uid !== null;
  }, [uid]);

  useEffect(() => {
    if (uid === null) return;
    // Fire once per sign-in (a fresh auth callback re-arms it, like legacy).
    if (lastUid.current === uid) return;
    lastUid.current = uid;
    const timer = window.setTimeout(() => {
      try {
        applyPendingAction(() => signedInRef.current);
      } catch {
        /* best-effort */
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [uid]);

  return null;
}
