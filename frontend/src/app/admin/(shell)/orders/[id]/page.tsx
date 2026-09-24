'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { CustomerRiskSection } from '@/components/admin/orders/CustomerRiskSection';

interface OrderDetail {
  id: string;
  order_number: string;
  customer_id: string;
  payment_method: 'BKASH' | 'COD';
  order_status: string;
  payment_status: string;
  subtotal: number;
  shipping_amount: number;
  discount_amount: number | null;
  total_amount: number;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; order: OrderDetail };

export default function OrderDetailPage() {
  const params = useParams();
  const { hasPermission } = useAdminSession();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const orderId = params?.id as string;

  const canCheckRisk = hasPermission('customer.risk.check');

  useEffect(() => {
    if (!orderId) return;

    const controller = new AbortController();
    setState({ phase: 'loading' });

    apiGet<{ data: OrderDetail }>(`/api/admin/orders/${orderId}`, {
      signal: controller.signal,
    })
      .then(({ data }) => setState({ phase: 'loaded', order: data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });

    return () => controller.abort();
  }, [orderId]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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

  return (
    <div>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Order Details</h1>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading order…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load order</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && (
        <div className="space-y-xl">
          {/* Order Header */}
          <div className="rounded-lg border border-border bg-surface p-lg">
            <div className="flex items-start justify-between gap-lg mb-lg">
              <div>
                <p className="text-xs font-semibold text-text-secondary">ORDER NUMBER</p>
                <p className="mt-xs text-lg font-bold">{state.order.order_number}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-text-secondary">CREATED</p>
                <p className="mt-xs text-sm font-medium">{formatDate(state.order.created_at)}</p>
              </div>
            </div>

            <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-semibold text-text-secondary">ORDER STATUS</p>
                <div className="mt-xs">
                  <span className={`inline-block rounded-lg px-sm py-xs text-xs font-semibold ${getStatusBadgeColor(state.order.order_status)}`}>
                    {state.order.order_status}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-text-secondary">PAYMENT STATUS</p>
                <div className="mt-xs">
                  <span className={`inline-block rounded-lg px-sm py-xs text-xs font-semibold ${getPaymentStatusBadgeColor(state.order.payment_status)}`}>
                    {state.order.payment_status}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-text-secondary">PAYMENT METHOD</p>
                <p className="mt-xs text-sm font-medium">{state.order.payment_method}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-text-secondary">CUSTOMER ID</p>
                <p className="mt-xs text-sm font-medium">{state.order.customer_id}</p>
              </div>
            </div>
          </div>

          {/* Order Summary */}
          <div className="rounded-lg border border-border bg-surface p-lg">
            <h2 className="mb-lg text-lg font-bold">Order Summary</h2>
            <div className="space-y-md">
              <div className="flex justify-between">
                <span className="text-text-secondary">Subtotal</span>
                <span className="font-medium">{formatPrice(state.order.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Shipping</span>
                <span className="font-medium">{formatPrice(state.order.shipping_amount)}</span>
              </div>
              {state.order.discount_amount !== null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Discount</span>
                  <span className="font-medium text-error">-{formatPrice(state.order.discount_amount)}</span>
                </div>
              )}
              <div className="border-t border-border pt-md flex justify-between">
                <span className="font-bold">Total</span>
                <span className="font-bold text-lg">{formatPrice(state.order.total_amount)}</span>
              </div>
            </div>
          </div>

          {/* Customer Risk Section */}
          <CustomerRiskSection
            orderId={state.order.id}
            orderStatus={state.order.order_status}
            canCheck={canCheckRisk}
          />

          {/* Cancellation Info (if cancelled) */}
          {state.order.order_status === 'CANCELLED' && (
            <div className="rounded-lg border border-error/30 bg-error/5 p-lg">
              <p className="font-semibold text-error">Cancellation Details</p>
              {state.order.cancellation_reason && (
                <p className="mt-xs text-sm text-text-secondary">Reason: {state.order.cancellation_reason}</p>
              )}
              {state.order.cancelled_at && (
                <p className="mt-xs text-sm text-text-secondary">
                  Cancelled on {formatDate(state.order.cancelled_at)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
