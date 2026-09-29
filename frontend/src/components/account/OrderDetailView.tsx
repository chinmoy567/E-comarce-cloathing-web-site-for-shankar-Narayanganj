'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import {
  courierLabel,
  formatAddressLine,
  formatDate,
  formatMoney,
  orderStatusLabel,
  paymentMethodLabel,
  paymentStatusLabel,
  shipmentStatusLabel,
  type OrderDetail,
} from '@/lib/account';
import { StatusBadge, toneFor } from './StatusBadge';

/** Customer-visible order detail (02-customer §2.9.6): status, address, items, shipment/tracking. */
export function OrderDetailView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<OrderDetail>(`/api/customer/orders/${encodeURIComponent(orderId)}`)
      .then((data) => {
        if (!cancelled) setOrder(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.push('/auth/login');
          return;
        }
        const missing = err instanceof ApiClientError && (err.status === 404 || err.status === 400);
        setError(missing ? 'We could not find that order.' : 'Could not load this order.');
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, router]);

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-error p-lg text-sm text-error">
        {error}
      </p>
    );
  }
  if (!order) return <p className="text-sm text-text-secondary">Loading order…</p>;

  const { shipment, deliveryAddress: addr } = order;

  return (
    <div className="space-y-xl">
      <section className="rounded-lg border border-border p-lg">
        <p className="font-mono text-lg font-bold text-primary">{order.orderNumber}</p>
        <p className="mt-xs text-xs text-text-secondary">
          Placed on {formatDate(order.createdAt)} · {paymentMethodLabel(order.paymentMethod)}
        </p>
        <dl className="mt-lg grid grid-cols-1 gap-md text-sm sm:grid-cols-3">
          <div>
            <dt className="mb-xs text-xs text-text-secondary">Order status</dt>
            <dd>
              <StatusBadge label={orderStatusLabel(order.orderStatus)} tone={toneFor(order.orderStatus)} />
            </dd>
          </div>
          <div>
            <dt className="mb-xs text-xs text-text-secondary">Payment status</dt>
            <dd>
              <StatusBadge label={paymentStatusLabel(order.paymentStatus)} tone={toneFor(order.paymentStatus)} />
            </dd>
          </div>
          <div>
            <dt className="mb-xs text-xs text-text-secondary">Shipment status</dt>
            <dd>
              <StatusBadge
                label={shipmentStatusLabel(shipment.shipmentStatus)}
                tone={toneFor(shipment.shipmentStatus)}
              />
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-border p-lg">
        <h2 className="mb-md text-base font-bold text-text-primary">Shipment</h2>
        {shipment.courier || shipment.trackingId ? (
          <dl className="space-y-sm text-sm">
            {shipment.courier && (
              <div className="flex justify-between gap-md">
                <dt className="text-text-secondary">Courier</dt>
                <dd className="font-medium">{courierLabel(shipment.courier)}</dd>
              </div>
            )}
            {shipment.trackingId && (
              <div className="flex justify-between gap-md">
                <dt className="text-text-secondary">Parcel / Tracking ID</dt>
                <dd className="font-mono font-medium">{shipment.trackingId}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-text-secondary">A courier shipment has not been created for this order yet.</p>
        )}
      </section>

      <section className="rounded-lg border border-border p-lg">
        <h2 className="mb-md text-base font-bold text-text-primary">Delivery Address</h2>
        <p className="text-sm font-medium text-text-primary">{addr.fullName}</p>
        {addr.phoneNumber && <p className="text-sm text-text-secondary">{addr.phoneNumber}</p>}
        <p className="mt-xs text-sm text-text-primary">{formatAddressLine(addr)}</p>
      </section>

      <section className="rounded-lg border border-border p-lg">
        <h2 className="mb-md text-base font-bold text-text-primary">Items</h2>
        <ul className="divide-y divide-border">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-md py-md text-sm first:pt-0">
              <div>
                <p className="font-medium text-text-primary">{item.productName}</p>
                {item.variantDescription && <p className="text-xs text-text-secondary">{item.variantDescription}</p>}
                <p className="text-xs text-text-secondary">
                  {formatMoney(item.unitPrice)} × {item.quantity}
                </p>
              </div>
              <p className="font-medium">{formatMoney(item.lineTotal)}</p>
            </li>
          ))}
        </ul>
        <dl className="mt-md space-y-sm border-t border-border pt-md text-sm">
          <div className="flex justify-between">
            <dt className="text-text-secondary">Subtotal</dt>
            <dd>{formatMoney(order.subtotal)}</dd>
          </div>
          {order.discountAmount ? (
            <div className="flex justify-between">
              <dt className="text-text-secondary">Discount{order.couponCode ? ` (${order.couponCode})` : ''}</dt>
              <dd className="text-accent">-{formatMoney(order.discountAmount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-text-secondary">Shipping</dt>
            <dd>{formatMoney(order.shippingAmount)}</dd>
          </div>
          <div className="flex justify-between text-base font-bold">
            <dt>Total</dt>
            <dd>{formatMoney(order.totalAmount)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
