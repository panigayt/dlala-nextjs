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
  localized404Html,
} from './proxy-404';

// Round 14 (12 Oct 2026) — proxy-based REAL 404s (Zak: "نفذ 404 حقيقي").
// Verified (Round 12): notFound() in the page body or generateMetadata
// renders the not-found.tsx UI but keeps HTTP 200, because under
// cacheComponents PPR the async page body is postponed until after the
// 200 headers stream. The proxy runs BEFORE any rendering starts, so a
// Firestore existence check here can return a genuine HTTP 404.
//   - GET/HEAD /listing/:id     → documents/listings/{id} (strip ".html")
//   - GET/HEAD /seller/:uid      → documents/users/{uid} (public profile,
//     private fields moved to usersPrivate by E1, 18 Oct 2026)
//   - GET/HEAD /announcement/:id → documents/announcements/{id}
//     (+ fields.active.booleanValue must be true)
// 404/403 from the REST API → real 404 (403 = doc exists but unreadable
// with the public key, e.g. sold/hidden listings — the page treats those
// exactly like missing, same as fetchListing in src/lib/firestore.ts).
// ANY check failure (network error, timeout, throw, 5xx) → NextResponse
// .next() — FAIL OPEN. Never 404 on a transient failure; the page's own
// transient-error UI handles it at HTTP 200. Check code + timeout live
// in src/proxy-404.ts (edge-safe, no React, no firebase libs).
// The Zak-ordered trilingual 404 (Round 14). R15b BC-1: locale-aware —
// /fr/* and /en/* URLs get the French/English variant.
function trilingual404(locale: 'ar' | 'fr' | 'en' = 'ar'): NextResponse {
  return new NextResponse(localized404Html(locale), {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function proxy(req: NextRequest) {
  // I-1 (audit round 2, 18 Oct 2026): non-canonical listing URLs must 301
  // to the clean form. /listing/<id>/ (trailing slash) and //listing/<id>
  // (double slash) were serving 200 with no canonical — duplicate content.
  const rawPath = req.nextUrl.pathname;
  if (rawPath.startsWith('//')) {
    const url = req.nextUrl.clone();
    url.pathname = rawPath.replace(/^\/+/, '/');
    return NextResponse.redirect(url, 301);
  }
  const trailingSlash = rawPath.match(/^\/(listing|seller|announcement)\/([^/]+)\/$/);
  if (trailingSlash) {
    const url = req.nextUrl.clone();
    url.pathname = `/${trailingSlash[1]}/${trailingSlash[2]}`;
    return NextResponse.redirect(url, 301);
  }
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
  // 14 Oct 2026 audit R21: unknown guide slugs → real 404 (was soft-404).
  // The [slug] page's notFound() doesn't set 404 status under cacheComponents.
  const guideMatch = req.nextUrl.pathname.match(/^\/(?:(fr|en)\/)?guides\/([^/]+)\/?$/);
  if (guideMatch) {
    const gslug = guideMatch[2].toLowerCase();
    const known = ['acheter-voiture-occasion', 'controler-telephone-occasion', 'eviter-arnaques'];
    const isPriceGuide = /^prix-voitures-occasion-\d{4}$/.test(gslug);
    if (!known.includes(gslug) && !isPriceGuide) {
      return trilingual404();
    }
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    // Round 17 T8: single regex capture — the old code matched the path
    // with one regex (result used only as a truthy test) and then re-split
    // the path to extract prefix/id. One capture does both.
    const detail = req.nextUrl.pathname.match(
      /^\/(?:(fr|en)\/)?(listing|seller|announcement)\/([^/]+)\/?$/,
    );
    if (detail) {
      const [, urlLocale, prefix, rawId] = detail;
      const locale: 'ar' | 'fr' | 'en' =
        urlLocale === 'fr' ? 'fr' : urlLocale === 'en' ? 'en' : 'ar';
      // Malformed percent-encoding (e.g. /listing/%zz) can never address
      // a real document — a literal % in a doc id is %25-encoded, which
      // decodes cleanly (verified: /listing/%25zz → check → 404). And
      // Next's own dynamic-param decoding 500s on the malformed form, so
      // failing open would still 500. Answer the trilingual 404 directly.
      let id: string;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        return trilingual404(locale);
      }
      let check: 'missing' | 'exists' | 'check-failed' = 'check-failed';
      if (prefix === 'listing') {
        check = await checkDocExists('listings', stripHtmlSuffix(id));
      } else if (prefix === 'seller') {
        check = await checkDocExists('users', id);
      } else {
        // prefix === 'announcement'
        check = await checkDocExists('announcements', id, true);
      }
      if (check === 'missing') {
        return trilingual404(locale);
      }
      // R19 BC-1 (18 Oct 2026): detail pages are single-locale — the
      // /fr|en detail URLs 404 by design (see src/app/listing/[id]/page.tsx).
      // So an EXISTING (or check-failed) doc under a locale prefix renders
      // the app's not-found.tsx. Hand it the pathname via x-pathname so it
      // renders the French/English variant instead of defaulting to Arabic
      // (the design not-found.tsx's getLocale() expects).
      if (urlLocale) {
        const reqHeaders = new Headers(req.headers);
        reqHeaders.set('x-pathname', req.nextUrl.pathname);
        // Fix Round 3 (22 Oct 2026) — React errors #419/#418 root fix.
        // The old fall-through resumed the generic pathname-less PPR
        // not-found shell: the resume tree mismatched the shell (Context
        // vs Suspense → Minified React error #419, live digest 916544469)
        // and the shell's Arabic chrome hydrated against the French/
        // English client render (→ error #418). The dedicated
        // /fr|en/(listing|seller|announcement) routes now render the
        // not-found UI cleanly in a fresh per-segment render — but under
        // PPR their notFound() streams after the shell, so their HTTP
        // status is 200. The proxy owns real-404 status (Round 14), so it
        // fetches the rendered page internally (bypass header prevents
        // recursion) and re-emits it with status 404. Any failure falls
        // open to the previous fall-through.
        if (req.headers.get('x-dlala-404-render') === '1') {
          return NextResponse.next({ request: { headers: reqHeaders } });
        }
        try {
          const renderUrl = new URL(
            req.nextUrl.pathname + req.nextUrl.search,
            req.url,
          );
          const cookie = req.headers.get('cookie');
          const rendered = await fetch(renderUrl, {
            method: req.method,
            headers: {
              'x-dlala-404-render': '1',
              ...(cookie ? { cookie } : {}),
            },
          });
          if (rendered.status >= 500) throw new Error('render failed');
          const body = req.method === 'HEAD' ? null : await rendered.text();
          const headers = new Headers(rendered.headers);
          // fetch() already decompressed the body — don't let the outer
          // response claim an encoding/length the plain body doesn't have.
          headers.delete('content-encoding');
          headers.delete('content-length');
          headers.set('cache-control', 'private, no-store');
          return new NextResponse(body, { status: 404, headers });
        } catch {
          return NextResponse.next({ request: { headers: reqHeaders } });
        }
      }
      // Round 196 (F5): legacy "{id}.html" URLs serve the listing with a
      // self-canonical to the .html URL — a duplicate-content pair with the
      // clean canonical URL. 301 the .html form to the clean URL for existing
      // docs only (missing docs 404 above; check-failed falls open below).
      if (prefix === 'listing' && check === 'exists' && /\.html$/i.test(id)) {
        const url = req.nextUrl.clone();
        url.pathname = `/listing/${stripHtmlSuffix(id)}`;
        return NextResponse.redirect(url, 301);
      }
      // 'check-failed' → fail open (NextResponse.next() below).
    }
  }
  // Round 43: guide pages are request-rendered (force-dynamic) so they SSR
  // fully; give them edge-cache parity with the old static output. The URL
  // fully determines the language (/fr/, /en/ prefixes — the cookie redirect
  // above already ran), so caching by URL is safe. 1h matches the price
  // guide's data cache (S-17/S-18/S-25).
  const res = NextResponse.next();
  if (/^\/(?:(?:fr|en)\/)?guides(\/|$)/.test(req.nextUrl.pathname)) {
    res.headers.set(
      'Cache-Control',
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
  }
  // 17 Oct 2026 (speed fix): Next.js defaults ISR pages to
  // `public, max-age=0, must-revalidate`, forcing every browser to
  // revalidate with the edge on each view — a wasted round-trip on weak
  // connections. Browsers get max-age=60 (feed ISR cadence); s-maxage
  // keeps edge behavior aligned with each page's revalidate
  // (listing 300s, seller/announcement/home 60s).
  const p = req.nextUrl.pathname;
  if (/^\/(listing)\/[^/]+\/?$/.test(p)) {
    // R54 (18 Oct 2026 — K-M1 root fix): listing SSR is now
    // language-invariant (Arabic); the dlala_lang cookie NO LONGER drives
    // server rendering (it applies client-side via useLang(), the Round-107
    // pattern). The old mitigations are REMOVED:
    //   - Vary: Cookie (next.config.ts + vercel.json) — never took effect
    //     live (verified 18 Oct 2026 on production AND preview).
    //   - Cache-Control: private here — the proxy runs AFTER the edge
    //     cache's store decision, so the edge cached anyway (verified:
    //     X-Vercel-Cache: HIT with growing Age on `private` responses).
    // With no cookie variance, edge caching is SAFE again: public ISR
    // (300s, matching the route's cacheLife) keeps listings fast on weak
    // connections for every locale.
    res.headers.set(
      'Cache-Control',
      'public, s-maxage=300, max-age=60, stale-while-revalidate=300'
    );
  } else if (/^\/(seller|announcement)\/[^/]+\/?$/.test(p)) {
    res.headers.set(
      'Cache-Control',
      'public, s-maxage=60, max-age=60, stale-while-revalidate=300',
    );
  } else if (p === '/' || p === '/fr' || p === '/en') {
    res.headers.set(
      'Cache-Control',
      'public, s-maxage=60, max-age=60, stale-while-revalidate=300',
    );
  }
  return res;
}

export const config = {
  matcher: [
    '/guides/prix-voitures-occasion-:year(\\d+)',
    '/fr/guides/prix-voitures-occasion-:year(\\d+)',
    '/en/guides/prix-voitures-occasion-:year(\\d+)',
    '/guides',
    '/guides/:slug*',
    '/fr/guides',
    '/fr/guides/:slug*',
    '/en/guides',
    '/en/guides/:slug*',
    // Round 14 (12 Oct 2026): proxy-based real 404s. No nested sub-routes
    // exist under these prefixes (verified: only single-segment
    // [id]/page.tsx + [uid]/page.tsx), so these intercept exactly the
    // detail URLs.
    '/listing/:id*',
    '/seller/:uid*',
    '/announcement/:id*',
    // R19 BC-1 (18 Oct 2026): the matcher is a literal-prefix match — the
    // unprefixed entries above NEVER match /fr/listing/<id> or
    // /en/listing/<id>. The (fr|en) capture inside the body regex was dead
    // code on every deploy because the middleware was never invoked for
    // these paths. These entries make the locale-aware 404 real.
    '/fr/listing/:id*',
    '/en/listing/:id*',
    '/fr/seller/:uid*',
    '/en/seller/:uid*',
    '/fr/announcement/:id*',
    '/en/announcement/:id*',
    // 17 Oct 2026 (speed fix): homepage needs the proxy to set browser
    // cache headers (max-age=60 instead of Next's default max-age=0).
    // Exact matches only — no sub-routes exist under these paths.
    '/',
    '/fr',
    '/en',
  ],
};
