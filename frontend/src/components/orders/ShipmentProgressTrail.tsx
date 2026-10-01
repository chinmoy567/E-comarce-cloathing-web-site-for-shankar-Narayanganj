import { formatDate, shipmentStatusLabel } from '@/lib/account';
import { buildProgressTrail, type TrackingEvent } from '@/lib/tracking';

/**
 * Shipment lifecycle trail from the normalized events and the shipment status only. A node never shows an
 * invented time; the current node carries a text "Current" marker (not colour alone) and aria-current="step".
 * Vertical on mobile, horizontal from `md`.
 */
export function ShipmentProgressTrail({ events, currentStatus }: { events: TrackingEvent[]; currentStatus: string }) {
  const nodes = buildProgressTrail(events, currentStatus);
  return (
    <ol className="flex flex-col gap-md md:flex-row md:gap-sm" aria-label="Shipment progress">
      {nodes.map((node) => (
        <li
          key={node.status}
          aria-current={node.current ? 'step' : undefined}
          className={`flex flex-1 items-start gap-sm rounded-lg border p-md text-sm md:flex-col ${
            node.exception ? 'border-error' : node.reached ? 'border-accent' : 'border-border'
          }`}
        >
          <span
            aria-hidden="true"
            className={`mt-xs inline-block h-3 w-3 shrink-0 rounded-full ${
              node.exception ? 'bg-error' : node.reached ? 'bg-accent' : 'bg-border'
            }`}
          />
          <div className="min-w-0">
            <p className={`font-semibold ${node.reached ? 'text-text-primary' : 'text-text-secondary'}`}>
              {shipmentStatusLabel(node.status)}
              {node.current && <span className="ml-sm text-xs font-bold text-primary">Current</span>}
            </p>
            {node.occurredAt && (
              <p className="text-xs text-text-secondary">
                <time dateTime={node.occurredAt}>{formatDate(node.occurredAt)}</time>
              </p>
            )}
            {!node.reached && <p className="text-xs text-text-secondary">Pending</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
