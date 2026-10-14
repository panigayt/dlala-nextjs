import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // 11 Oct 2026: added /search and /publish — thin/form content.
      disallow: ['/api/', '/chat/', '/conversations', '/account', '/settings', '/search', '/publish'],
    },
    sitemap: 'https://www.dzdlala.com/sitemap.xml',
  };
}
