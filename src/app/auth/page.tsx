'use client';

// Dlala auth page — client component (interactive, no SSR needed).
//
// Uses the shared Firebase **modular** SDK loader (src/lib/firebase):
// getFirebaseCdn() loads the modular SDK (auth + firestore) as native ESM
// from the gstatic CDN (webpackIgnore) inside auth handlers/effects only —
// zero bundle cost up front. It is the SAME single Auth instance the drawer
// (SiteChrome via useAuthState) observes (Round 16 T2: fixes the drawer
// desync — the page used to sign in through a second, bundled Auth
// instance the drawer never saw). Persistence is browserLocalPersistence
// (set inside the module), so sessions survive deploys.
//
// Signup creates the account atomically (js/auth.js parity):
//  1. Username registry pre-check BEFORE the Auth account is created
//     (m-15: a taken handle must not leave an Auth account with no user doc).
//  2. Atomic batch: users/{uid} profile doc + usernames/{lower} registry,
//     with every required field (termsAcceptedAt = one-time legal evidence).
//  3. Mandatory terms checkbox — no acceptance, no account.
//  4. Email-verification gate — nobody proceeds to / unverified.
// A retry-after-commit (L9) and a post-login orphan heal (P2) keep accounts
// structurally valid even when a network blip interrupts signup.
// Round 14 T2: the verify gate no longer flips on onAuthStateChanged while
// signup provisioning is in flight — the gate appears only after the atomic
// user-doc batch settles, closing the tab-close race that orphaned Auth
// accounts.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
// Lazy: the Firebase SDK is heavy — it is only loaded inside auth
// handlers/effects via getFirebaseCdn(). The type imports below are
// erased at compile time.
import type {
  CompatUser,
  FirebaseClient,
} from '@/lib/firebase';
// LoadingSpinner is a value import — src/lib/firebase has no top-level
// Firebase SDK import (the SDK loads lazily inside getFirebaseCdn()), so
// this adds no bundle weight.
import { LoadingSpinner } from '@/lib/firebase';
import { withTimeout } from '@/lib/timeout';
import { authReturnTarget } from '../../lib/auth-return';
import { useLang } from '../../lib/i18n';
import {
  isDisposableEmail,
  hasPlusAddress,
} from '../../lib/auth-security';

// Friendly localized messages for Firebase auth errors.
// Mirrors js/auth.js authErrorMessage() exactly:
// wrong-password/user-not-found -> "incorrect credentials"; network/timeout ->
// "connection problem". Never blame credentials for a network fault, and never
// surface raw codes or raw JS errors.
function authErrorMessage(e: unknown, t: (k: string) => string, fallbackKey: string): string {
  const code = (e as { code?: string } | null)?.code || '';
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
      return t('loginError');
    case 'auth/invalid-email':
      return t('resetEmailInvalid');
    case 'auth/network-request-failed':
    case 'auth/timeout':
    case 'deadline-exceeded':
    case 'sdk-load-failed':
      return t('authConnectionProblem');
    case 'auth/email-already-in-use':
      // E2 (18 Oct 2026): do NOT confirm the email is registered — the
      // generic signup message hides registration status. (The L9 sign-in
      // fallback below still keys off the raw code, so UX is unchanged.)
      return t(fallbackKey);
    case 'auth/weak-password':
      return t('authWeakPassword');
    case 'auth/too-many-requests':
      return t('authTooManyRequests');
    case 'auth/user-disabled':
      return t('authUserDisabled');
    default:
      return t(fallbackKey);
  }
}

// --- Firestore helpers (js/auth.js parity) ---

