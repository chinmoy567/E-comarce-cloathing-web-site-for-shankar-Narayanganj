import { ProductCard } from '@/components/ProductCard';
import type { HomepageSectionResponse } from '@/lib/publicTypes';

/**
 * PRODUCT_CAROUSEL section (13-homepage-cms §13.5, §13.6, §13.9, plan §6).
 * Renders the shared `<ProductCard/>` — never reimplemented per section
 * (§13.9). The backend already omits an empty carousel from the response
 * entirely (§13.8), but the guard below is kept as defense-in-depth against
 * an unexpected empty array.
 */
export function ProductCarousel({ section }: { section: HomepageSectionResponse }) {
  const products = section.products ?? [];
  if (products.length === 0) return null;

  return (
    <section className="flex flex-col gap-md">
      {section.title && <h2 className="text-xl font-semibold md:text-[28px]">{section.title}</h2>}
      {section.subtitle && <p className="text-text-secondary text-sm">{section.subtitle}</p>}

      <div className="grid grid-cols-2 gap-sm sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
