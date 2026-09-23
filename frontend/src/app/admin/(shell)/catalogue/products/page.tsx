'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { apiList, ApiClientError } from '@/lib/apiClient';
import type { ProductResponse } from '@/lib/admin/types';
import type { PaginationBlock } from '@/lib/apiTypes';
import { Button } from '@/components/admin/Button';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: ProductResponse[]; pagination: PaginationBlock };

/**
 * Product list (spec 05 §Frontend work — "Product Management" screen).
 * Row: 60x60 thumbnail, 14px name, 14px #DC143C price, 12px #6B7280 stock
 * text, Active/Inactive badge, and a derived Out of Stock badge from
 * `isOutOfStock` — never a stored status (§5.1 note). Row height 80px, 12px
 * padding, 1px #E5E7EB divider. Fixed 56x56 `+` create button bottom-right.
 *
 * Reachable only when `/auth/me` includes `product.update` — the shell hides
 * the nav link otherwise, and the backend independently 403s a direct hit
 * (§5.18, `frontend` skill §3).
 */
export default function ProductsListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });

    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);

    apiList<ProductResponse>(`/api/admin/catalogue/products?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(({ data, pagination }) => setState({ phase: 'loaded', items: data, pagination }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });

    return () => controller.abort();
  }, [page, search, statusFilter]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <div className="relative">
      <div className="mb-lg flex items-center justify-between gap-md">
        <h1 className="text-xl font-bold md:text-[28px]">Products</h1>
      </div>

      <form onSubmit={handleSearchSubmit} className="mb-md flex gap-sm">
        <input
          type="search"
          placeholder="Search products…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none"
          aria-label="Search products"
        />
        <Button type="submit" variant="secondary" className="w-auto shrink-0 px-md">
          Search
        </Button>
      </form>

      <div className="mb-lg flex gap-sm overflow-x-auto" role="group" aria-label="Filter by status">
        {(
          [
            { value: '', label: 'All' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setPage(1);
              setStatusFilter(option.value);
            }}
            className={`h-11 shrink-0 rounded-lg px-md text-sm font-semibold ${
              statusFilter === option.value
                ? 'bg-primary text-white'
                : 'border border-border bg-background text-text-secondary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading products…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load products</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && (
        <p className="text-text-secondary">No products yet. Tap the + button to create one.</p>
      )}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <>
          <ul className="flex flex-col">
            {state.items.map((product) => (
              <li key={product.id} className="border-b border-border last:border-b-0">
                <Link
                  href={`/admin/catalogue/products/${product.id}`}
                  className="flex min-h-[80px] items-center gap-md p-md"
                >
                  <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-lg bg-surface text-text-tertiary">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary">{product.name}</p>
                    <p className="text-[14px] font-bold text-primary">
                      &#2547; {product.basePrice.toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {product.isOutOfStock ? 'Out of stock' : `${product.totalStock} in stock`}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-xs">
                    <span
                      className={`rounded-lg px-sm py-xs text-xs font-semibold ${
                        product.status === 'ACTIVE'
                          ? 'bg-accent/10 text-accent'
                          : 'bg-text-tertiary/10 text-text-secondary'
                      }`}
                    >
                      {product.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                    </span>
                    {product.isOutOfStock && (
                      <span className="rounded-lg bg-error/10 px-sm py-xs text-xs font-semibold text-error">
                        Out of Stock
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {state.pagination.totalPages > 1 && (
            <div className="mt-lg flex items-center justify-between gap-md">
              <Button
                type="button"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-text-secondary">
                Page {state.pagination.page} of {state.pagination.totalPages}
              </span>
              <Button
                type="button"
                variant="secondary"
                disabled={page >= state.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      <Link
        href="/admin/catalogue/products/new"
        aria-label="Add product"
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </Link>
    </div>
  );
}
