import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchHomepage } from '@/lib/homepage';
import { fetchProducts } from '@/lib/products';
import { ProductCard } from '@/components/ProductCard';
import { HomepageSection } from '@/components/homepage/HomepageSection';
import { absoluteUrl, pageTitle, SITE_DESCRIPTION, SITE_OG_IMAGE_PATH } from '@/lib/site';

/**
 * CMS-driven homepage (13-homepage-cms §13.8, §13.15, plan §6). Replaces the
 * spec-01 placeholder health-check page — this repo has no built spec-07
 * storefront landing page to preserve, so nothing pre-existing is lost.
 *
 * ISR with a 60s revalidation window, matching the public API's own
 * `Cache-Control: max-age=60`, so search engines see fully rendered section
 * content (§13.15).
 */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const { metadata } = await fetchHomepage();

  return {
    title: pageTitle(metadata?.title ?? undefined),
    description: metadata?.description ?? SITE_DESCRIPTION,
    alternates: { canonical: absoluteUrl('/') },
    openGraph: {
      title: pageTitle(metadata?.title ?? undefined),
      description: metadata?.description ?? SITE_DESCRIPTION,
      url: absoluteUrl('/'),
      images: [absoluteUrl(metadata?.ogImageUrl ?? SITE_OG_IMAGE_PATH)],
    },
  };
}

export default async function HomePage() {
  const { sections } = await fetchHomepage();

  // No published CMS sections yet: show the latest products rather than a blank page.
  if (sections.length === 0) {
    const { items } = await fetchProducts({ pageSize: 8 });
    return (
      <div className="flex flex-col gap-xl">
        <div className="flex items-end justify-between">
          <h1 className="text-2xl font-bold text-text-primary">New Arrivals</h1>
          <Link href="/products" className="text-sm font-semibold text-primary hover:underline">
            View all
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="text-text-secondary">Products are coming soon.</p>
        ) : (
          <div className="grid grid-cols-2 gap-md md:grid-cols-3 lg:grid-cols-4">
            {items.map((item, index) => (
              <ProductCard
                key={item.id}
                priority={index < 4}
                product={{
                  id: item.id,
                  name: item.name,
                  slug: item.slug,
                  imageUrl: item.imageUrl,
                  price: item.basePrice,
                  compareAtPrice: item.compareAtPrice,
                  isFeatured: item.isFeatured,
                  outOfStock: item.outOfStock,
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2xl">
      {sections.map((section, index) => (
        <HomepageSection key={section.id} section={section} priority={index === 0} />
      ))}
    </div>
  );
}
