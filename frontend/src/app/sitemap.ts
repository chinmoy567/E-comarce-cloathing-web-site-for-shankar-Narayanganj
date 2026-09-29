import type { MetadataRoute } from 'next';
import { fetchProducts } from '@/lib/products';
import { absoluteUrl } from '@/lib/site';

export const revalidate = 3600;

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** sitemap.xml — home, shop, and every public product on the canonical domain. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/products'), changeFrequency: 'daily', priority: 0.8 },
  ];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { items, pagination } = await fetchProducts({ page, pageSize: PAGE_SIZE });
    for (const product of items) {
      entries.push({ url: absoluteUrl(`/product/${product.slug}`), changeFrequency: 'weekly', priority: 0.6 });
    }
    if (page >= pagination.totalPages) break;
  }

  return entries;
}
