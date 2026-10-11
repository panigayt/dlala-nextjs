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
  onProgress?: (pct: number) => void,
  timeoutMs = 60000
): Promise<R2UploadResult> {
  // 1. Mint presigned URL (with timeout)
  const ctrl = new AbortController();
  const t1 = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch('/api/r2/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ key, contentType: file.type || 'image/jpeg' }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t1);
    throw new Error(`upload-url-timeout`);
  }
  clearTimeout(t1);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`upload-url-${res.status}-${data.error || 'unknown'}`);
  }
  const { url, publicUrl } = await res.json();

  // 2. PUT directly to R2 (with timeout, like production putWithTimeout)
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.timeout = timeoutMs;
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
    xhr.ontimeout = () => reject(new Error('r2-put-timeout'));
    xhr.send(file);
  });

  return { publicUrl, key };
}

// Build a safe object key: listings/{uid}/{listingId}/{filename}
export function r2KeyFor(uid: string, listingId: string, filename: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return `listings/${safe(uid)}/${safe(listingId)}/${safe(filename)}`;
}

export interface R2DeleteResult {
  key: string;
  status: 'deleted' | 'skipped' | 'error';
  error?: string;
}

// Delete R2 objects via POST /api/r2-delete.
// Accepts bare keys or full public URLs — the server normalizes each value,
// enforces that every key lives in the caller's own uid namespace, and
// derives+deletes unstored photo variants (w320/w640/w1024/w32).
// Best-effort: per-key failures come back in the results array; this throws
// only on transport/auth errors. The API caps keys per request; chunk here.
export async function deleteR2Objects(
  urlsOrKeys: string[],
  idToken: string
): Promise<R2DeleteResult[]> {
  const keys = (urlsOrKeys || []).filter(
    (k) => typeof k === 'string' && k.trim()
  );
  if (!keys.length || !idToken) return [];
  const out: R2DeleteResult[] = [];
  const CHUNK = 100;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const res = await fetch('/api/r2-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ keys: keys.slice(i, i + CHUNK) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`r2-delete-${res.status}-${data.error || 'unknown'}`);
    }
    const data = await res.json();
    if (Array.isArray(data.results)) out.push(...data.results);
  }
  return out;
}
