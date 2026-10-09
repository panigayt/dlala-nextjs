import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/chat/', '/conversations', '/account', '/settings'],
    },
    sitemap: 'https://dlala-nextjs.vercel.app/sitemap.xml',
  };
}
