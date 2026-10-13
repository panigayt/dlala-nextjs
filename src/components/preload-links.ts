// Raw-HTML image preload links — Round 16 T12 (T10 evidence).
//
// Two mechanisms were tried and both failed in this repo's setup
// (Next 16.4 + Turbopack + cacheComponents + PPR):
//   1. JSX <link rel="preload"> in the body (Round 14): T10 measured the
//      tags landing at ~73KB — AFTER all card <img>s — because React 19
//      treats a body <link> as a hoistable resource and flushes it late
//      in the stream, neutering the preload.
//   2. ReactDOM.preload() in a client component (the Next 16 documented
//      mechanism): a SILENT NO-OP here — no <link> tags and no Link:
//      headers in the served HTML. Probable cause: the webpack-only
//      "Alias react-dom for ReactDOM.preload usage" (webpack-config.js)
//      is not applied by the Turbopack build, so preload() never reaches
//      Fizz's head-flushing renderState.
//
// What remains is raw HTML: the <link> tags are emitted as an opaque
// string via dangerouslySetInnerHTML. React never parses the string as
// elements, so no resource-hoisting can reorder it — the bytes land at
// the exact document position of the component, which callers place
// BEFORE the images the hints accelerate. <link rel="preload"> is
// body-ok per the HTML spec, and the browser's preload scanner discovers
// the tags during initial parse, in document order.
//
// Pure + DOM-free so it stays server-side: zero client-bundle impact
// (the lazy boundary is untouched).

export interface PreloadItem {
  href: string;
  fetchPriority?: 'high' | 'low' | 'auto';
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Builds the raw <link rel="preload" as="image"> tags, in order.
// The browser decodes the entities, so the fetched URL is byte-identical
// to the href the card <img> renders (cache hit, never a wasted fetch).
export function preloadLinksHtml(items: PreloadItem[]): string {
  let out = '';
  for (const it of items) {
    if (!it.href) continue;
    out +=
      '<link rel="preload" as="image" href="' +
      escapeAttr(it.href) +
      '"' +
      (it.fetchPriority && it.fetchPriority !== 'auto'
        ? ' fetchpriority="' + it.fetchPriority + '"'
        : '') +
      '>';
  }
  return out;
}
