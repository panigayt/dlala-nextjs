// R3 (Zak ordered): pending action saved before a login redirect, applied
// after the user signs in. Port of js/app.js guestNudgeThenLogin +
// applyPendingAction (0.0.0.31).
//
// Flow: a guest taps the feed-card heart → guestNudgeThenLogin('loginToFavorite',
// {type:'favorite', listingId}) shows the LIS-4 toast, stashes this action in
// sessionStorage, and sends the guest to /auth?return=<back here>. After the
// login, the applier component (mounted in the root layout, mirroring the
// onAuthStateChanged hook at js/app.js:132) runs applyPendingAction: it finds
// the heart button by its [data-fid] attribute and clicks it — the user is now
// signed in, so the normal FavoriteToggle flow applies.
//
// Only the feed/card heart saves a pending action (js/app.js:843 is the only
// guestNudgeThenLogin call site that passes extraData). The listing-detail
// heart (js/listing.js onFavoriteTap) nudges without one — parity kept.

export const PENDING_ACTION_KEY = 'dlala_pending_action';

/** Legacy retry budget: 1 initial attempt + 5 retries at 1.5s, then give up. */
const MAX_ATTEMPTS = 5;
const RETRY_MS = 1500;

export interface PendingAction {
  type: string;
  listingId?: string;
}

/** Stash the action so it survives the /auth round-trip. Never throws. */
export function savePendingAction(action: PendingAction): void {
  try {
    sessionStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(action));
  } catch {
    /* storage unavailable — the action is simply lost, like legacy */
  }
}

function consumePendingAction(): void {
  try {
    sessionStorage.removeItem(PENDING_ACTION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Apply the pending action saved before login. Byte-semantics port of
 * js/app.js applyPendingAction:
 * - unparsable JSON → return without consuming (legacy catches and returns)
 * - no pending / not signed in → return (re-checked on every attempt, like
 *   legacy re-reading `currentUser`)
 * - type 'favorite' + listingId → click the [data-fid] heart button; the
 *   feed may not be painted yet, so retry up to 5 times at 1.5s
 * - unknown type → consume (avoid a stuck pending state)
 * - give up after ~9s and consume
 *
 * @param isSignedIn live check for the signed-in state (legacy read the
 * `currentUser` global on every attempt); the applier wires this to the
 * current auth state.
 */
export function applyPendingAction(isSignedIn: () => boolean, attempt = 0): void {
  let pending: PendingAction | null = null;
  try {
    const raw = sessionStorage.getItem(PENDING_ACTION_KEY);
    if (!raw) return;
    pending = JSON.parse(raw) as PendingAction;
  } catch {
    return;
  }
  if (!pending || !isSignedIn()) return;

  let done = false;
  try {
    if (pending.type === 'favorite' && pending.listingId) {
      // Trigger the heart button click (user is now logged in, normal flow
      // applies). Same quote-strip as legacy before the querySelector.
      const id = String(pending.listingId).replace(/"/g, '');
      const btn = document.querySelector<HTMLButtonElement>(`[data-fid="${id}"]`);
      if (btn && !btn.disabled) {
        btn.click();
        done = true;
      }
    // else: feed not painted yet — retry below; consume only on success
    } else {
      done = true; // unknown type: consume to avoid a stuck pending state
    }
  } catch {
    console.warn('applyPendingAction failed');
    done = true;
  }

  if (done) {
    consumePendingAction();
  } else if (attempt < MAX_ATTEMPTS) {
    window.setTimeout(() => {
      try {
        applyPendingAction(isSignedIn, attempt + 1);
      } catch {
        /* best-effort */
      }
    }, RETRY_MS);
  } else {
    consumePendingAction(); // give up after ~9s
  }
}
