// POST /api/r2/upload-url — mint a presigned R2 PUT URL.
//
// Body: { key: string, contentType: string }
//   key must match listings/{uid}/{listingId}/{filename} (validated).
//
// Auth: the caller must be signed in (Firebase ID token in Authorization
// header) and the {uid} segment must equal the token's uid. This prevents
// one user from uploading into another user's prefix.
//
// Response: { url: string, publicUrl: string }

import { NextRequest, NextResponse } from 'next/server';
import { presignedUploadUrl, publicUrlFor, isValidUploadKey } from '@/lib/r2';

export async function POST(req: NextRequest) {
  let body: { key?: string; contentType?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { key, contentType, size } = body;
  if (!key || !contentType || !isValidUploadKey(key)) {
    return NextResponse.json({ error: 'invalid-key' }, { status: 400 });
  }

  // 11 Oct 2026: size must be declared and capped (15MB = client limit).
  // Signed into the URL so larger uploads are rejected by R2.
  const MAX_SIZE = 15 * 1024 * 1024;
  if (!size || typeof size !== 'number' || size <= 0 || size > MAX_SIZE) {
    return NextResponse.json({ error: 'invalid-size' }, { status: 400 });
  }

  // Allow common image MIME types only.
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
  if (!allowed.includes(contentType)) {
    return NextResponse.json({ error: 'invalid-content-type' }, { status: 400 });
  }

  // Verify the Firebase ID token and that the uid matches the key prefix.
  const authHeader = req.headers.get('authorization') || '';
  const m = authHeader.match(/^Bearer (.+)$/);
  if (!m) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const idToken = m[1];
  const keyUid = key.split('/')[1];

  // Verify token via Firebase Auth REST API (no Admin SDK needed).
  // The token's `user_id` (sub) must equal the key's uid segment.
  // Email must be verified (project rule: verified email to publish/contact).
  // Public Firebase web key (also hardcoded in client files; public by design).
  // Falls back to the project key if env var is unset to avoid breaking uploads.
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
    const url = await presignedUploadUrl(key, contentType, 300, size);
    return NextResponse.json({ url, publicUrl: publicUrlFor(key) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'r2-error';
    // Don't leak credential errors verbatim in production.
    const safe = msg.includes('not configured') ? 'r2-not-configured' : 'r2-error';
    return NextResponse.json({ error: safe }, { status: 500 });
  }
}
