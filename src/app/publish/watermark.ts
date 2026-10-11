// WM-1 (16 Sep 2026): DLALA logo watermark baked into listing photos at
// publish time — verbatim port of js/publish.js drawWatermark / wmRoundRect.
// This runs before the encode, so every uploaded photo carries it — including
// the client-generated thumbnails, which makeVariant() cuts from the
// watermarked full-size canvas. Proportional to the image size: subtle on
// small photos, legible on large ones. It must NEVER break publishing,
// so every failure path is swallowed.
//
// Publish-only: legacy chat downscaleChat() and avatar uploads do NOT watermark.

export function wmRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawWatermark(
  ctx: CanvasRenderingContext2D | null | undefined,
  w: number,
  h: number
): void {
  if (!ctx || !w || !h || w < 120 || h < 120) return;
  const s = Math.max(w, h);
  const fs = Math.max(15, Math.round(s * 0.035));
  ctx.save();
  try {
    ctx.font =
      '800 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const dW = ctx.measureText('D').width;
    const lW = ctx.measureText('DLALA').width;
    const dotR = fs * 0.14,
      gap = fs * 0.3,
      padX = fs * 0.85;
    const badgeH = fs * 1.75;
    const badgeW = padX + dW + gap + dotR * 2 + gap + lW + padX;
    const m = Math.round(s * 0.03);
    const bx = Math.round(w - badgeW - m),
      by = Math.round(h - badgeH - m);
    ctx.globalAlpha = 0.03;
    ctx.fillStyle = '#0a5c3e'; // dlala deep emerald, 3% opacity (practically invisible)
    wmRoundRect(ctx, bx, by, badgeW, badgeH, badgeH / 2);
    ctx.fill();
    const cy = by + badgeH / 2;
    let cx = bx + padX;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('D', cx, cy + fs * 0.03);
    cx += dW + gap;
    ctx.fillStyle = '#e3a81c'; // gold dot
    ctx.beginPath();
    ctx.arc(cx + dotR, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    cx += dotR * 2 + gap;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('DLALA', cx, cy + fs * 0.03);
  } catch {
    /* watermark must never break publishing */
  }
  ctx.restore();
}
