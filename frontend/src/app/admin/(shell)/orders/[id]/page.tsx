'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiList, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import {
  formatDate,
  formatPrice,
  statusLabel,
  type AdminOrderDetail,
  type HistoryEntry,
} from '@/lib/admin/orders';
import { CustomerRiskSection } from '@/components/admin/orders/CustomerRiskSection';
import { GuestBadge, OrderStatusBadge, PaymentStatusBadge, ShipmentStatusBadge } from '@/components/admin/orders/OrderStatusBadges';
import { OrderActionBar } from '@/components/admin/orders/OrderActionBar';
import { PaymentPanel } from '@/components/admin/orders/PaymentPanel';
import { ShipmentSection } from '@/components/admin/orders/shipment/ShipmentSection';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; order: AdminOrderDetail; history: HistoryEntry[] };

export default function OrderDetailPage() {
  const params = useParams();
  const { hasPermission } = useAdminSession();
  const orderId = params?.id as string;
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);

  const canCheckRisk = hasPermission('customer.risk.check');
  const canViewPayment = hasPermission('payment.view');

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!orderId) return;
    const controller = new AbortController();

    Promise.all([
      apiGet<AdminOrderDetail>(`/api/admin/orders/${orderId}`, { signal: controller.signal }),
      apiList<HistoryEntry>(`/api/admin/orders/${orderId}/history?pageSize=100`, { signal: controller.signal }),
    ])
      .then(([order, history]) => setState({ phase: 'loaded', order, history: history.data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });

    return () => controller.abort();
  }, [orderId, refreshKey]);

  return (
    <div>
      <Link href="/admin/orders" className="text-sm font-medium text-primary hover:underline">
        ← Orders
      </Link>
      <h1 className="mb-lg mt-sm text-xl font-bold md:text-[28px]">Order details</h1>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading order…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load order</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && (
        <OrderDetailBody
          order={state.order}
          history={state.history}
          canCheckRisk={canCheckRisk}
          canViewPayment={canViewPayment}
          refreshKey={refreshKey}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function OrderDetailBody({
  order,
  history,
  canCheckRisk,
  canViewPayment,
  refreshKey,
  onChanged,
}: {
  order: AdminOrderDetail;
  history: HistoryEntry[];
  canCheckRisk: boolean;
  canViewPayment: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const addressLine = [
    order.detailed_address,
    order.ward_unit_name && `${order.ward_unit_type === 'UNION' ? 'Union' : 'Ward'}: ${order.ward_unit_name}`,
    order.area_unit_name && `${order.area_unit_type === 'THANA' ? 'Thana' : 'Upazila'}: ${order.area_unit_name}`,
    order.district,
    order.division,
    order.postal_code,
  ].filter(Boolean);

  return (
    <div className="space-y-lg">
      {order.has_cod_collection_discrepancy && (
        <div role="status" className="rounded-lg border border-warning/50 bg-warning/10 p-lg">
          <p className="font-semibold">COD collection discrepancy</p>
          <p className="mt-xs text-sm text-text-secondary">
            This order was delivered but the cash payment is still pending collection. Resolve it using the actions below.
          </p>
        </div>
      )}

      {/* Header + the three separate statuses */}
      <section className="rounded-lg border border-border bg-surface p-lg" aria-label="Order status">
        <div className="mb-lg flex items-start justify-between gap-lg">
          <div>
            <p className="text-xs font-semibold text-text-secondary">Order number</p>
            <p className="mt-xs font-mono text-lg font-bold">{order.order_number}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-text-secondary">Placed</p>
            <p className="mt-xs text-sm font-medium">{formatDate(order.created_at, true)}</p>
          </div>
        </div>

        <div className="grid gap-md sm:grid-cols-3">
          <div>
            <p className="mb-xs text-xs font-semibold text-text-secondary">Order status</p>
            <OrderStatusBadge value={order.order_status} />
          </div>
          <div>
            <p className="mb-xs text-xs font-semibold text-text-secondary">Payment status</p>
            <PaymentStatusBadge value={order.payment_status} />
          </div>
          <div>
            <p className="mb-xs text-xs font-semibold text-text-secondary">Shipment status</p>
            <ShipmentStatusBadge value={order.shipment?.status ?? order.shipment_status} />
          </div>
        </div>
      </section>

      {/* Customer + delivery */}
      <section className="rounded-lg border border-border bg-surface p-lg" aria-labelledby="customer-heading">
        <h2 id="customer-heading" className="mb-md text-lg font-bold">
          Customer
        </h2>
        <p className="font-medium">
          {order.full_name ?? 'Unnamed customer'}
          {order.is_guest_order ? <GuestBadge /> : <span className="ml-xs text-xs font-semibold text-text-secondary">Registered</span>}
        </p>
        {order.phone_number && (
          <p className="mt-xs text-sm">
            <a href={`tel:${order.phone_number}`} className="text-primary hover:underline">
              {order.phone_number}
            </a>
          </p>
        )}
        {order.customer?.email && (
          <p className="mt-xs text-sm">
            <a href={`mailto:${order.customer.email}`} className="text-primary hover:underline">
              {order.customer.email}
            </a>
          </p>
        )}
        {addressLine.length > 0 && <p className="mt-md text-sm text-text-secondary">{addressLine.join(', ')}</p>}
        {order.customer && (
          <p className="mt-md text-sm">
            <Link href={`/admin/customers/${order.customer.id}`} className="font-medium text-primary hover:underline">
              View customer and order history
            </Link>
          </p>
        )}
        {order.internal_note && (
          <p className="mt-md rounded-lg bg-background p-md text-sm">
            <span className="font-semibold">Internal note: </span>
            {order.internal_note}
          </p>
        )}
      </section>

      {/* Items + totals */}
      <section className="rounded-lg border border-border bg-surface p-lg" aria-labelledby="items-heading">
        <h2 id="items-heading" className="mb-md text-lg font-bold">
          Items
        </h2>
        <ul className="divide-y divide-border">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-md py-md text-sm">
              <div>
                <p className="font-medium">{item.productName}</p>
                {item.variantDescription && <p className="text-text-secondary">{item.variantDescription}</p>}
                <p className="text-text-secondary">
                  {item.quantity} × {formatPrice(item.unitPrice)}
                </p>
              </div>
              <p className="font-medium">{formatPrice(item.lineTotal)}</p>
            </li>
          ))}
        </ul>

        <dl className="mt-md space-y-sm border-t border-border pt-md text-sm">
          <div className="flex justify-between">
            <dt className="text-text-secondary">Subtotal</dt>
            <dd className="font-medium">{formatPrice(order.subtotal)}</dd>
          </div>
          {order.applied_coupon && (
            <div className="flex justify-between">
              <dt className="text-text-secondary">
                Coupon <span className="font-mono">{order.applied_coupon.code}</span>
              </dt>
              <dd className="font-medium text-error">−{formatPrice(order.applied_coupon.discountAmount)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-text-secondary">Shipping</dt>
            <dd className="font-medium">{formatPrice(order.shipping_amount)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-sm text-base">
            <dt className="font-bold">Total</dt>
            <dd className="font-bold">{formatPrice(order.total_amount)}</dd>
          </div>
        </dl>
      </section>

      {canViewPayment && <PaymentPanel orderId={order.id} refreshKey={refreshKey} />}

      {canCheckRisk && <CustomerRiskSection orderNumber={order.order_number} canCheck={canCheckRisk} />}

      <ShipmentSection
        orderId={order.id}
        order={{
          paymentMethod: order.payment_method,
          orderStatus: order.order_status,
          totalAmount: order.total_amount,
          addressLines: addressLine as string[],
        }}
        onOrderChanged={onChanged}
      />

      {order.order_status === 'CANCELLED' && (
        <section className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-semibold text-error">Cancellation details</p>
          {order.cancellation_reason && <p className="mt-xs text-sm text-text-secondary">Reason: {order.cancellation_reason}</p>}
          {order.cancelled_at && <p className="mt-xs text-sm text-text-secondary">Cancelled on {formatDate(order.cancelled_at, true)}</p>}
        </section>
      )}

      {/* History timeline */}
      <section className="rounded-lg border border-border bg-surface p-lg" aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-md text-lg font-bold">
          History
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-text-secondary">No status changes yet.</p>
        ) : (
          <ol className="space-y-md border-l border-border pl-md">
            {history.map((h) => (
              <li key={h.id} className="text-sm">
                <p className="font-medium">
                  {h.status_field === 'order_status' ? 'Order' : h.status_field === 'payment_status' ? 'Payment' : 'Shipment'}:{' '}
                  {h.previous_status ? `${statusLabel(h.previous_status)} → ` : ''}
                  {statusLabel(h.new_status)}
                </p>
                <p className="text-xs text-text-secondary">
                  {formatDate(h.created_at, true)} · {h.actor_type === 'SYSTEM' ? 'System' : 'Admin/Manager'}
                </p>
                {h.reason && <p className="mt-xs text-text-secondary">{h.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <OrderActionBar order={order} onChanged={onChanged} />
    </div>
  );
}
