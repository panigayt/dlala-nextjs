// 12 Oct 2026: Nonce-based CSP via Edge Middleware (Gemini-guided).
// Strictly Edge-compatible: only Web Standard APIs (no Node.js imports).
import { NextResponse } from 'next/server';

export function middleware() {
  // Web Crypto API — Edge-compatible nonce (32 hex chars = 128 bits)
  const nonce = crypto.randomUUID().replace(/-/g, '');

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
  return response;
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};
