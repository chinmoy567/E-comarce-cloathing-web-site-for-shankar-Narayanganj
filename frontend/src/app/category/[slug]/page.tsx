import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { absoluteUrl, pageTitle } from '@/lib/site';
import { fetchCategories, fetchProducts } from '@/lib/products';
import { ProductCard } from '@/components/ProductCard';

const PAGE_SIZE = 24;

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

async function findCategory(slug: string) {
  const categories = await fetchCategories();
  return categories.find((category) => category.slug === slug) ?? null;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await findCategory(slug);
  if (!category) return { title: pageTitle('Category not found') };

  return {
    title: pageTitle(category.name),
    description: `Shop ${category.name}`,
    alternates: { canonical: absoluteUrl(`/category/${category.slug}`) },
  };
}

/**
 * Category listing — the target of homepage `CategoryGrid` tiles. Uses the
 * shared `<ProductCard />` (13-homepage-cms §13.9) and the existing public
 * products endpoint filtered by `categoryId`.
 */
export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const category = await findCategory(slug);
  if (!category) notFound();

  const page = Math.max(1, Number(pageParam) || 1);
  const { items, pagination } = await fetchProducts({ page, pageSize: PAGE_SIZE, categoryId: category.id });
  const href = (target: number) => (target > 1 ? `/category/${category.slug}?page=${target}` : `/category/${category.slug}`);

  return (
    <div className="mx-auto max-w-7xl px-lg py-2xl">
      <h1 className="mb-xl text-3xl font-bold text-text-primary md:text-4xl">{category.name}</h1>

      {items.length === 0 ? (
        <p className="py-2xl text-center text-text-secondary">No products found in this category yet.</p>
      ) : (
        <>
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

          {pagination.totalPages > 1 && (
            <nav className="mt-xl flex items-center justify-center gap-sm" aria-label="Pagination">
              {page > 1 && (
                <Link href={href(page - 1)} className="rounded-lg border border-border px-md py-sm text-sm hover:bg-surface">
                  Previous
                </Link>
              )}
              <span className="text-sm text-text-secondary">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              {page < pagination.totalPages && (
                <Link href={href(page + 1)} className="rounded-lg border border-border px-md py-sm text-sm hover:bg-surface">
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
