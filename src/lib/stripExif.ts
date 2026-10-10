// stripExif — ported verbatim from js/app.js (15 Sep 2026, v42).
//
// Strip EXIF (including GPS location) by re-encoding through canvas.
// Canvas encoding never carries EXIF segments, so the uploaded file cannot
// leak where the photo was taken. Used for every PUBLIC image upload
// (avatars, store cover/logo) — never upload a raw camera file publicly.
export async function stripExif(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (bitmap.close) bitmap.close();
    throw new Error('encode');
  }
  ctx.drawImage(bitmap, 0, 0);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise<Blob | null>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85)
  );
  if (!blob) throw new Error('encode');
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}

// encodePhoto — mirrors js/publish.js encodePhoto (0.0.0.1l FIX 19).
//
// WebP first; where the browser cannot encode WebP, fall back to JPEG via
// canvas. Canvas re-encoding never carries EXIF. NEVER fall back to the
// original file — that would leak EXIF (incl. GPS) into the upload.
export async function encodePhoto(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<{ blob: Blob; type: string; ext: string }> {
  try {
    const webp = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/webp', quality)
    );
    if (webp && webp.size) return { blob: webp, type: 'image/webp', ext: '.webp' };
  } catch {
    // fall through to the JPEG fallback below
  }
  const jpeg = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, 'image/jpeg', 0.85)
  );
  if (!jpeg) throw new Error('encode');
  return { blob: jpeg, type: 'image/jpeg', ext: '.jpg' };
}
