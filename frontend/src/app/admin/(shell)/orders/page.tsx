'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import type { PaginationBlock } from '@/lib/apiTypes';
import { Button } from '@/components/admin/Button';

interface OrderItem {
  id: string;
  order_number: string;
  customer_id: string;
  payment_method: 'BKASH' | 'COD';
  order_status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
}

interface OrderListResponse {
  data: OrderItem[];
  pagination: PaginationBlock;
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: OrderItem[]; pagination: PaginationBlock };

export default function OrdersListPage() {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });

    apiGet<OrderListResponse>(`/api/admin/orders?page=${page}&pageSize=20`, {
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
  }, [page]);

  const getStatusBadgeColor = (status: string) => {
    const colors: Record<string, string> = {
      PENDING_CONFIRMATION: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-blue-100 text-blue-800',
      PROCESSING: 'bg-cyan-100 text-cyan-800',
      COD_VERIFICATION_PENDING: 'bg-orange-100 text-orange-800',
      CANCELLED: 'bg-red-100 text-red-800',
      DELIVERED: 'bg-green-100 text-green-800',
      RETURNED: 'bg-purple-100 text-purple-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getPaymentStatusBadgeColor = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: 'bg-yellow-100 text-yellow-800',
      VERIFIED: 'bg-green-100 text-green-800',
      FAILED: 'bg-red-100 text-red-800',
      REJECTED: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <div>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Orders</h1>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading orders…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load orders</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && (
        <p className="text-text-secondary">No orders yet.</p>
      )}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="px-lg py-md text-left font-semibold">Order</th>
                  <th className="px-lg py-md text-left font-semibold">Customer</th>
                  <th className="px-lg py-md text-left font-semibold">Total</th>
                  <th className="px-lg py-md text-left font-semibold">Order Status</th>
                  <th className="px-lg py-md text-left font-semibold">Payment</th>
                  <th className="px-lg py-md text-left font-semibold">Date</th>
                  <th className="px-lg py-md text-left font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((order) => (
                  <tr key={order.id} className="border-b border-border hover:bg-surface/50">
                    <td className="px-lg py-md font-medium">{order.order_number}</td>
                    <td className="px-lg py-md text-text-secondary">{order.customer_id}</td>
                    <td className="px-lg py-md font-semibold">{formatPrice(order.total_amount)}</td>
                    <td className="px-lg py-md">
                      <span className={`inline-block rounded-lg px-xs py-xs text-xs font-semibold ${getStatusBadgeColor(order.order_status)}`}>
                        {order.order_status}
                      </span>
                    </td>
                    <td className="px-lg py-md">
                      <span className={`inline-block rounded-lg px-xs py-xs text-xs font-semibold ${getPaymentStatusBadgeColor(order.payment_status)}`}>
                        {order.payment_status}
                      </span>
                    </td>
                    <td className="px-lg py-md text-text-secondary">{formatDate(order.created_at)}</td>
                    <td className="px-lg py-md">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="text-primary hover:underline font-medium"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
