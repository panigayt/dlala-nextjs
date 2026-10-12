// Modular Firebase SDK — single replacement for BOTH legacy loaders.
//
// Replaces:
//   - src/lib/firebase-compat.ts  (bundled npm compat SDK, ~342KB firestore chunk)
//   - src/lib/firebase-client.tsx (compat SDK via gstatic <script> injection)
//
// TWO loading paths, one coherent API. Both return the same FirebaseClient
// shape; only the SDK source differs:
//
//   getFirebaseBundled() — modular SDK from npm, loaded via dynamic import()
//     INSIDE this function only. Serves today's 23 firebase-compat users.
//     Async chunk on demand; the initial page bundle stays Firebase-free.
//
//   getFirebaseCdn() — modular ESM from the gstatic CDN via dynamic
//     import(url) with `webpackIgnore: true` (docs-verified for both
//     webpack and Turbopack: "Skip bundling, preserve import"). 0 bundle
//     bytes. Serves today's 26 firebase-client users.
//
// Rules this file obeys (do not regress):
//   - NEVER a static top-level `from 'firebase/...'` runtime import.
//     Type-only `import type` is used instead: erased at compile time,
//     zero bundle cost, zero side effects. This eliminates the Turbopack
//     "firebase.auth is not a function" bug class by construction — there
//     is no side-effect import that can fail to register.
//   - One shared instance per path: concurrent callers share one promise;
//     initializeApp runs at most once per path; a rejected init resets so
//     the next call retries (parity with the old loaders).
//   - browserLocalPersistence is set explicitly on BOTH paths (R10).
//     The compat SDK's Persistence.LOCAL and the modular
//     browserLocalPersistence use the same IndexedDB database
//     (firebaseLocalStorageDb) and the same key
//     (firebase:authUser:<apiKey>:[DEFAULT]); the apiKey is unchanged, so
//     sessions survive the deploy.

'use client';

import * as React from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tasteMirrorUid } from '@/lib/taste';
import { authLoginHref } from '@/lib/auth-return';
import { saveScrollForReturn } from '@/lib/scroll-restore';
import { useLang } from '@/lib/i18n';
import { withTimeout } from '@/lib/timeout';

// Type-only imports: erased at compile time (isolatedModules-safe), they
// never create a runtime import and never add a byte to any bundle.
import type { FirebaseApp } from 'firebase/app';
import type { Auth, User, AuthCredential, Unsubscribe } from 'firebase/auth';
import type {
  Firestore,
  DocumentReference,
  DocumentSnapshot,
  QuerySnapshot,
  CollectionReference,
  Query,
  Transaction,
  WriteBatch,
  QueryConstraint,
} from 'firebase/firestore';
import type { FirebaseStorage, StorageReference } from 'firebase/storage';

export const FIREBASE_CONFIG = {
  // Production key from dlala-040/js/config.js (0.0.0.39).
  apiKey: 'AIzaSyCcW4X5IvCTi5ujyaBzQl7aJVeYd-A5mcg',
  authDomain: 'dlala-85cea.firebaseapp.com',
  projectId: 'dlala-85cea',
  storageBucket: 'dlala-85cea.firebasestorage.app',
  messagingSenderId: '413798475439',
  appId: '1:413798475439:web:df5afa1e001e1cceaa165a',
};

const SDK_VERSION = '10.12.0';
const CDN_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;

// ---- Modular types (explicit replacements for the Compat* interfaces) ----

export type FirebaseUser = User;
export type FirebaseAuth = Auth;
export type FirebaseDb = Firestore;
export type FirebaseStorageClient = FirebaseStorage;
export type FirebaseDocRef = DocumentReference;
export type FirebaseDocSnap = DocumentSnapshot;
export type FirebaseQuerySnap = QuerySnapshot;
export type FirebaseCollectionRef = CollectionReference;
export type FirebaseQuery = Query;
export type FirebaseTransaction = Transaction;
export type FirebaseBatch = WriteBatch;
export type FirebaseStorageRef = StorageReference;
export type FirebaseQueryConstraint = QueryConstraint;
export type FirebaseAuthCredential = AuthCredential;
export type FirebaseUnsubscribe = Unsubscribe;

