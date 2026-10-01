'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/admin/Button';
import { formatDate } from '@/lib/admin/orders';
import type { ShipmentView } from '@/lib/admin/types';

/** Records the failed creation and offers Retry / Change Courier (04-courier §4.11). */
export function ShipmentFailureNotice({
  shipment,
  orderStatusLabel,
  canRetry,
  canChangeCourier,
  disabled,
  confirmingRetry,
  onRetry,
  onConfirmRetry,
  onCancelRetry,
  onChangeCourier,
}: {
  shipment: ShipmentView;
  orderStatusLabel: string;
  canRetry: boolean;
  canChangeCourier: boolean;
  disabled: boolean;
  confirmingRetry: boolean;
  onRetry: () => void;
  onConfirmRetry: () => void;
  onCancelRetry: () => void;
  onChangeCourier: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmingRetry) return;
    const el = dialogRef.current;
    el?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRetry();
      if (e.key === 'Tab' && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>('button'));
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmingRetry, onCancelRetry]);

  return (
    <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-md">
      <p className="font-semibold text-error">Shipment creation failed</p>
      {shipment.lastError && <p className="mt-xs text-sm">{shipment.lastError}</p>}
      <p className="mt-xs text-xs text-text-secondary">
        {shipment.lastErrorCourier ? `Courier: ${shipment.courierName ?? shipment.lastErrorCourier}` : null}
        {shipment.lastErrorAt ? ` · ${formatDate(shipment.lastErrorAt, true)}` : null}
      </p>
      <p className="mt-sm text-sm text-text-secondary">
        The order is still {orderStatusLabel}; no payment or order change was made.
      </p>

      <div className="mt-md flex flex-col gap-sm sm:flex-row">
        {canRetry && (
          <Button variant="secondary" disabled={disabled} onClick={onRetry}>
            Retry
          </Button>
        )}
        {canChangeCourier && (
          <Button variant="secondary" disabled={disabled} onClick={onChangeCourier}>
            Change courier
          </Button>
        )}
      </div>

      {confirmingRetry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 p-lg">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="retry-dialog-title"
            className="w-full max-w-md rounded-lg border border-border bg-background p-lg"
          >
            <h3 id="retry-dialog-title" className="text-lg font-bold">
              Retry shipment?
            </h3>
            <p className="mt-sm text-sm text-text-secondary">
              If the courier may already have created this parcel, check the courier portal before retrying — a
              duplicate parcel is possible.
            </p>
            <div className="mt-lg flex flex-col gap-sm sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onCancelRetry}>
                Cancel
              </Button>
              <Button disabled={disabled} onClick={onConfirmRetry}>
                Retry shipment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
