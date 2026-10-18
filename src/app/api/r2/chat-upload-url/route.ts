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
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

// Round 26 (BH-6): per-instance burst guard on minting. 30 mints/min/IP.
const MINT_LIMIT = 30;
const MINT_WINDOW_MS = 60 * 1000;

function isValidChatKey(key: string): boolean {
  if (!key || key.includes('..') || key.startsWith('/')) return false;
  const parts = key.split('/');
  if (parts.length !== 4) return false;
  if (parts[0] !== 'chat') return false;
  const safe = /^[A-Za-z0-9._-]+$/;
  return safe.test(parts[1]) && safe.test(parts[2]) && safe.test(parts[3]);
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`chat-upload-url:${clientIp(req)}`, MINT_LIMIT, MINT_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate-limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  let body: { key?: string; contentType?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { key, contentType, size } = body;
  if (!key || !contentType || !isValidChatKey(key)) {
    return NextResponse.json({ error: 'invalid-key' }, { status: 400 });
  }

  // 11 Oct 2026: size must be declared and capped (15MB = client limit).
  const MAX_SIZE = 15 * 1024 * 1024;
  if (!size || typeof size !== 'number' || size <= 0 || size > MAX_SIZE) {
    return NextResponse.json({ error: 'invalid-size' }, { status: 400 });
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
        // Round 26 (BH-2): timeout — a stalled identitytoolkit hung the
        // route until platform timeout. Matches r2-delete's verifyUid.
        signal: AbortSignal.timeout(8000),
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
    // Round 26 (BH-1): reject disabled accounts. A Firebase ID token stays
    // valid up to ~1h after disable; without this check a disabled user
    // could still mint presigned upload URLs in that window.
    if (user.disabled) {
      return NextResponse.json({ error: 'account-disabled' }, { status: 403 });
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
    const safe = msg.includes('not configured') ? 'r2-not-configured' : 'r2-error';
    return NextResponse.json({ error: safe }, { status: 500 });
  }
}

// Round 6 (18 Oct 2026): 405 with Allow header for wrong methods.
// Next.js auto-405 omits the Allow header; RFC 9110 requires it.
const METHOD_NOT_ALLOWED_POST = () =>
  NextResponse.json({ error: 'method-not-allowed' }, { status: 405, headers: { Allow: 'POST' } });
export async function GET() { return METHOD_NOT_ALLOWED_POST(); }
export async function PUT() { return METHOD_NOT_ALLOWED_POST(); }
export async function DELETE() { return METHOD_NOT_ALLOWED_POST(); }
export async function PATCH() { return METHOD_NOT_ALLOWED_POST(); }
