// PreloadLinks — Round 16 T12. Server component (no 'use client'):
// renders raw <link rel="preload" as="image"> tags via
// dangerouslySetInnerHTML so they land at the exact document position of
// this component — ahead of the images they accelerate. See
// ./preload-links.ts for why JSX <link> and ReactDOM.preload() both fail
// here. Renders an empty <div> (link elements generate no boxes).

import { preloadLinksHtml, type PreloadItem } from './preload-links';

export type { PreloadItem };

export default function PreloadLinks({ items }: { items: PreloadItem[] }) {
  const html = preloadLinksHtml(items);
  if (!html) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
