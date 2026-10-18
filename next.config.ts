import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Round 43 (15 Oct 2026): build-time year for the footer price-guide link.
  // Next 16 forbids `new Date()` inside components during static prerender
  // ("unstable value" fails the whole build — silently blocked the
  // 5e322b7/ec5982a/9025853 Vercel deploys). `env` values are evaluated here
  // in Node at config load and inlined as string literals, so components
  // read a constant — prerender-safe. Refreshes on every build (Vercel
  // rebuilds on each push); the proxy 301-redirects stale year slugs.
  env: {
    DLALA_BUILD_YEAR: String(new Date().getFullYear()),
  },
  // 11 Oct 2026: Speed optimizations for weak internet (Zak's order).
  // Images: modern formats (AVIF/WebP), responsive sizes, lazy by default.
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 31536000, // 1 year — images are content-hashed
  },
  // Compress responses (gzip/brotli) — critical for slow connections.
  compress: true,
  // Reduce JS: optimize imports from heavy libraries.
  experimental: {
    optimizePackageImports: ['firebase'],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    // CSP via next.config headers (proven on Vercel).
    // 12 Oct 2026: img.dzdlala.com added — listing photos were blocked.
    return [
      {
        // K-M1 (audit round 2, 18 Oct 2026): listing bodies render in the
        // dlala_lang cookie language (ar/fr/en). The edge cache must vary
        // by Cookie, or it serves whichever language rendered first to all
        // users. proxy.ts cannot set this (Next.js overwrites Vary after
        // the proxy runs); next.config headers are applied last and win.
        // Includes Next.js's own Vary tokens (rsc, next-router-*) so
        // client-side navigation keeps working.
        source: "/listing/:id*",
        headers: [
          {
            key: "Vary",
            value:
              "Cookie, rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch",
          },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://*.googleapis.com https://apis.google.com",
              "style-src 'self' 'unsafe-inline'",
              // 17 Oct 2026 (audit: "CSP img-src wildcard" — reviewed, KEPT).
              // There is no open wildcard (`*` / bare `https:`); the two
              // subdomain wildcards are scoped and load-bearing:
              // - https://*.r2.dev — user-uploaded listing photos are served
              //   from the R2 public bucket whose host is dynamic per
              //   R2_PUBLIC_URL (e.g. pub-<id>.r2.dev); it cannot be pinned
              //   to a single host without breaking all listing images.
              // - https://*.googleapis.com — Google-hosted images (e.g.
              //   profile photos from Google sign-in).
              // https://firebasestorage.googleapis.com covers legacy
              // listing photos; img.dzdlala.com / dzdlala.com are
              // first-party. Tightening further would break images.
              "img-src 'self' data: blob: https://dzdlala.com https://img.dzdlala.com https://*.r2.dev https://firebasestorage.googleapis.com https://*.googleapis.com",
              "connect-src 'self' https://*.googleapis.com https://*.cloudfunctions.net https://*.r2.dev https://*.r2.cloudflarestorage.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
              "font-src 'self' data:",
              "frame-src 'self' https://dlala-85cea.firebaseapp.com", // 13 Oct 2026: allow Firebase Auth iframe (preventive; blocks popup/redirect flows otherwise).
              "frame-ancestors 'self'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            // 17 Oct 2026 (audit: HSTS missing includeSubDomains/preload).
            // Vercel's platform default is `max-age=63072000`; this explicit
            // header overrides it. includeSubDomains + preload are a
            // deliberate commitment: the audit verified full HTTPS
            // (complete redirect chain, zero mixed content), and the site
            // serves img.dzdlala.com + the apex over HTTPS too.
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
