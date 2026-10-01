import {
  formatDate,
  orderStatusLabel,
  paymentStatusLabel,
  shipmentStatusLabel,
  type StatusEvent,
} from '@/lib/account';

const KIND_LABEL: Record<StatusEvent['kind'], string> = { ORDER: 'Order', PAYMENT: 'Payment', SHIPMENT: 'Shipment' };

function statusText(event: StatusEvent): string {
  if (event.kind === 'ORDER') return orderStatusLabel(event.status);
  if (event.kind === 'PAYMENT') return paymentStatusLabel(event.status);
  return shipmentStatusLabel(event.status);
}

/**
 * Vertical timeline built ONLY from the backend's `statusHistory` (status + time). Nothing is synthesized: an
 * empty history renders no steps. The three kinds keep their own labels — they are independent statuses.
 */
export function OrderStatusTimeline({ history }: { history: StatusEvent[] }) {
  if (history.length === 0) return null;
  return (
    <section className="rounded-lg border border-border p-lg">
      <h2 className="mb-md text-base font-bold text-text-primary">Order Timeline</h2>
      <ol className="space-y-md">
        {history.map((event, i) => (
          <li key={`${event.kind}-${event.status}-${event.occurredAt}-${i}`} className="flex gap-md text-sm">
            <span aria-hidden="true" className="mt-xs text-accent">
              ✓
            </span>
            <div>
              <p className="font-medium text-text-primary">
                {KIND_LABEL[event.kind]}: {statusText(event)}
              </p>
              <p className="text-xs text-text-secondary">
                <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
