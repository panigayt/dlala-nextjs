import type { MetadataRoute } from 'next';

// PWA manifest — 14 Oct 2026 audit R11: site had a service worker but no
// manifest, so no install prompt. Brand green #0d7a4f.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'دلالة — DLALA',
    short_name: 'دلالة',
    description: 'إعلانات مبوبة مجانية في الجزائر — Free classifieds in Algeria',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0d7a4f',
    dir: 'rtl',
    lang: 'ar',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
