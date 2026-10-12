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
import {
  checkDocExists,
  stripHtmlSuffix,
  TRILINGUAL_404_HTML,
} from './proxy-404';

// Round 14 (12 Oct 2026) — proxy-based REAL 404s (Zak: "نفذ 404 حقيقي").
// Verified (Round 12): notFound() in the page body or generateMetadata
// renders the not-found.tsx UI but keeps HTTP 200, because under
// cacheComponents PPR the async page body is postponed until after the
// 200 headers stream. The proxy runs BEFORE any rendering starts, so a
// Firestore existence check here can return a genuine HTTP 404.
//   - GET/HEAD /listing/:id     → documents/listings/{id} (strip ".html")
//   - GET/HEAD /seller/:uid      → documents/users_public/{uid}
//   - GET/HEAD /announcement/:id → documents/announcements/{id}
//     (+ fields.active.booleanValue must be true)
// 404/403 from the REST API → real 404 (403 = doc exists but unreadable
// with the public key, e.g. sold/hidden listings — the page treats those
// exactly like missing, same as fetchListing in src/lib/firestore.ts).
// ANY check failure (network error, timeout, throw, 5xx) → NextResponse
// .next() — FAIL OPEN. Never 404 on a transient failure; the page's own
// transient-error UI handles it at HTTP 200. Check code + timeout live
// in src/proxy-404.ts (edge-safe, no React, no firebase libs).
export async function proxy(req: NextRequest) {
  const m = req.nextUrl.pathname.match(
    /^\/(?:(fr|en)\/)?guides\/(prix-voitures-occasion-(\d{4}))$/,
  );
  if (m) {
    const year = new Date().getFullYear();
    if (Number(m[3]) !== year) {
      const url = req.nextUrl.clone();
      url.pathname = `/${m[1] ? m[1] + '/' : ''}guides/prix-voitures-occasion-${year}`;
      return NextResponse.redirect(url, 301);
    }
  }
  // Round 134: French UI users get the French guides. /guides is the Arabic
  // canonical; /fr/guides is the French one. The dlala_lang cookie (set by
  // the client on language switch) drives the redirect at request time.
  // 12 Oct 2026: same for English UI users → /en/guides.
  const langCookie = req.cookies.get('dlala_lang')?.value;
  if (langCookie === 'fr' || langCookie === 'en') {
    const gm = req.nextUrl.pathname.match(/^\/guides(\/.*)?$/);
    if (gm) {
      const url = req.nextUrl.clone();
      url.pathname = `/${langCookie}/guides${gm[1] || ''}`;
      return NextResponse.redirect(url, 307);
    }
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    const detail = req.nextUrl.pathname.match(
      /^\/(?:listing|seller|announcement)\/([^/]+)\/?$/,
    );
    if (detail) {
      const segs = req.nextUrl.pathname.split('/').filter(Boolean);
      const [prefix, rawId] = [segs[0], segs[1]];
      if (rawId) {
        const id = decodeURIComponent(rawId);
        let check: 'missing' | 'exists' | 'check-failed' = 'check-failed';
        if (prefix === 'listing') {
          check = await checkDocExists('listings', stripHtmlSuffix(id));
        } else if (prefix === 'seller') {
          check = await checkDocExists('users_public', id);
        } else if (prefix === 'announcement') {
          check = await checkDocExists('announcements', id, true);
        }
        if (check === 'missing') {
          return new NextResponse(TRILINGUAL_404_HTML, {
            status: 404,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
        // 'check-failed' → fail open (NextResponse.next() below).
      }
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/guides/prix-voitures-occasion-:year(\\d+)',
    '/fr/guides/prix-voitures-occasion-:year(\\d+)',
    '/en/guides/prix-voitures-occasion-:year(\\d+)',
    '/guides',
    '/guides/:slug*',
    '/en/guides',
    '/en/guides/:slug*',
    // Round 14 (12 Oct 2026): proxy-based real 404s. No nested sub-routes
    // exist under these prefixes (verified: only single-segment
    // [id]/page.tsx + [uid]/page.tsx), so these intercept exactly the
    // detail URLs.
    '/listing/:id*',
    '/seller/:uid*',
    '/announcement/:id*',
  ],
};
