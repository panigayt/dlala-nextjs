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
  let body: { key?: string; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { key, contentType } = body;
  if (!key || !contentType || !isValidUploadKey(key)) {
    return NextResponse.json({ error: 'invalid-key' }, { status: 400 });
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
  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCjll9nUDSbf9h8oS0s9xRyl1S0Qh9qO5M'}`,
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
    const uid = data?.users?.[0]?.localId;
    if (!uid || uid !== keyUid) {
      return NextResponse.json({ error: 'uid-mismatch' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'verify-failed' }, { status: 500 });
  }

  try {
    const url = await presignedUploadUrl(key, contentType);
    return NextResponse.json({ url, publicUrl: publicUrlFor(key) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'r2-error';
    // Don't leak credential errors verbatim in production.
    const safe = msg.includes('not configured') ? 'r2-not-configured' : 'r2-error';
    return NextResponse.json({ error: safe }, { status: 500 });
  }
}