// Atomic batch: users/{uid} public profile doc + usersPrivate/{uid}
// owner-only doc + usernames/{lower} registry.
// Mirrors js/auth.js ensureUserDoc() — rules-compliant create with every
// required field (termsAcceptedAt = one-time acceptance, legal evidence).
// E1 (18 Oct 2026): isAdmin/boostCredits live ONLY in the owner-only
// usersPrivate/{uid} doc — never on the public profile (unauthenticated
// GET would expose them). phone is never stored on the user doc at all —
// the consented number lives in reveals/{convId}, parties-only.
async function ensureUserDoc(fc: FirebaseClient, uid: string, name: string, username: string): Promise<void> {
  const { db, fsMod, auth, authMod } = fc;
  // Round 22 T6 — root cause of the fresh-signup "Missing or insufficient
  // permissions" failures (Round 21 T14, reproduced 2/2). The Firestore
  // client's Auth credential can lag behind a resolved
  // createUserWithEmailAndPassword — the ID token is not yet issued /
  // attached to the Firestore channel, so the batch commits with
  // request.auth == null and the create rules (isOwner(uid),
  // request.resource.data.userId == request.auth.uid) deny it. Forcing a
  // fresh ID token here guarantees the read and the batch both carry the
  // caller's identity before anything commits. Non-fatal on failure: the
  // P2 login heal recreates the doc on the next sign-in.
  try {
    const u = auth.currentUser;
    if (u && u.uid === uid) await withTimeout(authMod.getIdToken(u, true), 15000);
  } catch (e) {
    console.error('ensureUserDoc token refresh failed (non-fatal):', e);
  }
  const snap = await withTimeout(fsMod.getDoc(fsMod.doc(db, 'users/' + uid)));
  if (snap.exists()) return;
  const batch = fsMod.writeBatch(db);
  batch.set(fsMod.doc(db, 'users/' + uid), {
    name: name || '',
    username: username || '',
    verified: false,
    emailVerified: false,
    rating: 0,
    ratingCount: 0,
    confirmedDeals: 0,
    termsAcceptedAt: fsMod.serverTimestamp(),
    createdAt: fsMod.serverTimestamp(),
  });
  // E1 (18 Oct 2026): private fields — owner-only, never on the public doc.
  batch.set(fsMod.doc(db, 'usersPrivate/' + uid), {
    isAdmin: false,
    boostCredits: 0,
  });
  batch.set(fsMod.doc(db, 'usernames/' + username.toLowerCase()), { userId: uid });
  await withTimeout(batch.commit());
}

// Collision-safe username claim for the login heal path (legacy P2).
// Prefers the signup-chosen handle (recovered from sessionStorage); falls
// back to a deterministic derivation with a uid-suffix collision escape.
async function claimUsername(
  fc: FirebaseClient,
  uid: string,
  preferred: string | null,
  fallbackName: string
): Promise<string> {
  const { db, fsMod } = fc;
  const candidates: string[] = [];
  if (preferred && /^[a-z0-9._]{3,20}$/.test(preferred)) candidates.push(preferred);
  let base = (fallbackName || 'user').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 16);
  if (base.length < 3) base = 'user';
  candidates.push(base);
  candidates.push((base + '_' + uid.slice(0, 4)).toLowerCase().slice(0, 20));
  for (const c of candidates) {
    if (!/^[a-z0-9._]{3,20}$/.test(c)) continue;
    try {
      const snap = await withTimeout(fsMod.getDoc(fsMod.doc(db, 'usernames/' + c)));
      if (!snap.exists()) return c;
    } catch {
      // treat as taken, try the next candidate
    }
  }
  return (base.slice(0, 11) + '_' + uid.slice(0, 7)).toLowerCase().slice(0, 20);
}

type Mode = 'login' | 'signup' | 'reset' | 'verify';

// Signup-chosen profile stashed so a post-signup network failure can still
// create the exact user doc on the next sign-in (P2 orphan heal).
const PENDING_KEY = 'dlala_pending_profile';

