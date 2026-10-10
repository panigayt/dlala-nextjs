// LBZ-1 (16 Sep 2026): lightbox zoom helpers — verbatim port of the
// lbView helpers in js/listing.js:
// - Double-tap / double-click enlarges the photo (2.5x, centered on the
//   tap point via transform-origin at the tap %); dragging pans while
//   zoomed; switching photos ALWAYS resets to the normal size.
// - Pan is clamped to the zoomed overflow, measured from the image's
//   own bounding rect at pan time (same quirk as legacy).
// - Kept as DOM-agnostic helpers (img-like interface) so the math is
//   unit-testable; Gallery.tsx wires them to the real <img>.

export interface ZoomImg {
  style: { transform: string; transformOrigin: string };
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

export interface ZoomState {
  z: number;
  x: number;
  y: number;
}

/** Zoom factor — legacy lbZoomAt hardcodes 2.5. */
export const LB_ZOOM = 2.5;

/** Double-tap recognition windows — legacy touchend constants. */
export const LB_TAP_MAX_MOVE = 12; // px
export const LB_TAP_MAX_DELAY = 350; // ms
export const LB_TAP_MAX_DIST = 40; // px between the two taps
export const LB_SWIPE_MIN = 40; // px horizontal to switch photos

export function lbApplyZoom(img: ZoomImg | null, v: ZoomState): void {
  if (!img || !img.style) return;
  img.style.transform =
    v.z > 1
      ? 'translate(' + Math.round(v.x) + 'px,' + Math.round(v.y) + 'px) scale(' + v.z + ')'
      : '';
}

export function lbZoomAt(
  img: ZoomImg | null,
  v: ZoomState,
  clientX: number,
  clientY: number
): void {
  let ox = '50%',
    oy = '50%';
  try {
    const r = img ? img.getBoundingClientRect() : null;
    if (r && r.width > 0 && r.height > 0) {
      ox = (((clientX - r.left) / r.width) * 100).toFixed(1) + '%';
      oy = (((clientY - r.top) / r.height) * 100).toFixed(1) + '%';
    }
  } catch {
    /* keep center */
  }
  v.z = LB_ZOOM;
  v.x = 0;
  v.y = 0;
  if (img && img.style) img.style.transformOrigin = ox + ' ' + oy;
  lbApplyZoom(img, v);
}

export function lbZoomToggle(
  img: ZoomImg | null,
  v: ZoomState,
  clientX: number,
  clientY: number
): void {
  if (!img) return;
  if (v.z > 1) {
    lbResetZoom(img, v);
  } else {
    lbZoomAt(img, v, clientX, clientY);
  }
}

export function lbResetZoom(img: ZoomImg | null, v: ZoomState): void {
  v.z = 1;
  v.x = 0;
  v.y = 0;
  if (img && img.style) img.style.transform = '';
}

export function lbPanBy(
  img: ZoomImg | null,
  v: ZoomState,
  dx: number,
  dy: number
): void {
  if (!img || v.z <= 1) return;
  let w = 0,
    h = 0;
  try {
    const r = img.getBoundingClientRect();
    w = r.width;
    h = r.height;
  } catch {
    /* keep 0 — clamps collapse to 0 */
  }
  const mx = Math.max(0, (w * v.z - w) / 2),
    my = Math.max(0, (h * v.z - h) / 2);
  v.x = Math.max(-mx, Math.min(mx, v.x + dx));
  v.y = Math.max(-my, Math.min(my, v.y + dy));
  lbApplyZoom(img, v);
}
