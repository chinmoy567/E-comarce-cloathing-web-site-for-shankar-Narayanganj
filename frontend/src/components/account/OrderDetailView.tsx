'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import { formatAddressLine, formatDate, paymentMethodLabel, type OrderDetail } from '@/lib/account';
import { CustomerOrderStatusBadges } from '@/components/orders/CustomerOrderStatusBadges';
import { PurchasePixel } from '@/components/analytics/PurchasePixel';
import { OrderItemsAndAmounts } from '@/components/orders/OrderItemsAndAmounts';
import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';
import { ShipmentSummary } from '@/components/orders/ShipmentSummary';
import { TrackOrderAction } from './TrackOrderAction';

/**
 * Customer-visible order detail (02-customer §2.9.6, 04-courier §4.14.5), addressed by Order Number. A 404 is
 * the same message for "not yours" and "does not exist". The three statuses are three separate badges.
 */
export function OrderDetailView({ orderNumber }: { orderNumber: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setOrder(null);
    setError(null);
    apiGet<OrderDetail>(`/api/customer/orders/${encodeURIComponent(orderNumber)}`, { signal: controller.signal })
      .then((data) => setOrder(data))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.push('/auth/login');
          return;
        }
        const missing = err instanceof ApiClientError && err.status === 404;
        setError(missing ? 'We could not find that order.' : 'Could not load this order.');
      });
    return () => controller.abort();
  }, [orderNumber, router]);

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-error p-lg text-sm text-error">
        {error}
      </p>
    );
  }
  if (!order) return <p className="text-sm text-text-secondary">Loading order…</p>;

  const addr = order.deliveryAddress;

  return (
    <div className="space-y-xl">
      <section className="rounded-lg border border-border p-lg">
        <p className="break-all font-mono text-lg font-bold text-primary">{order.orderNumber}</p>
        <p className="mt-xs text-xs text-text-secondary">
          Placed on {formatDate(order.placedAt)} · {paymentMethodLabel(order.paymentMethod)}
        </p>
        <div className="mt-lg">
          <CustomerOrderStatusBadges
            orderStatus={order.orderStatus}
            paymentStatus={order.paymentStatus}
            shipmentStatus={order.shipmentStatus}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border p-lg">
        <h2 className="mb-md text-base font-bold text-text-primary">Tracking</h2>
        <TrackOrderAction trackOrder={order.trackOrder} />
      </section>

      <PurchasePixel order={order} />
      <ShipmentSummary shipment={order.shipment} />

      <section className="rounded-lg border border-border p-lg">
        <h2 className="mb-md text-base font-bold text-text-primary">Delivery Address</h2>
        <p className="text-sm font-medium text-text-primary">{addr.fullName}</p>
        {addr.phoneNumber && <p className="text-sm text-text-secondary">{addr.phoneNumber}</p>}
        <p className="mt-xs text-sm text-text-primary">{formatAddressLine(addr)}</p>
      </section>

      <OrderItemsAndAmounts items={order.items} amounts={order.amounts} appliedCouponCode={order.appliedCouponCode} />
      <OrderStatusTimeline history={order.statusHistory} />
    </div>
  );
}
