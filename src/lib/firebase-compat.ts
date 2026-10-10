// Shared Firebase compat SDK loader for auth-gated pages.
//
// Loads the Firebase **compat** SDKs at runtime from the gstatic CDN
// (same 10.12.0 version the production SPA uses): app, auth, firestore,
// storage. Runtime <script> injection keeps the SDKs out of the Next.js
// bundle entirely — zero bundler issues, zero SDK bytes on public pages.
//
// Mirrors js/app.js initFirebase() + the auth.js patterns exactly.

'use client';

const FIREBASE_CONFIG = {
  // Production key from dlala-040/js/config.js (0.0.0.39) — the previous key
  // was not valid for Identity Toolkit, breaking all Auth operations.
  apiKey: 'AIzaSyBnXvXw4XkL3mN2pQ8rS5tU7vW9yZ0aBcDe',
  authDomain: 'dlala-85cea.firebaseapp.com',
  projectId: 'dlala-85cea',
  storageBucket: 'dlala-85cea.firebasestorage.app',
};

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.0/';
const SDK_SCRIPTS = [
  SDK_BASE + 'firebase-app-compat.js',
  SDK_BASE + 'firebase-auth-compat.js',
  SDK_BASE + 'firebase-firestore-compat.js',
  SDK_BASE + 'firebase-storage-compat.js',
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('sdk-load-failed'));
    document.head.appendChild(s);
  });
}

// Minimal compat type surface (only what the account pages use).
export interface CompatUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  reload: () => Promise<void>;
  sendEmailVerification: () => Promise<void>;
  updateProfile: (p: { displayName?: string }) => Promise<void>;
  delete: () => Promise<void>;
  reauthenticateWithCredential: (cred: unknown) => Promise<void>;
  // Present on the real Firebase User at runtime (used for R2 API calls).
  getIdToken: (force?: boolean) => Promise<string>;
}

export interface CompatAuth {
  currentUser: CompatUser | null;
  onAuthStateChanged: (cb: (u: CompatUser | null) => void) => () => void;
  signOut: () => Promise<void>;
  setPersistence: (p: string) => Promise<void>;
  signInWithEmailAndPassword: (email: string, pass: string) => Promise<{ user: CompatUser }>;
  createUserWithEmailAndPassword: (email: string, pass: string) => Promise<{ user: CompatUser }>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
}

export interface CompatBatch {
  set: (ref: unknown, data: unknown) => void;
  commit: () => Promise<void>;
}

export interface CompatFirestore {
  collection: (path: string) => unknown;
  doc: (path: string) => unknown;
  batch: () => CompatBatch;
}

export interface CompatStorage {
  ref: (path: string) => unknown;
}

export interface FirebaseCompat {
  auth: () => CompatAuth;
  firestore: () => CompatFirestore;
  storage: () => CompatStorage;
}

interface WindowWithFirebase {
  firebase?: {
    apps: unknown[];
    initializeApp: (cfg: typeof FIREBASE_CONFIG) => unknown;
    auth: (() => CompatAuth) & {
      Auth: { Persistence: { LOCAL: string } };
      EmailAuthProvider: { credential: (email: string, pw: string) => unknown };
    };
    firestore: () => CompatFirestore;
    storage: () => CompatStorage;
  };
}

let initP: Promise<WindowWithFirebase['firebase']> | null = null;

export function getFirebase(): Promise<NonNullable<WindowWithFirebase['firebase']>> {
  if (initP) return initP as Promise<NonNullable<WindowWithFirebase['firebase']>>;
  initP = (async () => {
    try {
      for (const src of SDK_SCRIPTS) {
        await loadScript(src);
      }
      const w = window as unknown as WindowWithFirebase;
      const fb = w.firebase;
      if (!fb) throw new Error('sdk-load-failed');
      if (fb.apps.length === 0) fb.initializeApp(FIREBASE_CONFIG);
      try {
        await fb.auth().setPersistence(fb.auth.Auth.Persistence.LOCAL);
      } catch {
        // non-fatal (private mode etc.)
      }
      return fb;
    } catch (e) {
      // Reset on failure so the next call retries (don't cache rejections)
      initP = null;
      throw e;
    }
  })();
  return initP as Promise<NonNullable<WindowWithFirebase['firebase']>>;
}

// Timeout wrapper — mirrors js/acct-common.js withAcctTimeout (15s).
export function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('deadline-exceeded'), { code: 'deadline-exceeded' })), ms)
    ),
  ]);
}

// --- Auth resilience helpers (js/auth.js 15 Sep 2026 repair parity) ---------
// Auth requests could hang forever (M1). withTimeout bounds every call; a
// single automatic retry on network failure follows.
export function isNetworkAuthError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator && (navigator as { onLine?: boolean }).onLine === false) return true;
  const code = (e as { code?: string } | null)?.code || '';
  // 'deadline-exceeded' is this port's timeout code (withTimeout above);
  // legacy throws 'auth/timeout' for the same case — included for parity.
  return code === 'auth/network-request-failed' || code === 'auth/timeout' || code === 'deadline-exceeded';
}
// One automatic retry on network failure (M1). Any other error is rethrown.
export async function withAuthRetry<T>(fn: () => Promise<T>, ms = 15000): Promise<T> {
  try {
    return await withTimeout(fn(), ms);
  } catch (e) {
    if (isNetworkAuthError(e)) return withTimeout(fn(), ms); // single retry
    throw e;
  }
}
