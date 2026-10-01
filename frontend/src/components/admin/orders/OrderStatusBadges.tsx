import { statusLabel } from '@/lib/admin/orders';

/**
 * The three independent statuses (05-admin §5.2, frontend skill §2) always
 * render as three separate badges, never a merged one. Colour only hints at
 * outcome — the label carries the meaning.
 */
const GOOD = 'bg-success/10 text-accent';
const BAD = 'bg-error/10 text-error';
const WARN = 'bg-warning/10 text-text-primary';
const NEUTRAL = 'border border-border bg-surface text-text-secondary';

function tone(value: string): string {
  if (['DELIVERED', 'PAID_VERIFIED', 'PAID_COLLECTED', 'CONFIRMED'].includes(value)) return GOOD;
  if (['CANCELLED', 'REJECTED', 'RETURNED', 'CREATION_FAILED', 'DELIVERY_FAILED'].includes(value)) return BAD;
  if (['PENDING_CONFIRMATION', 'COD_VERIFICATION_PENDING', 'PENDING_VERIFICATION', 'PENDING_COLLECTION'].includes(value)) {
    return WARN;
  }
  return NEUTRAL;
}

function Pill({ value, prefix }: { value: string; prefix?: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-md py-xs text-xs font-semibold ${tone(value)}`}>
      {prefix ? `${prefix}: ` : ''}
      {statusLabel(value)}
    </span>
  );
}

export function OrderStatusBadge({ value, prefix }: { value: string; prefix?: string }) {
  return <Pill value={value} {...(prefix ? { prefix } : {})} />;
}

export function PaymentStatusBadge({ value, prefix }: { value: string; prefix?: string }) {
  return <Pill value={value} {...(prefix ? { prefix } : {})} />;
}

export function ShipmentStatusBadge({ value, prefix }: { value: string; prefix?: string }) {
  return <Pill value={value} {...(prefix ? { prefix } : {})} />;
}

export function GuestBadge() {
  return (
    <span className="ml-xs inline-block rounded-full border border-border bg-surface px-sm py-xs text-[11px] font-semibold text-text-secondary">
      Guest
    </span>
  );
}
