import type { Metadata } from 'next';
import Link from 'next/link';
import { pageTitle } from '@/lib/site';
import { fetchCategories, fetchProducts } from '@/lib/products';
import { toProductSummary } from '@/lib/productSummary';
import { ProductCard } from '@/components/ProductCard';
import { TrackEvent } from '@/components/TrackEvent';
import { META_EVENTS } from '@shared/analytics';

/** Search result pages are never indexed: they are unbounded, near-duplicate URLs (07 §SEO). */
export const metadata: Metadata = {
  title: pageTitle('Search'),
  robots: 'noindex, follow',
};

const PAGE_SIZE = 24;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

type SearchPageProps = { searchParams: Promise<{ q?: string; page?: string }> };

/**
 * Storefront search (spec 07; 02-customer §"search and filter products"). Server-rendered over the public
 * product endpoint. The query is rendered as escaped React text — never as HTML — which closes the
 * reflected-XSS path on the echoed term.
 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  const page = Math.max(1, Number(params.page) || 1);
  const hasQuery = q.length >= MIN_QUERY_LENGTH;

  const [{ items, pagination }, categories] = await Promise.all([
    hasQuery ? fetchProducts({ page, pageSize: PAGE_SIZE, search: q }) : Promise.resolve(null),
    fetchCategories(),
  ]).then(([result, cats]) => [result ?? { items: [], pagination: { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 } }, cats] as const);

  const pageHref = (target: number) => `/search?q=${encodeURIComponent(q)}${target > 1 ? `&page=${target}` : ''}`;

  return (
    <div className="mx-auto max-w-7xl px-lg py-2xl">
      {hasQuery && (
        <TrackEvent
          name={META_EVENTS.SEARCH}
          payload={{ search_string: q, content_type: 'product', content_ids: items.slice(0, 10).map((p) => p.id) }}
        />
      )}

      <form action="/search" method="get" role="search" className="mb-xl flex gap-sm">
        <label htmlFor="search-q" className="sr-only">
          Search products
        </label>
        <input
          id="search-q"
          type="search"
          name="q"
          defaultValue={q}
          maxLength={MAX_QUERY_LENGTH}
          placeholder="Search products..."
          className="h-11 w-full flex-1 rounded-lg border border-border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none"
        />
        <button type="submit" className="h-11 rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover">
          Search
        </button>
      </form>

      {!hasQuery ? (
        <div className="py-xl text-center text-text-secondary">
          <p>{q ? `Enter at least ${MIN_QUERY_LENGTH} characters to search.` : 'What are you looking for?'}</p>
        </div>
      ) : (
        <>
          <h1 className="mb-lg text-2xl font-bold text-text-primary">
            {pagination.total > 0 ? `${pagination.total} result${pagination.total === 1 ? '' : 's'} for ` : 'No results for '}
            &ldquo;{q}&rdquo;
          </h1>

          {items.length === 0 ? (
            <div className="py-xl text-center text-text-secondary">
              <p className="mb-md">Try a different spelling, or browse a category.</p>
              <ul className="flex flex-wrap justify-center gap-sm">
                {categories.slice(0, 8).map((category) => (
                  <li key={category.id}>
                    <Link
                      href={`/products?categoryId=${category.id}`}
                      className="inline-flex min-h-11 items-center rounded-lg border border-border px-md text-sm text-text-primary hover:border-primary"
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-sm gap-y-xl md:grid-cols-3 md:gap-x-md lg:grid-cols-4">
                {items.map((product, index) => (
                  <ProductCard key={product.id} product={toProductSummary(product)} priority={index < 4} />
                ))}
              </div>

              {pagination.totalPages > 1 && (
                <nav className="mt-xl flex items-center justify-center gap-sm" aria-label="Pagination">
                  {page > 1 && (
                    <Link href={pageHref(page - 1)} className="rounded-lg border border-border px-md py-sm text-sm text-text-primary hover:bg-surface">
                      Previous
                    </Link>
                  )}
                  <span className="text-sm text-text-secondary">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  {page < pagination.totalPages && (
                    <Link href={pageHref(page + 1)} className="rounded-lg border border-border px-md py-sm text-sm text-text-primary hover:bg-surface">
                      Next
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
