// Round 26 (BH-6): minimal in-memory per-instance rate limiter for the
// API POST routes. Vercel serverless instances do NOT share this state —
// this is a per-instance burst guard, not a global throttle. The highest
// abuse surface is the presigned-URL minting routes (unbounded mint count)
// and r2-delete (up to 100 keys/call).
//
// Limits are deliberately conservative; legitimate clients never hit them
// (a mint happens once per photo picked).

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 5000;

function sweep(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
    if (buckets.size <= MAX_BUCKETS) break;
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Client IP for rate-limit keying (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}
