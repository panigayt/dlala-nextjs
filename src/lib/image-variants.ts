// Image variant URL derivation — js/market.js variantUrlFor + js/app.js
// lqipUrlFor parity (Speed 29).
//
// Publish writes w32/w320/w640/w1024 variants next to the main photo using
// the naming convention w{width}_{ts}_{i}.webp, so variant URLs are DERIVED
// from the main photo URL — no probing, zero extra requests. Only listings
// with the photoVariants flag (R11+ publishes) get derivations; anything
// else returns '' and callers fall back to today's behavior.
//
// Pure + DOM-free (erasable TS only) so node can import it directly for
// differential tests vs the legacy functions.

const VARIANT_WIDTHS = new Set([32, 320, 640, 1024]);

// js/market.js variantUrlFor (verbatim for Firebase Storage) + the R2
// public-URL pattern the Next.js publish pipeline writes
// (https://<host>/listings/{uid}/{listingId}/{ts}_{i}.webp).
// Returns '' for anything not derivable (old listings, default images,
// data URIs, unsupported widths) — callers MUST fall back, never probe.
export function variantUrlFor(fullUrl: string, width: number): string {
  try {
    if (!VARIANT_WIDTHS.has(Number(width))) return '';
    const u = String(fullUrl || '');

    // 1) Firebase Storage — verbatim js/market.js logic.
    const m = /^(https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/)([^?#]+)/.exec(u);
    if (m) {
      let path = '';
      try {
        path = decodeURIComponent(m[2]);
      } catch {
        return '';
      }
      const pm = /^(listings\/[^/]+\/[^/]+\/)(\d+)_(\d+)$/.exec(path);
      if (!pm) return '';
      const ext = /\.jpg$/i.test(u) ? '.jpg' : '.webp'; // R11: match source format
      return m[1] + encodeURIComponent(`${pm[1]}w${width}_${pm[2]}_${pm[3]}${ext}`) + '?alt=media';
    }

    // 2) R2 public URLs — same w{width}_{ts}_{i}.webp convention, no query.
    const r = /^(https:\/\/[^/?#]+\/)(listings\/[^/]+\/[^/]+\/)(\d+)_(\d+)\.webp([?#]|$)/.exec(u);
    if (r) {
      return `${r[1]}${r[2]}w${width}_${r[3]}_${r[4]}.webp`;
    }

    return '';
  } catch {
    return '';
  }
}

// js/app.js lqipUrlFor (Speed 29): derive the 32px LQIP (low-quality image
// placeholder) URL for blur-up rendering — but ONLY when the photoVariants
// flag is set. Returns '' for anything else (old listings, non-derivable
// URLs) so callers fall back to today's behavior with zero extra requests.
export function lqipUrlFor(
  l: { photoVariants?: boolean; photoUrls?: unknown } | null | undefined
): string {
  try {
    if (!l || !l.photoVariants) return '';
    const urls = l.photoUrls;
    const full = (Array.isArray(urls) && typeof urls[0] === 'string' && urls[0]) || '';
    if (!full) return '';
    return variantUrlFor(full, 32) || '';
  } catch {
    return '';
  }
}
