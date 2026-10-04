'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiList, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { ReportPagination } from '@/components/admin/reports/primitives';
import type { CouponUsageEntry } from '@/lib/admin/types';

const PAGE_SIZE = 20;

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: CouponUsageEntry[]; pagination: Pagination };

/**
 * Where a coupon has been redeemed (10-coupon-discount §8.30): every usage with its order, the
 * discount given and when, newest first. Shown only to an admin holding `coupon.usage.view`; the
 * order links only appear for one who may also open orders (`order.view`).
 */
export function CouponUsageList({ couponId }: { couponId: string }) {
  const { hasPermission } = useAdminSession();
  const canView = hasPermission('coupon.usage.view');
  const canOpenOrders = hasPermission('order.view');

  const [page, setPage] = useState(1);
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    setState({ phase: 'loading' });
    apiList<CouponUsageEntry>(`/api/admin/coupons/${couponId}/usages?page=${page}&pageSize=${PAGE_SIZE}`, {
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
  }, [couponId, page, canView]);

  if (!canView) return null;

  return (
    <section className="mb-2xl" aria-labelledby="coupon-usage-heading">
      <h2 id="coupon-usage-heading" className="mb-md text-base font-bold">
        Usage history
      </h2>

      {state.phase === 'loading' && <p className="text-sm text-text-secondary">Loading usage…</p>}
      {state.phase === 'error' && (
        <p role="alert" className="text-sm text-error">
          {state.message}
        </p>
      )}
      {state.phase === 'loaded' && state.items.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-lg text-sm text-text-secondary">
          This coupon has not been used yet.
        </p>
      )}
      {state.phase === 'loaded' && state.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Orders that used this coupon, newest first</caption>
              <thead className="bg-surface text-xs text-text-secondary">
                <tr>
                  <th scope="col" className="px-md py-sm font-semibold">
                    Order
                  </th>
                  <th scope="col" className="px-md py-sm font-semibold">
                    Used
                  </th>
                  <th scope="col" className="px-md py-sm text-right font-semibold">
                    Discount
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-md py-sm font-mono">
                      {canOpenOrders ? (
                        <Link href={`/admin/orders/${u.orderId}`} className="inline-flex min-h-[44px] items-center underline hover:text-primary">
                          {u.orderNumber ?? 'Open order'}
                        </Link>
                      ) : (
                        (u.orderNumber ?? '—')
                      )}
                    </td>
                    <td className="px-md py-sm text-text-secondary">{new Date(u.usedAt).toLocaleString('en-GB')}</td>
                    <td className="px-md py-sm text-right">৳{u.discountAmount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ReportPagination pagination={state.pagination} onPage={setPage} />
        </>
      )}
    </section>
  );
}
