// POST /api/r2/chat-upload-url — mint a presigned R2 PUT URL for chat photos.
//
// Body: { key: string, contentType: string }
//   key must match chat/{convId}/{uid}/{filename} (validated).
//
// Auth: the caller must be signed in (Firebase ID token in Authorization
// header) and the {uid} segment must equal the token's uid. Each user can
// only upload into their own per-conversation prefix.
//
// Response: { url: string, publicUrl: string }

import { NextRequest, NextResponse } from 'next/server';
import { presignedUploadUrl, publicUrlFor } from '@/lib/r2';

function isValidChatKey(key: string): boolean {
  if (!key || key.includes('..') || key.startsWith('/')) return false;
  const parts = key.split('/');
  if (parts.length !== 4) return false;
  if (parts[0] !== 'chat') return false;
  const safe = /^[A-Za-z0-9._-]+$/;
  return safe.test(parts[1]) && safe.test(parts[2]) && safe.test(parts[3]);
}

export async function POST(req: NextRequest) {
  let body: { key?: string; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { key, contentType } = body;
  if (!key || !contentType || !isValidChatKey(key)) {
    return NextResponse.json({ error: 'invalid-key' }, { status: 400 });
  }

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
  if (!allowed.includes(contentType)) {
    return NextResponse.json({ error: 'invalid-content-type' }, { status: 400 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const m = authHeader.match(/^Bearer (.+)$/);
  if (!m) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const idToken = m[1];
  const keyUid = key.split('/')[2];

  // Public Firebase web key (also hardcoded in client files; public by design).
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCcW4X5IvCTi5ujyaBzQl7aJVeYd-A5mcg';
  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!verifyRes.ok) {
      return NextResponse.json({ error: 'invalid-token' }, { status: 401 });
    }
    const data = await verifyRes.json();
    const user = data?.users?.[0];
    const uid = user?.localId;
    if (!uid || uid !== keyUid) {
      return NextResponse.json({ error: 'uid-mismatch' }, { status: 403 });
    }
    if (!user?.emailVerified) {
      return NextResponse.json({ error: 'email-not-verified' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'verify-failed' }, { status: 500 });
  }

  try {
    const url = await presignedUploadUrl(key, contentType);
    return NextResponse.json({ url, publicUrl: publicUrlFor(key) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'r2-error';
    const safe = msg.includes('not configured') ? 'r2-not-configured' : 'r2-error';
    return NextResponse.json({ error: safe }, { status: 500 });
  }
}
