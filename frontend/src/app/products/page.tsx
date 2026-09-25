import type { Metadata } from 'next';
import Link from 'next/link';
import { pageTitle, absoluteUrl } from '@/lib/site';
import { fetchCategories, fetchProducts } from '@/lib/products';
import { ProductCard } from '@/components/ProductCard';
import type { PublicProductSummary } from '@/lib/publicTypes';

export const metadata: Metadata = {
  title: pageTitle('Shop'),
  description: 'Browse our collection of fashion and clothing',
  alternates: {
    canonical: absoluteUrl('/products'),
  },
};

const PAGE_SIZE = 24;

type ProductsPageProps = {
  searchParams: Promise<{ page?: string; categoryId?: string; search?: string }>;
};

/**
 * Products browse page (spec 02 §"Browse products by category", "Search and
 * filter products"). Server-rendered grid, ISR-cached via `fetchProducts()`.
 */
export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const categoryId = params.categoryId || undefined;
  const search = params.search || undefined;

  const [{ items, pagination }, categories] = await Promise.all([
    fetchProducts({ page, pageSize: PAGE_SIZE, categoryId, search }),
    fetchCategories(),
  ]);

  const buildHref = (overrides: { page?: number; categoryId?: string | null }) => {
    const next = new URLSearchParams();
    if (search) next.set('search', search);
    const nextCategoryId = overrides.categoryId === undefined ? categoryId : overrides.categoryId;
    if (nextCategoryId) next.set('categoryId', nextCategoryId);
    const nextPage = overrides.page ?? 1;
    if (nextPage > 1) next.set('page', String(nextPage));
    const qs = next.toString();
    return qs ? `/products?${qs}` : '/products';
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-lg py-2xl">
        <div className="mb-xl">
          <h1 className="text-3xl font-bold text-text-primary md:text-4xl">Shop</h1>
          <p className="mt-xs text-text-secondary">Browse our collection of fashion and clothing</p>
        </div>

        <form action="/products" method="get" className="mb-lg flex gap-sm">
          {categoryId && <input type="hidden" name="categoryId" value={categoryId} />}
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search products..."
            className="h-11 w-full flex-1 rounded-lg border border-border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            className="h-11 rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover"
          >
            Search
          </button>
        </form>

        <div className="flex flex-col gap-lg md:flex-row">
          {categories.length > 0 && (
            <aside className="md:w-56 md:shrink-0">
              <h2 className="mb-sm text-sm font-semibold text-text-primary">Categories</h2>
              <ul className="flex gap-sm overflow-x-auto md:flex-col md:overflow-visible">
                <li>
                  <Link
                    href={buildHref({ categoryId: null, page: 1 })}
                    className={`block whitespace-nowrap rounded-lg px-md py-sm text-sm ${
                      !categoryId ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface'
                    }`}
                  >
                    All Products
                  </Link>
                </li>
                {categories.map((category) => (
                  <li key={category.id}>
                    <Link
                      href={buildHref({ categoryId: category.id, page: 1 })}
                      className={`block whitespace-nowrap rounded-lg px-md py-sm text-sm ${
                        categoryId === category.id ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface'
                      }`}
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          )}

          <div className="flex-1">
            {items.length === 0 ? (
              <div className="py-2xl text-center text-text-secondary">
                <p>No products found.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-md md:grid-cols-3 lg:grid-cols-4">
                  {items.map((product, index) => (
                    <ProductCard key={product.id} product={toSummary(product)} priority={index < 4} />
                  ))}
                </div>

                {pagination.totalPages > 1 && (
                  <nav className="mt-xl flex items-center justify-center gap-sm" aria-label="Pagination">
                    {page > 1 && (
                      <Link
                        href={buildHref({ page: page - 1 })}
                        className="rounded-lg border border-border px-md py-sm text-sm text-text-primary hover:bg-surface"
                      >
                        Previous
                      </Link>
                    )}
                    <span className="text-sm text-text-secondary">
                      Page {pagination.page} of {pagination.totalPages}
                    </span>
                    {page < pagination.totalPages && (
                      <Link
                        href={buildHref({ page: page + 1 })}
                        className="rounded-lg border border-border px-md py-sm text-sm text-text-primary hover:bg-surface"
                      >
                        Next
                      </Link>
                    )}
                  </nav>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function toSummary(item: {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  isFeatured: boolean;
  outOfStock: boolean;
}): PublicProductSummary {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    imageUrl: item.imageUrl,
    price: item.basePrice,
    compareAtPrice: item.compareAtPrice,
    isFeatured: item.isFeatured,
    outOfStock: item.outOfStock,
  };
}