// Staged-migration aliases: the Compat* names now ARE the modular types.
// NOTE: only valid in type positions. Method-style compat calls
// (auth.signInWithEmailAndPassword(...), db.collection(...).where(...))
// do NOT exist on these types — call sites must be rewritten to the
// modular functions (see the mapping table in the Round 12 report).
export type CompatUser = User;
export type CompatAuth = Auth;
export type CompatFirestore = Firestore;
export type CompatStorage = FirebaseStorage;
export type CompatDocRef = DocumentReference;
export type CompatDocSnap = DocumentSnapshot;
export type CompatQuerySnap = QuerySnapshot;
export type CompatQuery = Query;
export type CompatCollectionRef = CollectionReference;
export type CompatTransaction = Transaction;
export type CompatBatch = WriteBatch;
export type FirebaseCompat = FirebaseClient;

// The modular SDK namespaces, captured from the dynamic import of the
// matching path (bundled npm vs gstatic CDN). Call sites use these for
// every operation, e.g.:
//
//   const { auth, db, storage, authMod, fsMod, storageMod } = await getFirebaseCdn();
//   await authMod.signInWithEmailAndPassword(auth, email, pw);
//   const snap = await fsMod.getDoc(fsMod.doc(db, 'listings/' + id));
//   await storageMod.uploadBytes(storageMod.ref(storage, path), blob);
export interface FirebaseModules {
  auth: typeof import('firebase/auth');
  fs: typeof import('firebase/firestore');
  storage: typeof import('firebase/storage');
}

export interface FirebaseClient {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  authMod: typeof import('firebase/auth');
  fsMod: typeof import('firebase/firestore');
  storageMod: typeof import('firebase/storage');
}

// ---- Loaders (dynamic import only — never static) ----

interface PathModules {
  appMod: { getApps: () => FirebaseApp[]; initializeApp: (cfg: typeof FIREBASE_CONFIG) => FirebaseApp };
  authMod: FirebaseModules['auth'];
  fsMod: FirebaseModules['fs'];
  storageMod: FirebaseModules['storage'];
}

async function buildClient(load: () => Promise<PathModules>): Promise<FirebaseClient> {
  const { appMod, authMod, fsMod, storageMod } = await load();
  // getApps() — never initializeApp twice, even if another copy of this
  // module (or a half-migrated page) already initialized.
  const apps = appMod.getApps();
  const app = apps.length > 0 ? apps[0] : appMod.initializeApp(FIREBASE_CONFIG);
  const auth = authMod.getAuth(app);
  try {
    // R10: explicit local persistence — sessions MUST survive deploys.
    await authMod.setPersistence(auth, authMod.browserLocalPersistence);
  } catch {
    // non-fatal (private mode etc.) — parity with the old loaders.
  }
  return {
    app,
    auth,
    db: fsMod.getFirestore(app),
    storage: storageMod.getStorage(app),
    authMod,
    fsMod,
    storageMod,
  };
}

// Bundled path: modular SDK from npm. The dynamic import() splits it into
// an async chunk; nothing Firebase-shaped is in the initial page bundle.
// Serves today's 23 firebase-compat users.
let bundledP: Promise<FirebaseClient> | null = null;
export function getFirebaseBundled(): Promise<FirebaseClient> {
  if (bundledP) return bundledP;
  bundledP = buildClient(async () => {
    const [appMod, authMod, fsMod, storageMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
      import('firebase/storage'),
    ]);
    return { appMod, authMod, fsMod, storageMod };
  }).catch((e: unknown) => {
    // Reset on failure so the next call retries (don't cache rejections).
    bundledP = null;
    throw e;
  });
  return bundledP;
}

