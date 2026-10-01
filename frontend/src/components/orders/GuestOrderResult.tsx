import Link from 'next/link';
import { formatDate, paymentMethodLabel, type CustomerOrderView } from '@/lib/account';
import { CustomerOrderStatusBadges } from './CustomerOrderStatusBadges';
import { OrderItemsAndAmounts } from './OrderItemsAndAmounts';
import { OrderStatusTimeline } from './OrderStatusTimeline';
import { ShipmentSummary } from './ShipmentSummary';

/** Result of a guest lookup — exactly the §2.9.6 field set the backend returns. */
export function GuestOrderResult({ order }: { order: CustomerOrderView }) {
  return (
    <div className="mt-xl space-y-xl">
      <section className="rounded-lg border border-border p-lg">
        <h2 tabIndex={-1} id="guest-order-result" className="break-all font-mono text-lg font-bold text-primary outline-none">
          {order.orderNumber}
        </h2>
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

      <ShipmentSummary shipment={order.shipment} />

      <section className="rounded-lg border border-border p-lg">
        <h2 className="mb-md text-base font-bold text-text-primary">Delivery Area</h2>
        <p className="text-sm text-text-primary">{order.deliveryAddressSummary}</p>
      </section>

      <OrderItemsAndAmounts items={order.items} amounts={order.amounts} appliedCouponCode={order.appliedCouponCode} />
      <OrderStatusTimeline history={order.statusHistory} />

      <p className="text-sm text-text-secondary">
        Have a courier Order ID or Tracking ID instead?{' '}
        <Link href="/track-order" className="font-semibold text-primary underline">
          Track Order
        </Link>
      </p>
    </div>
  );
}
