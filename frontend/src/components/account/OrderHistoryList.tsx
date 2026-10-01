'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiList, ApiClientError } from '@/lib/apiClient';
import type { PaginationBlock } from '@/lib/apiTypes';
import {
  formatDate,
  formatMoney,
  orderStatusLabel,
  paymentStatusLabel,
  shipmentStatusLabel,
  type OrderSummary,
} from '@/lib/account';
import { StatusBadge, toneFor } from './StatusBadge';

const PAGE_SIZE = 10;

/** Paginated order history (GET /api/customer/orders); each row links to the order detail. */
export function OrderHistoryList() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [pagination, setPagination] = useState<PaginationBlock | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(
    async (target: number) => {
      const ticket = ++latest.current;
      setError(null);
      try {
        const res = await apiList<OrderSummary>(`/api/customer/orders?page=${target}&pageSize=${PAGE_SIZE}`);
        if (ticket !== latest.current) return; // a newer page request superseded this one
        setOrders(res.data);
        setPagination(res.pagination);
      } catch (err) {
        if (ticket !== latest.current) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.push('/auth/login');
          return;
        }
        setError(err instanceof ApiClientError ? err.message : 'Could not load your orders.');
      }
    },
    [router],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-error p-lg text-sm text-error">
        {error}{' '}
        <button type="button" className="font-semibold underline" onClick={() => void load(page)}>
          Try again
        </button>
      </div>
    );
  }

  if (!orders) return <p className="text-sm text-text-secondary">Loading your orders…</p>;

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-border p-2xl text-center">
        <p className="mb-md text-text-secondary">You have not placed any orders yet.</p>
        <Link href="/products" className="text-sm font-semibold text-primary hover:underline">
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div>
      <ul className="space-y-md">
        {orders.map((order) => (
          <li key={order.orderNumber}>
            <Link
              href={`/account/orders/${encodeURIComponent(order.orderNumber)}`}
              className="block rounded-lg border border-border p-lg hover:border-primary"
            >
              <div className="flex items-start justify-between gap-md">
                <div>
                  <p className="font-mono text-sm font-bold text-primary">{order.orderNumber}</p>
                  <p className="mt-xs text-xs text-text-secondary">{formatDate(order.placedAt)} · {order.itemCount} item{order.itemCount === 1 ? '' : 's'}</p>
                </div>
                <p className="text-base font-bold text-text-primary">{formatMoney(order.totalAmount)}</p>
              </div>
              <dl className="mt-md grid grid-cols-1 gap-sm text-xs sm:grid-cols-3">
                <div>
                  <dt className="mb-xs text-text-secondary">Order</dt>
                  <dd>
                    <StatusBadge label={orderStatusLabel(order.orderStatus)} tone={toneFor(order.orderStatus)} />
                  </dd>
                </div>
                <div>
                  <dt className="mb-xs text-text-secondary">Payment</dt>
                  <dd>
                    <StatusBadge label={paymentStatusLabel(order.paymentStatus)} tone={toneFor(order.paymentStatus)} />
                  </dd>
                </div>
                <div>
                  <dt className="mb-xs text-text-secondary">Shipment</dt>
                  <dd>
                    <StatusBadge
                      label={shipmentStatusLabel(order.shipmentStatus)}
                      tone={toneFor(order.shipmentStatus)}
                    />
                  </dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>

      {pagination && pagination.totalPages > 1 && (
        <nav className="mt-xl flex items-center justify-between text-sm" aria-label="Order pages">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="h-11 rounded-lg border border-border px-lg font-semibold disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-text-secondary">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage(page + 1)}
            className="h-11 rounded-lg border border-border px-lg font-semibold disabled:opacity-50"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
