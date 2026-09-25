'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiList, ApiClientError } from '@/lib/apiClient';
import type { CouponResponse } from '@/lib/admin/types';
import type { PaginationBlock } from '@/lib/apiTypes';
import { Button } from '@/components/admin/Button';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: CouponResponse[]; pagination: PaginationBlock };

const DISPLAY_STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-accent/10 text-accent',
  DRAFT: 'bg-text-tertiary/10 text-text-secondary',
  SCHEDULED: 'bg-primary/10 text-primary',
  DISABLED: 'bg-text-tertiary/10 text-text-secondary',
  EXPIRED: 'bg-error/10 text-error',
  ARCHIVED: 'bg-text-tertiary/10 text-text-secondary',
};

function formatDiscount(coupon: CouponResponse): string {
  return coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}%` : `৳${coupon.discountValue}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Admin coupon list (10-coupon-discount §8.2, §8.29, plan §6). Reachable
 * only when `/auth/me` includes `coupon.view` — the shell hides the nav link
 * otherwise, and the backend independently 403s a direct hit (§5.18).
 */
export default function CouponsListPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [discountType, setDiscountType] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });

    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) params.set('status', status);
    if (discountType) params.set('discountType', discountType);
    if (search) params.set('search', search);

    apiList<CouponResponse>(`/api/admin/coupons?${params.toString()}`, { signal: controller.signal })
      .then(({ data, pagination }) => setState({ phase: 'loaded', items: data, pagination }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });

    return () => controller.abort();
  }, [page, status, discountType, search]);

  return (
    <div>
      <div className="mb-lg flex items-center justify-between gap-md">
        <h1 className="text-xl font-bold md:text-[28px]">Coupons</h1>
        <Link href="/admin/marketing/coupons/new">
          <Button type="button">Add Coupon</Button>
        </Link>
      </div>

      <div className="mb-lg flex flex-col gap-sm sm:flex-row">
        <input
          type="search"
          placeholder="Search by code or name"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          className="h-11 flex-1 rounded-lg border border-border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="h-11 rounded-lg border border-border bg-background px-md text-base text-text-primary"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
        <select
          value={discountType}
          onChange={(e) => {
            setPage(1);
            setDiscountType(e.target.value);
          }}
          className="h-11 rounded-lg border border-border bg-background px-md text-base text-text-primary"
        >
          <option value="">All discount types</option>
          <option value="PERCENTAGE">Percentage</option>
          <option value="FIXED_AMOUNT">Fixed amount</option>
        </select>
      </div>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading coupons…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load coupons</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && (
        <p className="text-text-secondary">No coupons yet.</p>
      )}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <>
          <ul className="flex flex-col gap-sm">
            {state.items.map((coupon) => (
              <li key={coupon.id}>
                <Link
                  href={`/admin/marketing/coupons/${coupon.id}`}
                  className="flex min-h-[80px] flex-col gap-xs rounded-lg border border-border bg-background p-lg sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold text-text-primary">{coupon.code}</p>
                    <p className="text-xs text-text-secondary">
                      {formatDiscount(coupon)} · {coupon.customerEligibility.replace(/_/g, ' ')} · {formatDate(coupon.startsAt)}–
                      {formatDate(coupon.expiresAt)}
                    </p>
                    <p className="text-xs text-text-secondary">
                      Usage {coupon.usageCount}/{coupon.usageLimit ?? '∞'}
                    </p>
                  </div>
                  <span
                    className={`self-start rounded-lg px-sm py-xs text-xs font-semibold sm:self-center ${
                      DISPLAY_STATUS_STYLE[coupon.displayStatus] ?? 'bg-text-tertiary/10 text-text-secondary'
                    }`}
                  >
                    {coupon.displayStatus}
                  </span>
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
    </div>
  );
}
