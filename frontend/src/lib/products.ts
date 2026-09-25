import type { PaginationBlock, PublicCategory, PublicProductDetail, PublicProductListItem } from './publicTypes';

/**
 * Server-side fetches for the public product browse/detail endpoints
 * (spec 02, plan §10). ISR-cached to match the API's own `max-age=60`.
 */

const EMPTY_LIST: { items: PublicProductListItem[]; pagination: PaginationBlock } = {
  items: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
};

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
}

export type ListProductsParams = {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  search?: string;
};

/**
 * Falls back to an empty list rather than throwing when the API is
 * unreachable — keeps `next build`'s prerender step and live degrading
 * gracefully, matching `fetchHomepage()`'s precedent.
 */
export async function fetchProducts(
  params: ListProductsParams = {},
): Promise<{ items: PublicProductListItem[]; pagination: PaginationBlock }> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.categoryId) query.set('categoryId', params.categoryId);
  if (params.search) query.set('search', params.search);

  try {
    const res = await fetch(`${apiBase()}/api/products?${query.toString()}`, { next: { revalidate: 60 } });
    if (!res.ok) return EMPTY_LIST;

    const payload = (await res.json()) as { data: PublicProductListItem[]; pagination: PaginationBlock };
    return { items: payload.data, pagination: payload.pagination };
  } catch {
    return EMPTY_LIST;
  }
}

/** Returns `null` when the product does not exist or the API is unreachable. */
export async function fetchProductBySlug(slug: string): Promise<PublicProductDetail | null> {
  try {
    const res = await fetch(`${apiBase()}/api/products/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;

    const payload = (await res.json()) as { data: PublicProductDetail };
    return payload.data;
  } catch {
    return null;
  }
}

/** Falls back to an empty list rather than throwing when the API is unreachable. */
export async function fetchCategories(): Promise<PublicCategory[]> {
  try {
    const res = await fetch(`${apiBase()}/api/categories`, { next: { revalidate: 60 } });
    if (!res.ok) return [];

    const payload = (await res.json()) as { data: PublicCategory[] };
    return payload.data;
  } catch {
    return [];
  }
}
