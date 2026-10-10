// Shared Firebase compat SDK for auth-gated pages.
//
// Uses the bundled Firebase compat SDKs from npm (same 10.12.0 version the
// production SPA uses): app, auth, firestore, storage. Bundled — no CDN
// dependency, no runtime script injection failures.
//
// Mirrors js/app.js initFirebase() + the auth.js patterns exactly.

'use client';

import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';

const FIREBASE_CONFIG = {
  // Production key from dlala-040/js/config.js (0.0.0.39) — the previous key
  // was not valid for Identity Toolkit, breaking all Auth operations.
  apiKey: 'AIzaSyCcW4X5IvCTi5ujyaBzQl7aJVeYd-A5mcg',
  authDomain: 'dlala-85cea.firebaseapp.com',
  projectId: 'dlala-85cea',
  storageBucket: 'dlala-85cea.firebasestorage.app',
  messagingSenderId: '413798475439',
  appId: '1:413798475439:web:df5afa1e001e1cceaa165a',
};

// getFirebase returns the bundled Firebase compat instance.
// The SDK is bundled via npm — no CDN loading, no script injection.
type FirebaseCompatInstance = typeof firebase;

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
  auth: (() => CompatAuth) & {
    EmailAuthProvider: { credential: (email: string, pw: string) => unknown };
    Auth: { Persistence: { LOCAL: string } };
  };
  firestore: () => CompatFirestore;
  storage: () => CompatStorage;
}

let initP: Promise<FirebaseCompat> | null = null;

export function getFirebase(): Promise<FirebaseCompat> {
  if (initP) return initP;
  initP = (async () => {
    try {
      // Bundled SDK — no CDN loading needed
      if (firebase.apps.length === 0) firebase.initializeApp(FIREBASE_CONFIG);
      try {
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch {
        // non-fatal (private mode etc.)
      }
      return firebase as unknown as FirebaseCompat;
    } catch (e) {
      // Reset on failure so the next call retries (don't cache rejections)
      initP = null;
      throw e;
    }
  })();
  return initP;
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
