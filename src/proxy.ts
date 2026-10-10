// Price-guide year rollover — S-17/S-18 (0.0.0.21) parity with the
// production guides Cloud Function.
//
// The guide year rolls over automatically: the canonical slug is always
// prix-voitures-occasion-<current-year>; old-year slugs 301 to it.
// A proxy (request-time, never prerendered) is the correct place:
// the page route has generateStaticParams, and Next 16 treats new Date()
// as unstable during prerender, so a redirect inside the page component
// never fires reliably. The CF answers 301 — matched exactly here
// (Next's permanentRedirect would be 308).

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  const m = req.nextUrl.pathname.match(
    /^\/(?:(fr)\/)?guides\/(prix-voitures-occasion-(\d{4}))$/,
  );
  if (m) {
    const year = new Date().getFullYear();
    if (Number(m[3]) !== year) {
      const url = req.nextUrl.clone();
      url.pathname = `/${m[1] ? 'fr/' : ''}guides/prix-voitures-occasion-${year}`;
      return NextResponse.redirect(url, 301);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/guides/prix-voitures-occasion-:year(\\d+)',
    '/fr/guides/prix-voitures-occasion-:year(\\d+)',
  ],
};
