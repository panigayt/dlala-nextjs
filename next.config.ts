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
    // 12 Oct 2026: CSP moved to middleware.ts (nonce-based, per-request).
    // Keeping only non-CSP security headers here to avoid duplicate CSP.
    return [
      {
        source: "/(.*)",
        headers: [
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
