import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site';

/** robots.txt — storefront is crawlable; back-office and customer-private routes are not (seo skill §7). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/account', '/cart', '/checkout', '/auth', '/orders', '/track-order'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
