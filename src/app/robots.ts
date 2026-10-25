import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // 11 Oct 2026: added /search and /publish — thin/form content.
        disallow: ['/api/', '/chat/', '/conversations', '/account', '/settings', '/search', '/publish', '/favorites'],
      },
      {
        // 25 Oct 2026: AI-training / data-mining crawlers blocked site-wide.
        // Search indexers (Googlebot, Bingbot) are NOT listed here, so
        // indexing is unaffected; Google-Extended only opts out of AI
        // training use, not Google Search.
        userAgent: ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai', 'CCBot', 'Applebot-Extended', 'PerplexityBot', 'Google-Extended', 'Meta-ExternalAgent', 'Bytespider'],
        disallow: '/',
      },
    ],
    sitemap: 'https://www.dzdlala.com/sitemap.xml',
  };
}
