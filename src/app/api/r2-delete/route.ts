// POST /api/r2-delete — delete R2 objects owned by the caller.
//
// Body: { keys: string[] } — each entry a bare R2 object key or a full
//   public URL under the configured R2 public base. Non-R2 values
//   (Firebase Storage URLs, dzdlala.com default images) are reported
//   as skipped, not errors.
//
// Security: the caller must be signed in (Firebase ID token in the
//   Authorization header, verified via accounts:lookup exactly like the
//   upload routes). Every key must live in the caller's own namespace —
//   listings/{uid}/... or chat/{convId}/{uid}/... — with the uid segment
//   equal to the token's uid. Anything else is rejected, so one user can
//   never delete another user's objects.
//
// Variant photos (w320/w640/w1024/w32) whose URLs are not stored in
// Firestore are derived from main photo keys and deleted too, so no
// silent variant orphans remain (derived keys stay inside the caller's
// own namespace, so the ownership check still holds).
//
// Response: { results: [{ key, status: 'deleted'|'skipped'|'error', error? }] }
//   Results are reported only for the keys the client explicitly sent.

import { NextRequest, NextResponse } from 'next/server';
import {
  deleteR2Objects,
  deleteKeyOwner,
  keyFromUrlOrKey,
  variantKeysFor,
} from '@/lib/r2';

const MAX_KEYS = 100;

async function verifyUid(idToken: string): Promise<string | null> {
  // Public Firebase web key (same as the upload routes; public by design).
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyBnXvXw4XkL3mN2pQ8rS5tU7vW9yZ0aBcDe';
  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!verifyRes.ok) return null;
    const data = await verifyRes.json();
    return data?.users?.[0]?.localId || null;
  } catch {
    return null;
  }
}

type Result = {
  key: string;
  status: 'deleted' | 'skipped' | 'error';
  error?: string;
};

export async function POST(req: NextRequest) {
  let body: { keys?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  if (!Array.isArray(body.keys)) {
    return NextResponse.json({ error: 'keys-required' }, { status: 400 });
  }
  const raw: string[] = body.keys.filter(
    (k): k is string => typeof k === 'string'
  );
  if (!raw.length) {
    return NextResponse.json({ results: [] });
  }
  if (raw.length > MAX_KEYS) {
    return NextResponse.json({ error: 'too-many-keys' }, { status: 400 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const m = authHeader.match(/^Bearer (.+)$/);
  if (!m) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const uid = await verifyUid(m[1]);
  if (!uid) {
    return NextResponse.json({ error: 'invalid-token' }, { status: 401 });
  }

  const results: Result[] = [];
  const pending: { entry: string; key: string }[] = [];
  const toDelete = new Set<string>();

  for (const entry of raw) {
    const key = keyFromUrlOrKey(entry);
    if (!key) {
      results.push({ key: entry, status: 'skipped', error: 'not-r2-url' });
      continue;
    }
    const owner = deleteKeyOwner(key);
    if (!owner) {
      results.push({ key, status: 'skipped', error: 'invalid-key' });
      continue;
    }
    if (owner !== uid) {
      results.push({ key, status: 'skipped', error: 'uid-mismatch' });
      continue;
    }
    pending.push({ entry, key });
    toDelete.add(key);
    for (const v of variantKeysFor(key)) toDelete.add(v);
  }

  if (toDelete.size) {
    let failedSet = new Set<string>();
    try {
      const { failed } = await deleteR2Objects([...toDelete]);
      failedSet = new Set(failed.map((f) => f.key));
    } catch {
      // Whole-batch failure: mark every pending key as error.
      for (const p of pending) {
        results.push({ key: p.entry, status: 'error', error: 'r2-error' });
      }
      return NextResponse.json({ results });
    }
    for (const p of pending) {
      results.push(
        failedSet.has(p.key)
          ? { key: p.entry, status: 'error', error: 'delete-failed' }
          : { key: p.entry, status: 'deleted' }
      );
    }
  }

  return NextResponse.json({ results });
}