// CDN path: modular ESM from gstatic. `webpackIgnore: true` is
// docs-verified (Next 16 Turbopack docs) to skip bundling and preserve the
// native import() on both webpack and Turbopack — 0 bundle bytes.
// Serves today's 26 firebase-client users.
let cdnP: Promise<FirebaseClient> | null = null;
export function getFirebaseCdn(): Promise<FirebaseClient> {
  if (cdnP) return cdnP;
  cdnP = buildClient(async () => {
    const [appMod, authMod, fsMod, storageMod] = await Promise.all([
      import(/* webpackIgnore: true */ CDN_BASE + 'firebase-app.js') as Promise<PathModules['appMod']>,
      import(/* webpackIgnore: true */ CDN_BASE + 'firebase-auth.js') as Promise<FirebaseModules['auth']>,
      import(/* webpackIgnore: true */ CDN_BASE + 'firebase-firestore.js') as Promise<FirebaseModules['fs']>,
      import(/* webpackIgnore: true */ CDN_BASE + 'firebase-storage.js') as Promise<FirebaseModules['storage']>,
    ]);
    return { appMod, authMod, fsMod, storageMod };
  }).catch((e: unknown) => {
    // Reset on failure so the next call retries (don't cache rejections).
    cdnP = null;
    throw e;
  });
  return cdnP;
}

// ---- Resilience helpers (same semantics/timeouts as firebase-compat) ----

// Re-exported: the pure timeout helper (moved to @/lib/timeout 11 Oct 2026).
export { withTimeout };

// Auth requests could hang forever (M1). withTimeout bounds every call; a
// single automatic retry on network failure follows.
export function isNetworkAuthError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator && (navigator as { onLine?: boolean }).onLine === false) return true;
  const code = (e as { code?: string } | null)?.code || '';
  // 'deadline-exceeded' is this port's timeout code (withTimeout);
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

// ---- Auth gate hooks (behavior identical to firebase-client) ----

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: User; client: FirebaseClient };

// Redirects to /auth when signed out. Returns the auth state; pages
// render a loading spinner while status === 'loading'.
export function useRequireAuth(): AuthState {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    getFirebaseCdn()
      .then((client) => {
        if (cancelled) return;
        unsub = client.authMod.onAuthStateChanged(client.auth, (u) => {
          if (cancelled) return;
          if (u) {
            // js/app.js attachAuth parity: mirror the uid so on-device
            // stores (taste, snapshots) split registered vs guest.
            tasteMirrorUid(u.uid);
            setState({ status: 'signed-in', user: u, client });
          } else {
            tasteMirrorUid(null);
            setState({ status: 'signed-out' });
            // QA 16 Sep 2026 #4 (js/app.js saveScrollForReturn parity): keep the
            // scroll position across the /auth round-trip.
            saveScrollForReturn(window.location.pathname);
            router.push(authLoginHref(window.location.pathname, window.location.search));
          }
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'signed-out' });
      });
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [router]);

  return state;
}

// Non-redirecting variant: pages that work for guests too.
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    getFirebaseCdn()
      .then((client) => {
        if (cancelled) return;
        unsub = client.authMod.onAuthStateChanged(client.auth, (u) => {
          if (cancelled) return;
          // js/app.js attachAuth parity: mirror the uid so on-device
          // stores (taste, snapshots) split registered vs guest.
          tasteMirrorUid(u ? u.uid : null);
          if (u) setState({ status: 'signed-in', user: u, client });
          else setState({ status: 'signed-out' });
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'signed-out' });
      });
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  return state;
}

// ---- Shared UI bits (identical to firebase-client) ----

// JSX-free (this file is .ts by design): identical DOM to the old
// firebase-client LoadingSpinner.
export function LoadingSpinner({ label }: { label?: string }) {
  const { lang, t } = useLang();
  return React.createElement(
    'div',
    { className: 'min-h-screen bg-zinc-50', dir: lang === 'ar' ? 'rtl' : 'ltr' },
    React.createElement(
      'main',
      { className: 'max-w-2xl mx-auto px-4 py-16 text-center' },
      React.createElement('div', {
        className: 'inline-block animate-spin rounded-full h-10 w-10 border-4 border-emerald-200 border-t-emerald-700',
      }),
      React.createElement('p', { className: 'mt-4 text-zinc-600' }, label || t('loading'))
    )
  );
}

export const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 text-base';
export const btnCls =
  'w-full rounded-lg bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-60 disabled:cursor-wait transition-colors';
export const btnSecondaryCls =
  'rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 transition-colors';
