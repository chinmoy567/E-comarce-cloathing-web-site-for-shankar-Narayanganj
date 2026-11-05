'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/admin/Button';
import { formatDate } from '@/lib/admin/orders';
import type { ShipmentView } from '@/lib/admin/types';

/**
 * Records the failed creation and offers Retry / Change Courier / Link parcel (04-courier §4.11).
 *
 * When the courier gave no definite answer (`retryMayDuplicate`), the parcel may already
 * exist, so the admin must check the courier's merchant panel first: either link the parcel
 * they find, or confirm there is none — only then are Retry and Change courier enabled. The
 * backend enforces the same rule (409 PARCEL_MAY_EXIST); this only explains it.
 */
export function ShipmentFailureNotice({
  shipment,
  orderNumber,
  orderStatusLabel,
  canRetry,
  canChangeCourier,
  canLink,
  disabled,
  confirmedNoParcel,
  onConfirmedNoParcelChange,
  onRetry,
  onChangeCourier,
  onLink,
}: {
  shipment: ShipmentView;
  orderNumber: string;
  orderStatusLabel: string;
  canRetry: boolean;
  canChangeCourier: boolean;
  canLink: boolean;
  disabled: boolean;
  confirmedNoParcel: boolean;
  onConfirmedNoParcelChange: (v: boolean) => void;
  onRetry: () => void;
  onChangeCourier: () => void;
  onLink: (courierOrderId: string) => void;
}) {
  const ids = useId();
  const [parcelId, setParcelId] = useState('');
  const courierName = shipment.courierName ?? shipment.lastErrorCourier ?? 'the courier';
  const mustCheck = shipment.retryMayDuplicate;
  const retryBlocked = mustCheck && !confirmedNoParcel;
  const trimmed = parcelId.trim();

  return (
    <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-md">
      <p className="font-semibold text-error">Shipment creation failed</p>
      {shipment.lastError && <p className="mt-xs text-sm">{shipment.lastError}</p>}
      <p className="mt-xs text-xs text-text-secondary">
        {shipment.lastErrorCourier ? `Courier: ${courierName}` : null}
        {shipment.lastErrorAt ? ` · ${formatDate(shipment.lastErrorAt, true)}` : null}
      </p>
      <p className="mt-sm text-sm text-text-secondary">
        The order is still {orderStatusLabel}; no payment or order change was made.
      </p>

      {mustCheck && (
        <div className="mt-md rounded-lg border border-warning/40 bg-warning/10 p-md text-sm">
          <p className="font-semibold">{courierName} may already have created this parcel</p>
          <p className="mt-xs text-text-secondary">
            {courierName} did not give a clear answer, so the parcel may exist. Retrying now could create a second
            parcel (two pickups, two charges).
          </p>
          <ol className="mt-sm list-decimal space-y-xs pl-lg">
            <li>
              Open the {courierName} merchant panel and search for order <span className="font-mono font-semibold">{orderNumber}</span>.
            </li>
            <li>If the parcel is there, paste its consignment ID below and link it.</li>
            <li>If it is not there, tick the box below, then retry.</li>
          </ol>
        </div>
      )}

      {canLink && (
        <form
          className="mt-md"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) onLink(trimmed);
          }}
        >
          <label htmlFor={`${ids}-parcel`} className="mb-xs block text-sm font-medium">
            Consignment ID from {courierName} {mustCheck ? '' : '(if you created the parcel in the courier panel)'}
          </label>
          <div className="flex flex-col gap-sm sm:flex-row">
            <input
              id={`${ids}-parcel`}
              value={parcelId}
              onChange={(e) => setParcelId(e.target.value)}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              className="h-11 flex-1 rounded-md border border-border bg-background px-md font-mono text-sm"
              placeholder="e.g. DL121224VS8TTJ"
              disabled={disabled}
            />
            <Button type="submit" variant="secondary" disabled={disabled || trimmed.length < 4}>
              Link parcel
            </Button>
          </div>
          <p className="mt-xs text-xs text-text-secondary">
            The ID is checked with {courierName} before it is saved.
          </p>
        </form>
      )}

      {mustCheck && (canRetry || canChangeCourier) && (
        <label className="mt-md flex items-start gap-sm text-sm">
          <input
            type="checkbox"
            className="mt-[3px] h-4 w-4"
            checked={confirmedNoParcel}
            onChange={(e) => onConfirmedNoParcelChange(e.target.checked)}
            disabled={disabled}
          />
          <span>
            I checked the {courierName} merchant panel and there is <strong>no</strong> parcel for order{' '}
            <span className="font-mono">{orderNumber}</span>.
          </span>
        </label>
      )}

      <div className="mt-md flex flex-col gap-sm sm:flex-row">
        {canRetry && (
          <Button variant="secondary" disabled={disabled || retryBlocked} onClick={onRetry}>
            Retry
          </Button>
        )}
        {canChangeCourier && (
          <Button variant="secondary" disabled={disabled || retryBlocked} onClick={onChangeCourier}>
            Change courier
          </Button>
        )}
      </div>
    </div>
  );
}
