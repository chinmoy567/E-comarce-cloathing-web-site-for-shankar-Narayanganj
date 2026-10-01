import { formatDate, shipmentStatusLabel } from '@/lib/account';
import { StatusBadge, toneFor } from '@/components/account/StatusBadge';
import type { TrackOrderFound } from '@/lib/trackOrderTypes';
import { safeHttpsUrl } from '@/lib/tracking';
import { ShipmentProgressTrail } from './ShipmentProgressTrail';

/**
 * A found Track Order result. Shows ONLY shipment information (§4.14.6): never an order status, order number,
 * payment data, full address or internal id.
 */
export function TrackingResult({ result }: { result: TrackOrderFound }) {
  const link = safeHttpsUrl(result.courierTrackingUrl);
  return (
    <section className="mt-xl space-y-lg rounded-lg border border-border p-lg">
      <header>
        <h2 tabIndex={-1} id="track-order-result" className="break-all font-mono text-lg font-bold text-primary outline-none">
          {result.trackingId}
        </h2>
        <p className="mt-xs text-sm text-text-secondary">{result.courierName}</p>
        <div className="mt-md">
          <StatusBadge label={shipmentStatusLabel(result.shipmentStatus)} tone={toneFor(result.shipmentStatus)} />
        </div>
      </header>

      <ShipmentProgressTrail events={result.events} currentStatus={result.shipmentStatus} />

      <dl className="space-y-sm text-sm">
        {result.estimatedDeliveryAt && (
          <div className="flex justify-between gap-md">
            <dt className="text-text-secondary">Estimated delivery</dt>
            <dd className="font-medium">{formatDate(result.estimatedDeliveryAt)}</dd>
          </div>
        )}
        {result.deliveryAreaSummary && (
          <div className="flex justify-between gap-md">
            <dt className="text-text-secondary">Delivering to</dt>
            <dd className="font-medium">{result.deliveryAreaSummary}</dd>
          </div>
        )}
      </dl>

      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center font-semibold text-primary underline"
        >
          Track on {result.courierName || 'courier site'}
        </a>
      )}
    </section>
  );
}
