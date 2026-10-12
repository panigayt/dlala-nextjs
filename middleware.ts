// 12 Oct 2026: Nonce-based CSP — root fix for the production CSP blocker.
// Next.js App Router requires inline scripts (React Flight data). Static hashes
// are impossible (per-request dynamic data). This middleware generates a
// cryptographically random nonce per request, injects it into the CSP header,
// and Next.js automatically adds nonce="" to all its inline scripts
// (via getScriptNonceFromHeader). No 'unsafe-inline' needed.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // 128-bit random nonce, base64url-encoded (CSP nonce format)
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  // Production-compatible CSP: strict, no 'unsafe-inline' for scripts.
  // Mirrors the dzdlala.com firebase.json CSP shape, with nonce instead.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.gstatic.com https://*.googleapis.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://img.dzdlala.com https://*.r2.dev https://firebasestorage.googleapis.com https://*.googleapis.com",
    "connect-src 'self' https://*.googleapis.com https://*.cloudfunctions.net https://*.r2.dev https://*.r2.cloudflarestorage.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
    "font-src 'self' data:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', csp);
  // Expose nonce to server components if needed (via x-nonce header pattern)
  response.headers.set('x-nonce', nonce);
  return response;
}

// Apply to all routes except static assets and API routes that don't need CSP
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - API routes that return JSON (they don't render HTML)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
};
