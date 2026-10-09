// Cloudflare R2 client — S3-compatible API.
//
// Credentials come from environment variables (set in Vercel dashboard):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
// Public URL base: R2_PUBLIC_URL (e.g. https://img.dzdlala.com)

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
  expiresIn = 300
): Promise<string> {
  const client = r2Client();
  const command = new PutObjectCommand({
    Bucket: r2Bucket(),
    Key: key,
    ContentType: contentType,
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
