// Cloudflare R2 client — S3-compatible API.
//
// Credentials come from environment variables (set in Vercel dashboard):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
// Public URL base: R2_PUBLIC_URL (e.g. https://img.dzdlala.com)

import { S3Client, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function r2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials not configured');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function r2Bucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error('R2_BUCKET_NAME not configured');
  return bucket;
}

export function r2PublicUrl(): string {
  // e.g. https://img.dzdlala.com — must NOT end with /
  return (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
}

// Generate a presigned PUT URL for direct browser → R2 upload.
// key: object key in the bucket, e.g. "listings/{uid}/{listingId}/photo-0.webp"
// contentType: MIME type of the file being uploaded.
export async function presignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
  // 11 Oct 2026: signed ContentLength caps upload size (cost-abuse fix).
  contentLength?: number
): Promise<string> {
  const client = r2Client();
  const command = new PutObjectCommand({
    Bucket: r2Bucket(),
    Key: key,
    ContentType: contentType,
    ...(contentLength ? { ContentLength: contentLength } : {}),
  });
  return getSignedUrl(client, command, { expiresIn });
}

// Public URL for an object key.
export function publicUrlFor(key: string): string {
  return `${r2PublicUrl()}/${key}`;
}

// Validate an upload key to prevent path traversal.
// Allowed: listings/{uid}/{listingId}/{filename} where filename is safe.
export function isValidUploadKey(key: string): boolean {
  if (!key || key.includes('..') || key.startsWith('/')) return false;
  const parts = key.split('/');
  if (parts.length !== 4) return false;
  if (parts[0] !== 'listings') return false;
  // uid, listingId, filename: alphanumeric + safe chars
  const safe = /^[A-Za-z0-9._-]+$/;
  return safe.test(parts[1]) && safe.test(parts[2]) && safe.test(parts[3]);
}

// Validate a delete key and return the owning uid segment, or null.
// Allowed namespaces (same ownership model as uploads):
//   listings/{uid}/{listingId}/{filename} -> owner is parts[1]
//   chat/{convId}/{uid}/{filename}        -> owner is parts[2]
// The caller may only delete keys whose owner equals their own uid — one
// user can never delete another user's objects.
export function deleteKeyOwner(key: string): string | null {
  if (!key || key.includes('..') || key.startsWith('/')) return null;
  const parts = key.split('/');
  if (parts.length !== 4) return null;
  const safe = /^[A-Za-z0-9._-]+$/;
  if (parts[0] === 'listings') {
    if (!safe.test(parts[1]) || !safe.test(parts[2]) || !safe.test(parts[3])) return null;
    return parts[1];
  }
  if (parts[0] === 'chat') {
    if (!safe.test(parts[1]) || !safe.test(parts[2]) || !safe.test(parts[3])) return null;
    return parts[2];
  }
  return null;
}

// Normalize a client-supplied value to an R2 object key.
// Accepts a bare key or a full public URL under the configured R2 base.
// Returns null for values that are not R2 keys at all (Firebase Storage
// URLs, dzdlala.com default images, ...) — callers report those as skipped.
export function keyFromUrlOrKey(value: string): string | null {
  const v = (value || '').trim();
  if (!v) return null;
  const base = r2PublicUrl();
  if (base && v.startsWith(base + '/')) {
    const key = v.slice(base.length + 1).split('?')[0];
    return key || null;
  }
  if (/^https?:\/\//i.test(v)) return null;
  return v;
}

// Variant keys derivable from a main listing photo key.
// The publish pipeline uploads w320/w640/w1024/w32 variants whose URLs are
// NOT stored in Firestore; their keys are {prefix}_{ts}_{i}.webp next to the
// main {ts}_{i}.webp key. Deleting them here avoids silent variant orphans.
export function variantKeysFor(key: string): string[] {
  const parts = key.split('/');
  if (parts.length !== 4 || parts[0] !== 'listings') return [];
  const fname = parts[3];
  if (/^(w320_|w640_|w1024_|w32_)/.test(fname)) return [];
  if (!/^\d+_\d+\.(webp|jpg|jpeg|png)$/.test(fname)) return [];
  const dir = parts.slice(0, 3).join('/');
  return ['w320_', 'w640_', 'w1024_', 'w32_'].map((p) => `${dir}/${p}${fname}`);
}

// Delete objects from the bucket.
// Idempotent: deleting a non-existent key is not an error (S3 semantics).
// DeleteObjects supports up to 1000 keys per call.
export async function deleteR2Objects(
  keys: string[]
): Promise<{ deleted: string[]; failed: { key: string; error: string }[] }> {
  const unique = [...new Set(keys)];
  if (!unique.length) return { deleted: [], failed: [] };
  const client = r2Client();
  const res = await client.send(
    new DeleteObjectsCommand({
      Bucket: r2Bucket(),
      Delete: { Objects: unique.map((Key) => ({ Key })) },
    })
  );
  const failedSet = new Set((res.Errors || []).map((e) => e.Key || ''));
  const deleted = unique.filter((k) => !failedSet.has(k));
  const failed = unique
    .filter((k) => failedSet.has(k))
    .map((key) => ({ key, error: 'delete-failed' }));
  return { deleted, failed };
}
