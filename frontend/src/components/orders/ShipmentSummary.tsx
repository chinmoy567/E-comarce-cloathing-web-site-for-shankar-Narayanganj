import type { ShipmentBlock } from '@/lib/account';
import { safeHttpsUrl } from '@/lib/tracking';

/** Courier + tracking info once a parcel exists; otherwise the §4.14.5 "not yet created" wording. */
export function ShipmentSummary({ shipment }: { shipment: ShipmentBlock | null }) {
  const link = safeHttpsUrl(shipment?.trackingUrl);
  return (
    <section className="rounded-lg border border-border p-lg">
      <h2 className="mb-md text-base font-bold text-text-primary">Shipment</h2>
      {shipment ? (
        <dl className="space-y-sm text-sm">
          <div className="flex justify-between gap-md">
            <dt className="text-text-secondary">Courier</dt>
            <dd className="font-medium">{shipment.courierName}</dd>
          </div>
          <div className="flex justify-between gap-md">
            <dt className="text-text-secondary">Parcel / Tracking ID</dt>
            <dd className="break-all font-mono font-medium">{shipment.trackingId}</dd>
          </div>
          {link && (
            <div>
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center font-semibold text-primary underline"
              >
                Track on {shipment.courierName || 'courier site'}
              </a>
            </div>
          )}
        </dl>
      ) : (
        <div className="space-y-xs text-sm text-text-secondary">
          <p>Shipment: Not yet created</p>
          <p>Tracking: Not available yet</p>
        </div>
      )}
    </section>
  );
}
