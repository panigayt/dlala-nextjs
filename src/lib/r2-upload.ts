// Client-side R2 upload helper.
//
// Flow:
//   1. Call /api/r2/upload-url with { key, contentType } + Firebase ID token.
//   2. PUT the file bytes directly to the presigned URL (browser → R2).
//   3. Return the public URL for storing in the listing document.

export interface R2UploadResult {
  publicUrl: string;
  key: string;
}

export async function uploadToR2(
  file: File | Blob,
  key: string,
  idToken: string,
  onProgress?: (pct: number) => void
): Promise<R2UploadResult> {
  // 1. Mint presigned URL
  const res = await fetch('/api/r2/upload-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ key, contentType: file.type || 'image/jpeg' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`upload-url-${res.status}-${data.error || 'unknown'}`);
  }
  const { url, publicUrl } = await res.json();

  // 2. PUT directly to R2
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'image/jpeg');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`r2-put-${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('r2-put-network'));
    xhr.send(file);
  });

  return { publicUrl, key };
}

// Build a safe object key: listings/{uid}/{listingId}/{filename}
export function r2KeyFor(uid: string, listingId: string, filename: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return `listings/${safe(uid)}/${safe(listingId)}/${safe(filename)}`;
}
