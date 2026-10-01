import { orderStatusLabel, paymentStatusLabel, shipmentStatusLabel } from '@/lib/account';
import { StatusBadge, toneFor } from '@/components/account/StatusBadge';

/**
 * Order, payment and shipment status as THREE separate badges (07 §5.21.11) — never merged and never derived
 * from one another. Storefront styling; the admin `OrderStatusBadges` is back-office only.
 */
export function CustomerOrderStatusBadges({
  orderStatus,
  paymentStatus,
  shipmentStatus,
}: {
  orderStatus: string;
  paymentStatus: string;
  shipmentStatus: string;
}) {
  return (
    <dl className="grid grid-cols-1 gap-md text-sm sm:grid-cols-3">
      <div>
        <dt className="mb-xs text-xs text-text-secondary">Order status</dt>
        <dd>
          <StatusBadge label={orderStatusLabel(orderStatus)} tone={toneFor(orderStatus)} />
        </dd>
      </div>
      <div>
        <dt className="mb-xs text-xs text-text-secondary">Payment status</dt>
        <dd>
          <StatusBadge label={paymentStatusLabel(paymentStatus)} tone={toneFor(paymentStatus)} />
        </dd>
      </div>
      <div>
        <dt className="mb-xs text-xs text-text-secondary">Shipment status</dt>
        <dd>
          <StatusBadge label={shipmentStatusLabel(shipmentStatus)} tone={toneFor(shipmentStatus)} />
        </dd>
      </div>
    </dl>
  );
}