function AuthPageInner() {
  const router = useRouter();
  // B2 fix: mode comes from useSearchParams() (SSR-safe — the Suspense
  // boundary in the default export below means this component never renders
  // on the server, so the initial state always reflects the real ?mode=
  // query with no hydration mismatch). The old window.location.search lazy
  // initializer defaulted to 'login' during SSR and flipped to signup only
  // after hydration.
  const params = useSearchParams();
  const initialMode: Mode =
    params.get('mode') === 'signup' ? 'signup' : 'login';
  // Round 110: all user-facing strings come from the shared i18n store
  // (js/i18n.js setLang parity) — the header language switcher
  // re-renders this page in the chosen language.
  const { t, lang } = useLang();
  // js/auth.js boot parity: ?mode=signup starts guests on the signup form
  // (initial state from useSearchParams — no setState-in-effect).
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [terms, setTerms] = useState(false);
  // Round 18 BL-1: the mid-session disabled-user watch bounces here with
  // ?disabled=1 — surface the same localized "account disabled" copy as
  // sign-in-time disabled (initial state from useSearchParams — SSR-safe
  // per the B2 note above).
  const [error, setError] = useState<string | null>(
    params.get('disabled') === '1' ? t('authUserDisabled') : null
  );
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyDone, setVerifyDone] = useState(false);
  const mounted = useRef(true);
  const unsubRef = useRef<(() => void) | null>(null);
  // Round 14 T2: true while signup provisioning (atomic user-doc batch
  // commit) is in flight. The onAuthStateChanged listener must not flip the
  // UI to the verify gate in this window — showing a "done" screen while
  // the commit is still in flight lets the user close the tab and abort it
  // client-side, orphaning the Auth account with no user doc.
  const provisioningInFlight = useRef(false);

  // js/auth.js authReturnTarget parity — sanitized ?return= continuation
  // after sign-in / verification-continue (L2: /auth never a return target).
  const returnTarget = useCallback((): string => {
    try {
      return authReturnTarget(new URLSearchParams(window.location.search).get('return'));
    } catch {
      return '/account';
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Already signed in: verified users proceed to their return target,
    // unverified users land on the verification gate.
    let cancelled = false;
    // Lazy-load the Firebase SDK (gstatic CDN path — the single Auth instance the drawer observes) — keeps it off the
    // initial page chunk.
    import('@/lib/firebase')
      .then(({ getFirebaseCdn }) => getFirebaseCdn())
      .then(({ auth, authMod }) => {
        if (cancelled) return;
        unsubRef.current = authMod.onAuthStateChanged(auth, (u) => {
          if (!mounted.current || !u) return;
          if (u.emailVerified) {
            // 11 Oct 2026: clear password from memory after successful auth.
            setPassword('');
            router.push(returnTarget());
          } else if (provisioningInFlight.current) {
            // Round 14 T2: signup is still provisioning the user doc (atomic
            // batch commit in flight). Do NOT flip to the verify gate yet —
            // the signup form stays up with its neutral "please wait"
            // loading state; handleSignup shows the gate explicitly once
            // provisioning settles.
            return;
          } else {
            setVerifyEmail(u.email || '');
            setVerifyDone(false);
            setMode('verify');
          }
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      mounted.current = false;
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [router, returnTarget]);

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setError(null);
    setOkMsg(null);
  }, []);

  const showVerifyGate = useCallback((u: CompatUser | null) => {
    setVerifyEmail(u?.email || '');
    setVerifyDone(!!u?.emailVerified);
    setError(null);
    setOkMsg(null);
    setMode('verify');
  }, []);

  async function handleLogin(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOkMsg(null);
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError(t('resetEmailInvalid'));
      return;
    }
    setLoading(true);
    try {
      // Lazy-load the Firebase SDK (gstatic CDN path — the single Auth instance the drawer observes) — keeps it off
      // the initial page chunk.
      const { getFirebaseCdn, withAuthRetry } = await import('@/lib/firebase');
      const fc = await getFirebaseCdn();
      const { auth, authMod, db, fsMod } = fc;
      const cred = await withAuthRetry(() => authMod.signInWithEmailAndPassword(auth, em, password));
      // M3: sign-in success is determined by the sign-in result itself.
      // A post-login reload() failure must NOT flip a success into a
      // failure — log it and continue with the cached verification flag.
      let verified = !!cred.user.emailVerified;
      try {
        await withTimeout(authMod.reload(cred.user));
        verified = !!cred.user.emailVerified;
      } catch (e) {
        console.error('post-login reload failed (non-fatal):', e);
      }
      // P2: heal an orphaned signup — if the user doc was never created
      // (post-signup failure), create it now so the account is complete.
      try {
        const snap = await withTimeout(
          fsMod.getDoc(fsMod.doc(db, 'users/' + cred.user.uid))
        );
        if (!snap.exists()) {
          let nm = cred.user.displayName || '';
          let un: string | null = null;
          try {
            // Round 14 T2: sessionStorage first (same-tab signup), then
            // localStorage (tab closed mid-provisioning — the race window).
            // The uid check keeps this safe on shared devices.
            const pending = JSON.parse(
              sessionStorage.getItem(PENDING_KEY) || localStorage.getItem(PENDING_KEY) || 'null'
            );
            if (pending && pending.uid === cred.user.uid && pending.username) {
              nm = pending.name || nm;
              un = pending.username;
            }
          } catch {
            // no stashed profile — derive below
          }
          const claimed = await claimUsername(
            fc,
            cred.user.uid,
            un,
            nm || (cred.user.email || '').split('@')[0]
          );
          await ensureUserDoc(fc, cred.user.uid, nm, claimed);
          try {
            sessionStorage.removeItem(PENDING_KEY);
          } catch {
            // non-fatal
          }
          try {
            localStorage.removeItem(PENDING_KEY);
          } catch {
            // non-fatal
          }
        }
      } catch (e) {
        console.error('post-login user-doc heal failed (non-fatal):', e);
      }
      if (!mounted.current) return;
      setLoading(false);
      if (verified) {
        // 11 Oct 2026: clear password from memory after successful auth.
        setPassword('');
        router.push(returnTarget());
      } else {
        showVerifyGate(cred.user);
      }
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, t, 'loginError'));
        setLoading(false);
      }
    }
  }

  async function handleSignup(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOkMsg(null);
    const displayName = name.trim();
    const handle = username.trim().toLowerCase();
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError(t('resetEmailInvalid'));
      return;
    }
    // Latin-script rules mirror the app: name Latin, handle 3-20 [a-z0-9._]
    if (!/^[A-Za-z][A-Za-z .'-]{1,38}$/.test(displayName) || !/^[a-z0-9._]{3,20}$/.test(handle)) {
      setError(t('signupError'));
      return;
    }
    // Terms are accepted exactly once, at signup — never shown again.
    if (!terms) {
      setError(t('termsRequired'));
      return;
    }
    // Client-side 8-char minimum (Firebase's server policy stays untouched).
    if (password.length < 8) {
      setError(t('authWeakPassword'));
      return;
    }
    setLoading(true);
    let fc: FirebaseClient | null = null;
    try {
      // Lazy-load the Firebase SDK (gstatic CDN path — the single Auth instance the drawer observes) — keeps it off the
      // initial page chunk.
      const { getFirebaseCdn, withAuthRetry } = await import('@/lib/firebase');
      fc = await getFirebaseCdn();
      const { auth, authMod, db, fsMod } = fc;
      // SECURITY (15 Sep 2026): block disposable/temporary email domains.
      // js/auth.js parity — checked after the SDK loads, before the username
      // registry pre-check.
      if (isDisposableEmail(em)) {
        if (mounted.current) {
          setError(t('disposableEmail'));
          setLoading(false);
        }
        return;
      }
      // SECURITY (15 Sep 2026): block plus-addressing (user+1@gmail.com)
      // to prevent mass account creation with aliases.
      // AUT-3 (16 Sep 2026): dedicated message — a plus-address is not a
      // "disposable" email and must not say so.
      if (hasPlusAddress(em)) {
        if (mounted.current) {
          setError(t('plusEmailNotAllowed'));
          setLoading(false);
        }
        return;
      }
      // m-15: check the username registry BEFORE creating the Auth account —
      // a taken handle used to fail the post-creation batch in ensureUserDoc(),
      // leaving an Auth account with no user doc (a stuck account). The batch
      // commit still guards the TOCTOU race atomically.
      const regSnap = await withTimeout(
        fsMod.getDoc(fsMod.doc(db, 'usernames/' + handle))
      );
      if (regSnap.exists()) {
        if (mounted.current) {
          setError(t('usernameTaken'));
          setLoading(false);
        }
        return;
      }
      // Round 14 T2b: provisioningInFlight is set BEFORE createUserWithEmailAndPassword
      // — the Firebase SDK fires onAuthStateChanged SYNCHRONOUSLY inside that call
      // (before its promise resolves), so a flag set after the await would never
      // cover the sync listener dispatch and the verify gate would flip early.
      // The listener skips the verify-gate transition while this flag is set —
      // flipping early would show a "done" screen while the atomic user-doc
      // batch is still committing; closing the tab in that window aborts the
      // commit client-side and orphans the Auth account. Cleared in the
      // finally below, however the block exits (createUser throw → outer catch
      // / L9 retry — never stuck).
      provisioningInFlight.current = true;
      try {
        const cred = await withAuthRetry(() => authMod.createUserWithEmailAndPassword(auth, em, password));
        // The Auth account now exists. Post-creation steps must NEVER orphan
        // it — on failure we still advance (the user doc is created idempotently
        // by ensureUserDoc on the next sign-in too) and report what happened.
        try {
          await withTimeout(authMod.updateProfile(cred.user, { displayName }));
        } catch (e) {
          console.error('updateProfile failed (non-fatal):', e);
        }
        // Stash in sessionStorage AND localStorage: sessionStorage dies with
        // the tab (exactly the race window above), so the P2 orphan-heal on
        // the next sign-in must also find the signup-chosen handle after a
        // tab close — otherwise it silently substitutes a display-name
        // derivation for the handle the user chose.
        const pendingJson = JSON.stringify({ uid: cred.user.uid, name: displayName, username: handle });
        try {
          sessionStorage.setItem(PENDING_KEY, pendingJson);
        } catch {
          // non-fatal
        }
        try {
          localStorage.setItem(PENDING_KEY, pendingJson);
        } catch {
          // non-fatal
        }
        // Round 24: the doc-failure note must surface in the VISIBLE mode
        // (verify), never in the hidden signup form. Round 14 T2: a failed
        // batch commit must REACH the UI — keep the real error code/message
        // (Round 147 convention) instead of a bare generic note.
        let docFailure: unknown = null;
        try {
          await ensureUserDoc(fc, cred.user.uid, displayName, handle);
          try {
            sessionStorage.removeItem(PENDING_KEY);
          } catch {
            // non-fatal
          }
          try {
            localStorage.removeItem(PENDING_KEY);
          } catch {
            // non-fatal
          }
        } catch (e) {
          console.error('ensureUserDoc failed (will retry on sign-in):', e);
          docFailure = e;
        }
        try {
          await withTimeout(authMod.sendEmailVerification(cred.user));
        } catch (e) {
          console.error('sendEmailVerification failed (non-fatal):', e);
        }
        if (!mounted.current) return;
        setLoading(false);
        showVerifyGate(cred.user);
        if (docFailure) {
          const failDetail =
            (docFailure as { code?: string } | null)?.code || (docFailure as Error | null)?.message;
          setError(t('signupDocRetry') + (failDetail ? ' [' + failDetail + ']' : ''));
        }
      } finally {
        provisioningInFlight.current = false;
      }
    } catch (e) {
      // L9: retry-after-commit — createUser may have committed server-side
      // while the response was lost; the retry then fails with
      // email-already-in-use. Try signing in with the same credentials; if
      // it works, the account was created by our request.
      const code = (e as { code?: string } | null)?.code || '';
      if (code === 'auth/email-already-in-use') {
        // Round 14 T2: same race as the main path — this signIn triggers
        // onAuthStateChanged while the L9 provisioning (ensureUserDoc) is
        // still in flight; hold the verify gate until it settles.
        provisioningInFlight.current = true;
        try {
          // Lazy-load the Firebase SDK (gstatic CDN path — the single Auth instance the drawer observes).
          const { getFirebaseCdn } = await import('@/lib/firebase');
          const fcL9 = fc ?? (await getFirebaseCdn());
          const signInCred = await withTimeout(
            fcL9.authMod.signInWithEmailAndPassword(fcL9.auth, em, password)
          );
          try {
            await withTimeout(fcL9.authMod.updateProfile(signInCred.user, { displayName }));
          } catch {
            // non-fatal
          }
          try {
            await ensureUserDoc(fcL9, signInCred.user.uid, displayName, handle);
          } catch {
            // P2 heal covers this on the next sign-in
          }
          try {
            await withTimeout(fcL9.authMod.sendEmailVerification(signInCred.user));
          } catch {
            // non-fatal
          }
          if (!mounted.current) return;
          setLoading(false);
          showVerifyGate(signInCred.user);
          return;
        } catch (se) {
          // Sign-in failed: genuine email-in-use by someone else.
          console.error('L9 sign-in fallback failed:', se);
        } finally {
          provisioningInFlight.current = false;
        }
      }
      if (mounted.current) {
        // Round 147 (Zak, 10 Oct 2026): always show the raw Firebase error
        // code alongside the localized message so the real cause is visible.
        const eCode = (e as { code?: string } | null)?.code;
        const eMsg = (e as Error | null)?.message;
        setError(
          authErrorMessage(e, t, 'signupError') + ' [' + (eCode || eMsg || 'unknown') + ']'
        );
        setLoading(false);
      }
    }
  }

  async function handleReset(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOkMsg(null);
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError(t('resetEmailInvalid'));
      return;
    }
    setLoading(true);
    try {
      // Lazy-load the Firebase SDK (gstatic CDN path — the single Auth instance the drawer observes) — keeps it off
      // the initial page chunk.
      const { getFirebaseCdn, withAuthRetry } = await import('@/lib/firebase');
      const { auth, authMod } = await getFirebaseCdn();
      await withAuthRetry(() => authMod.sendPasswordResetEmail(auth, em));
      if (mounted.current) {
        setOkMsg(t('resetLinkSent'));
        setLoading(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, t, 'errorGeneric'));
        setLoading(false);
      }
    }
  }

  // Verify gate: "I verified, continue" — reloads the user and proceeds only
  // when the email is actually verified, so users are never stuck.
  async function handleVerifyContinue() {
    setError(null);
    setOkMsg(null);
    setLoading(true);
    try {
      // Lazy-load the Firebase SDK (gstatic CDN path — the single Auth instance the drawer observes) — keeps it off
      // the initial page chunk.
      const { getFirebaseCdn } = await import('@/lib/firebase');
      const { auth, authMod } = await getFirebaseCdn();
      const u = auth.currentUser;
      if (!u) {
        if (mounted.current) {
          setLoading(false);
          switchMode('login');
        }
        return;
      }
      try {
        await withTimeout(authMod.reload(u));
      } catch (e) {
        console.error('verify-continue reload failed:', e);
        if (mounted.current) {
          setError(authErrorMessage(e, t, 'errorGeneric'));
          setLoading(false);
        }
        return;
      }
      if (!mounted.current) return;
      const verified = !!u.emailVerified;
      setVerifyDone(verified);
      if (verified) {
        // 11 Oct 2026: clear password from memory after successful auth.
        setPassword('');
        router.push(returnTarget());
      } else {
        // Still not verified — say so plainly, don't leave them guessing.
        setError(t('verifyStillPending'));
        setLoading(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, t, 'errorGeneric'));
        setLoading(false);
      }
    }
  }

  async function handleResend() {
    setError(null);
    setOkMsg(null);
    setLoading(true);
    try {
      // Lazy-load the Firebase SDK (gstatic CDN path — the single Auth instance the drawer observes) — keeps it off
      // the initial page chunk.
      const { getFirebaseCdn, withAuthRetry } = await import('@/lib/firebase');
      const { auth, authMod } = await getFirebaseCdn();
      const u = auth.currentUser;
      if (!u) {
        if (mounted.current) {
          setLoading(false);
          switchMode('login');
        }
        return;
      }
      await withAuthRetry(() => authMod.sendEmailVerification(u));
      if (mounted.current) {
        // Success and failure states are exclusive.
        setOkMsg(t('emailSent'));
        setLoading(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError(authErrorMessage(e, t, 'errorGeneric'));
        setLoading(false);
      }
    }
  }

  async function handleVerifyLogout() {
    try {
      // Lazy-load the Firebase SDK (gstatic CDN path — the single Auth instance the drawer observes) — keeps it off the
      // initial page chunk.
      const { getFirebaseCdn } = await import('@/lib/firebase');
      const { auth, authMod } = await getFirebaseCdn();
      await authMod.signOut(auth);
    } catch (e) {
      // A failed sign-out must surface in the VISIBLE mode (verify), never
      // in the hidden login mode.
      console.error(e);
      if (mounted.current) setError(authErrorMessage(e, t, 'errorGeneric'));
      return;
    }
    if (mounted.current) switchMode('login');
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 text-base';
  const btnCls =
    'w-full rounded-lg bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-60 disabled:cursor-wait transition-colors';
  const btnSecondaryCls =
    'w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 transition-colors';

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className="bg-emerald-700 text-white shadow">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">
            {t('appName')}
          </Link>
          <span className="text-sm">{t('authTagline')}</span>
        </div>
      </header>

      <main id="main-content" className="max-w-md mx-auto px-4 py-10">
        <div className="rounded-2xl bg-white shadow-sm p-6">
          {mode === 'login' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">{t('login')}</h1>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <form onSubmit={handleLogin} noValidate>
                <label htmlFor="lEmail" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('email')}
                </label>
                <input
                  id="lEmail"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  className={inputCls + ' mb-4 text-left'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <label htmlFor="lPass" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('password')}
                </label>
                <input
                  id="lPass"
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  className={inputCls + ' mb-5 text-left'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button type="submit" className={btnCls} disabled={loading}>
                  {loading ? t('pleaseWait') : t('loginBtn')}
                </button>
              </form>
              <p className="mt-4 text-sm text-center">
                <button
                  type="button"
                  onClick={() => switchMode('reset')}
                  className="text-emerald-700 hover:underline"
                >
                  {t('forgotPassword')}
                </button>
              </p>
              <p className="mt-2 text-sm text-center text-zinc-600">
                {t('noAccountQ')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="text-emerald-700 font-medium hover:underline"
                >
                  {t('createAccountLink')}
                </button>
              </p>
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">{t('signup')}</h1>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <form onSubmit={handleSignup} noValidate>
                <label htmlFor="sName" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('name')}
                </label>
                <p className="text-xs text-zinc-500 mb-1">{t('nameHint')}</p>
                <input
                  id="sName"
                  dir="ltr"
                  maxLength={40}
                  autoComplete="name"
                  className={inputCls + ' mb-4 text-left'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <label htmlFor="sUser" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('username')}
                </label>
                <p className="text-xs text-zinc-500 mb-1">{t('usernameHint')}</p>
                <input
                  id="sUser"
                  dir="ltr"
                  maxLength={20}
                  autoComplete="username"
                  className={inputCls + ' mb-4 text-left'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  required
                />
                <label htmlFor="sEmail" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('email')}
                </label>
                <input
                  id="sEmail"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  className={inputCls + ' mb-4 text-left'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <label htmlFor="sPass" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('passwordMin8')}
                </label>
                <input
                  id="sPass"
                  type="password"
                  dir="ltr"
                  minLength={8}
                  autoComplete="new-password"
                  className={inputCls + ' mb-5 text-left'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <label htmlFor="sTerms" className="flex items-start gap-2 mb-5 text-sm text-zinc-700 cursor-pointer">
                  <input
                    id="sTerms"
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-emerald-700"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                  />
                  <span>
                    {t('agreeTo')}{' '}
                    <Link href="/terms" className="text-emerald-700 hover:underline">
                      {t('termsLink')}
                    </Link>
                  </span>
                </label>
                <button type="submit" className={btnCls} disabled={loading}>
                  {loading ? t('pleaseWait') : t('signupBtn')}
                </button>
              </form>
              <p className="mt-4 text-sm text-center text-zinc-600">
                {t('haveAccountQ')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-emerald-700 font-medium hover:underline"
                >
                  {t('signInLink')}
                </button>
              </p>
            </div>
          )}

          {mode === 'reset' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-5">{t('forgotPassword')}</h1>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              {okMsg && (
                <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                  {okMsg}
                </div>
              )}
              <form onSubmit={handleReset} noValidate>
                <label htmlFor="rEmail" className="block text-sm font-medium text-zinc-700 mb-1">
                  {t('email')}
                </label>
                <input
                  id="rEmail"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  className={inputCls + ' mb-5 text-left'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <button type="submit" className={btnCls} disabled={loading}>
                  {loading ? t('pleaseWait') : t('sendResetLink')}
                </button>
              </form>
              <p className="mt-4 text-sm text-center">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-emerald-700 font-medium hover:underline"
                >
                  {t('backToLogin')}
                </button>
              </p>
            </div>
          )}

          {mode === 'verify' && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-3">{t('verifyEmailTitle')}</h1>
              <div className="mb-4 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-sm text-sky-800">
                {t('verifyEmailBody')}
              </div>
              {verifyEmail && (
                <p className="mb-2 text-sm text-zinc-600" dir="ltr" style={{ textAlign: 'right' }}>
                  {verifyEmail}
                </p>
              )}
              <p className="mb-4 text-sm text-zinc-600">
                {t('verifyStatusLabel')}{' '}
                <strong className={verifyDone ? 'text-emerald-700' : 'text-amber-700'}>
                  {verifyDone ? t('verifyStatusDone') : t('verifyStatusPending')}
                </strong>
              </p>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              {okMsg && (
                <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                  {okMsg}
                </div>
              )}
              <button type="button" className={btnCls} disabled={loading} onClick={handleVerifyContinue}>
                {loading ? t('pleaseWait') : t('verifiedContinue')}
              </button>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={btnSecondaryCls}
                  disabled={loading}
                  onClick={handleResend}
                >
                  {t('resendEmail')}
                </button>
                <button
                  type="button"
                  className={btnSecondaryCls}
                  disabled={loading}
                  onClick={handleVerifyLogout}
                >
                  {t('logout')}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Suspense boundary (auth-action/publish/chat parity): useSearchParams()
// must not render during prerender — the fallback streams on the server
// and the inner component renders on the client with the real ?mode=.
export default function AuthPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AuthPageInner />
    </Suspense>
  );
}
