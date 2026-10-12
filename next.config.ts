import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://*.googleapis.com https://apis.google.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://img.dzdlala.com https://*.r2.dev https://firebasestorage.googleapis.com https://*.googleapis.com",
              "connect-src 'self' https://*.googleapis.com https://*.cloudfunctions.net https://*.r2.dev https://*.r2.cloudflarestorage.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
              "font-src 'self' data:",
              "frame-src 'self'",
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
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
