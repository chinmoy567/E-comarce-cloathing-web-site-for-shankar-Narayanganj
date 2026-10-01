'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiList, ApiClientError } from '@/lib/apiClient';
import type { PaginationBlock } from '@/lib/apiTypes';
import { Button } from '@/components/admin/Button';
import { formatDate } from '@/lib/admin/orders';
import { GuestBadge } from '@/components/admin/orders/OrderStatusBadges';

type CustomerRow = {
  id: string;
  accountType: 'GUEST' | 'REGISTERED';
  isGuest: boolean;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  orderCount: number;
  lastOrderAt: string | null;
};

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: CustomerRow[]; pagination: PaginationBlock };

/** Customer list (05-admin §5.7): registered/guest indicator, search by name/phone/email. */
export default function CustomersPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    const parts = [`page=${page}`, 'pageSize=20'];
    if (type) parts.push(`accountType=${type}`);
    if (search) parts.push(`q=${encodeURIComponent(search)}`);

    apiList<CustomerRow>(`/api/admin/customers?${parts.join('&')}`, { signal: controller.signal })
      .then(({ data, pagination }) => setState({ phase: 'loaded', items: data, pagination }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });
    return () => controller.abort();
  }, [page, type, search]);

  return (
    <div>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Customers</h1>

      <form
        className="mb-lg flex flex-col gap-sm sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
          setPage(1);
        }}
      >
        <label className="sr-only" htmlFor="customer-search">
          Search customers
        </label>
        <input
          id="customer-search"
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Name, phone or email"
          maxLength={100}
          className="h-11 w-full rounded-lg border border-border bg-background px-md text-base focus:border-2 focus:border-primary focus:outline-none sm:max-w-sm"
        />
        <label className="sr-only" htmlFor="customer-type">
          Account type
        </label>
        <select
          id="customer-type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="h-11 rounded-lg border border-border bg-background px-md text-base"
        >
          <option value="">Guest and registered</option>
          <option value="REGISTERED">Registered</option>
          <option value="GUEST">Guest</option>
        </select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading customers…</p>}
      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load customers</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}
      {state.phase === 'loaded' && state.items.length === 0 && <p className="text-text-secondary">No customers found.</p>}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <>
          <ul className="space-y-sm">
            {state.items.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/customers/${c.id}`} className="block rounded-lg border border-border bg-background p-md hover:border-primary">
                  <div className="flex items-start justify-between gap-md">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {c.fullName}
                        {c.isGuest ? <GuestBadge /> : <span className="ml-xs text-xs font-semibold text-text-secondary">Registered</span>}
                      </p>
                      <p className="text-sm text-text-secondary">{c.phoneNumber}</p>
                      {c.email && <p className="truncate text-sm text-text-secondary">{c.email}</p>}
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <p className="font-semibold">
                        {c.orderCount} {c.orderCount === 1 ? 'order' : 'orders'}
                      </p>
                      {c.lastOrderAt && <p className="text-xs text-text-secondary">Last: {formatDate(c.lastOrderAt)}</p>}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {state.pagination.totalPages > 1 && (
            <div className="mt-lg flex items-center justify-between gap-md">
              <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span className="text-sm text-text-secondary">
                Page {state.pagination.page} of {state.pagination.totalPages}
              </span>
              <Button type="button" variant="secondary" disabled={page >= state.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
