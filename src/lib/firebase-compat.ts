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
  apiKey: 'AIzaSyCjll9nUDSbf9h8oS0s9xRyl1S0Qh9qO5M',
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
  delete: () => Promise<void>;
  reauthenticateWithCredential: (cred: unknown) => Promise<void>;
}

export interface CompatAuth {
  currentUser: CompatUser | null;
  onAuthStateChanged: (cb: (u: CompatUser | null) => void) => () => void;
  signOut: () => Promise<void>;
  setPersistence: (p: string) => Promise<void>;
}

export interface CompatFirestore {
  collection: (path: string) => unknown;
  doc: (path: string) => unknown;
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
