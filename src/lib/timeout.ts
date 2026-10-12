// Standalone timeout utility — extracted from firebase-compat.ts (11 Oct 2026).
// withTimeout was dragging the entire Firebase compat SDK (~1MB) into 25 pages
// that only needed this pure function. This file has zero Firebase imports.
export function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('deadline-exceeded'), { code: 'deadline-exceeded' })), ms)
    ),
  ]);
}
