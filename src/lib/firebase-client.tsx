// Shared Firebase client for authenticated Next.js pages.
//
// Pattern (mirrors src/app/auth/page.tsx):
// - Firebase **compat** SDKs loaded at runtime from the gstatic CDN
//   (same 10.12.0 version the production SPA uses).
// - Runtime <script> injection keeps the SDK out of the Next.js bundle.
// - Firestore via the compat SDK so auth is handled automatically
//   (rules-aware reads/writes with the signed-in user).
//
// Pages that require sign-in: call useRequireAuth() — it redirects to
// /auth when no user is signed in.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { tasteMirrorUid } from '@/lib/taste';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCjll9nUDSbf9h8oS0s9xRyl1S0Qh9qO5M',
  authDomain: 'dlala-85cea.firebaseapp.com',
  projectId: 'dlala-85cea',
  storageBucket: 'dlala-85cea.firebasestorage.app',
};

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.0/';
const APP_SDK = SDK_BASE + 'firebase-app-compat.js';
const AUTH_SDK = SDK_BASE + 'firebase-auth-compat.js';
const FIRESTORE_SDK = SDK_BASE + 'firebase-firestore-compat.js';

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

// ---- Types (minimal compat surface we use) ----

export interface CompatUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  getIdToken: (force?: boolean) => Promise<string>;
  // Present on the real Firebase User at runtime (standard Auth API).
  reload: () => Promise<void>;
}

export interface CompatAuth {
  onAuthStateChanged: (cb: (u: CompatUser | null) => void) => () => void;
  signOut: () => Promise<void>;
  currentUser: CompatUser | null;
}

interface CompatFieldValue {
  serverTimestamp: () => unknown;
  arrayUnion: (...els: unknown[]) => unknown;
  arrayRemove: (...els: unknown[]) => unknown;
  increment: (n: number) => unknown;
}

export interface CompatDocRef {
  id: string;
  get: () => Promise<CompatDocSnap>;
  set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
  update: (data: Record<string, unknown>) => Promise<void>;
  delete: () => Promise<void>;
  collection: (name: string) => CompatCollectionRef;
  onSnapshot: (
    cb: (s: CompatDocSnap) => void,
    errCb?: (e: unknown) => void
  ) => () => void;
}

export interface CompatDocSnap {
  exists: boolean;
  id: string;
  data: () => Record<string, unknown> | undefined;
  ref: CompatDocRef;
}

export interface CompatQuerySnap {
  docs: CompatDocSnap[];
  empty: boolean;
  size: number;
  forEach: (cb: (d: CompatDocSnap) => void) => void;
}

export interface CompatQuery {
  get: () => Promise<CompatQuerySnap>;
  where: (field: string, op: string, value: unknown) => CompatQuery;
  orderBy: (field: string, dir?: 'asc' | 'desc') => CompatQuery;
  limit: (n: number) => CompatQuery;
  startAfter: (snap: CompatDocSnap) => CompatQuery;
  onSnapshot: (cb: (s: CompatQuerySnap) => void, errCb?: (e: unknown) => void) => () => void;
}

export interface CompatCollectionRef extends CompatQuery {
  doc: (id?: string) => CompatDocRef;
  add: (data: Record<string, unknown>) => Promise<CompatDocRef>;
}

export interface CompatFirestore {
  collection: (name: string) => CompatCollectionRef;
  doc: (path: string) => CompatDocRef;
  runTransaction: <T>(fn: (tx: CompatTransaction) => Promise<T>) => Promise<T>;
  batch: () => CompatBatch;
}

export interface CompatTransaction {
  get: (ref: CompatDocRef) => Promise<CompatDocSnap>;
  set: (ref: CompatDocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => void;
  update: (ref: CompatDocRef, data: Record<string, unknown>) => void;
  delete: (ref: CompatDocRef) => void;
}

export interface CompatBatch {
  set: (ref: CompatDocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => void;
  update: (ref: CompatDocRef, data: Record<string, unknown>) => void;
  delete: (ref: CompatDocRef) => void;
  commit: () => Promise<void>;
}

interface FirebaseCompat {
  apps: unknown[];
  initializeApp: (cfg: typeof FIREBASE_CONFIG) => unknown;
  auth: () => CompatAuth;
  firestore: (() => CompatFirestore) & { FieldValue: CompatFieldValue };
}

export interface FirebaseClient {
  auth: CompatAuth;
  db: CompatFirestore;
  FieldValue: CompatFieldValue;
}

let clientP: Promise<FirebaseClient> | null = null;

export function getFirebaseClient(): Promise<FirebaseClient> {
  if (clientP) return clientP;
  clientP = (async () => {
    await loadScript(APP_SDK);
    await loadScript(AUTH_SDK);
    await loadScript(FIRESTORE_SDK);
    const fb = (window as unknown as { firebase?: FirebaseCompat }).firebase;
    if (!fb) throw new Error('sdk-load-failed');
    if (fb.apps.length === 0) fb.initializeApp(FIREBASE_CONFIG);
    const auth = fb.auth();
    const db = fb.firestore();
    // Long-polling can help on flaky networks; harmless otherwise.
    return { auth, db, FieldValue: fb.firestore.FieldValue };
  })();
  return clientP;
}

// ---- Auth gate hook ----

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: CompatUser; client: FirebaseClient };

// Redirects to /auth when signed out. Returns the auth state; pages
// render a loading spinner while status === 'loading'.
export function useRequireAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    getFirebaseClient()
      .then((client) => {
        if (cancelled) return;
        unsub = client.auth.onAuthStateChanged((u) => {
          if (cancelled) return;
          if (u) {
            // js/app.js attachAuth parity: mirror the uid so on-device
            // stores (taste, snapshots) split registered vs guest.
            tasteMirrorUid(u.uid);
            setState({ status: 'signed-in', user: u, client });
          } else {
            tasteMirrorUid(null);
            setState({ status: 'signed-out' });
            window.location.href = '/auth';
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
  }, []);

  return state;
}

// Non-redirecting variant: pages that work for guests too.
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    getFirebaseClient()
      .then((client) => {
        if (cancelled) return;
        unsub = client.auth.onAuthStateChanged((u) => {
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

// ---- Shared UI bits ----

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="bg-emerald-700 text-white shadow">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold">
          دلالة
        </Link>
        <span className="text-sm">{subtitle || 'سوق الجزائر للإعلانات المبوبة'}</span>
      </div>
    </header>
  );
}

export function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <PageHeader title="دلالة" />
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-emerald-200 border-t-emerald-700" />
        <p className="mt-4 text-zinc-600">{label || 'جارٍ التحميل...'}</p>
      </main>
    </div>
  );
}

export const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 text-base';
export const btnCls =
  'w-full rounded-lg bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-60 disabled:cursor-wait transition-colors';
export const btnSecondaryCls =
  'rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 transition-colors';
