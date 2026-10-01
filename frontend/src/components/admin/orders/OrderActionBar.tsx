'use client';

import { useState } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/admin/Button';
import { PAYMENT_REJECTION_REASONS, type AdminOrderDetail } from '@/lib/admin/orders';
import { ReasonDialog } from './ReasonDialog';

type Dialog = null | 'reject_payment' | 'cancel' | 'mark_cod_not_recoverable';

/**
 * Sticky action bar showing only the actions the backend's `allowed_actions`
 * permits for this actor and these statuses (UI convenience, never the
 * control — a 403/409 from the API is still rendered as a clear message).
 * Every action is a plain POST; the page re-fetches the order afterwards.
 */
export function OrderActionBar({ order, onChanged }: { order: AdminOrderDetail; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = new Set(order.allowed_actions);
  const base = `/api/admin/orders/${order.id}`;

  async function run(key: string, path: string, body: unknown = {}) {
    setBusy(key);
    setError(null);
    try {
      await apiPost(`${base}${path}`, body);
      setDialog(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const hasAny = order.allowed_actions.length > 0;

  return (
    <>
      {error && !dialog && (
        <p role="alert" className="mb-md rounded-lg border border-error/30 bg-error/5 p-md text-sm text-error">
          {error}
        </p>
      )}

      {hasAny && (
        <div className="sticky bottom-0 z-10 -mx-md border-t border-border bg-background p-md sm:mx-0 sm:rounded-lg sm:border">
          <div className="flex flex-col gap-sm sm:flex-row sm:flex-wrap sm:justify-end">
            {actions.has('verify_payment') && (
              <Button loading={busy === 'verify'} disabled={!!busy} onClick={() => run('verify', '/payments/verify')}>
                Verify payment
              </Button>
            )}
            {actions.has('confirm') && (
              <Button loading={busy === 'confirm'} disabled={!!busy} onClick={() => run('confirm', '/confirm')}>
                Confirm order
              </Button>
            )}
            {actions.has('cod_confirm') && (
              <Button loading={busy === 'cod'} disabled={!!busy} onClick={() => run('cod', '/cod-confirm')}>
                Confirm COD order
              </Button>
            )}
            {actions.has('start_processing') && (
              <Button loading={busy === 'processing'} disabled={!!busy} onClick={() => run('processing', '/processing')}>
                Start processing
              </Button>
            )}
            {actions.has('mark_cod_collected') && (
              <Button
                loading={busy === 'collected'}
                disabled={!!busy}
                onClick={() => run('collected', '/payment/collection', { outcome: 'COLLECTED' })}
              >
                Mark COD collected
              </Button>
            )}
            {actions.has('mark_cod_not_recoverable') && (
              <Button variant="destructive" disabled={!!busy} onClick={() => { setError(null); setDialog('mark_cod_not_recoverable'); }}>
                Mark not recoverable
              </Button>
            )}
            {actions.has('reject_payment') && (
              <Button variant="destructive" disabled={!!busy} onClick={() => { setError(null); setDialog('reject_payment'); }}>
                Reject payment
              </Button>
            )}
            {actions.has('cancel') && (
              <Button variant="destructive" disabled={!!busy} onClick={() => { setError(null); setDialog('cancel'); }}>
                Cancel order
              </Button>
            )}
          </div>
        </div>
      )}

      {dialog === 'reject_payment' && (
        <ReasonDialog
          title="Reject payment"
          description="The order stays open and the customer can resubmit. Phone the customer to explain."
          confirmLabel="Reject payment"
          reasonCodes={PAYMENT_REJECTION_REASONS}
          submitting={busy === 'reject'}
          error={error}
          onClose={() => setDialog(null)}
          onConfirm={({ reason, reasonCode }) => run('reject', '/payments/reject', { reason, reasonCode })}
        />
      )}
      {dialog === 'cancel' && (
        <ReasonDialog
          title="Cancel order"
          description="Stock is restored if the order was confirmed. Coupon usage is not restored."
          confirmLabel="Cancel order"
          submitting={busy === 'cancel'}
          error={error}
          onClose={() => setDialog(null)}
          onConfirm={({ reason }) => run('cancel', '/cancel', { reason })}
        />
      )}
      {dialog === 'mark_cod_not_recoverable' && (
        <ReasonDialog
          title="Mark COD not recoverable"
          description="The order stays Delivered; the payment is marked Rejected."
          confirmLabel="Mark not recoverable"
          submitting={busy === 'unrecoverable'}
          error={error}
          onClose={() => setDialog(null)}
          onConfirm={({ reason }) => run('unrecoverable', '/payment/collection', { outcome: 'NOT_RECOVERABLE', reason })}
        />
      )}
    </>
  );
}
