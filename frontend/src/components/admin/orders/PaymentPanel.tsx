'use client';

import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import { formatDate, formatPrice, type PaymentPanelData } from '@/lib/admin/orders';
import { PaymentStatusBadge } from './OrderStatusBadges';

/**
 * Payment section (05-admin §5.3): method, amount, status, the bKash
 * Transaction ID, and every payment-status change with its rejection reason
 * and time. Fetched from the `payment.view`-gated endpoint; when the actor
 * lacks that permission the API answers 403 and the section says so rather
 * than showing a partial view.
 */
export function PaymentPanel({ orderId, refreshKey }: { orderId: string; refreshKey: number }) {
  const [data, setData] = useState<PaymentPanelData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setMessage(null);
    apiGet<PaymentPanelData>(`/api/admin/orders/${orderId}/payment`, { signal: controller.signal })
      .then(setData)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setMessage(
          err instanceof ApiClientError && err.status === 403
            ? 'You do not have permission to view payment details.'
            : 'Could not load payment details.',
        );
      });
    return () => controller.abort();
  }, [orderId, refreshKey]);

  return (
    <section className="rounded-lg border border-border bg-surface p-lg" aria-labelledby="payment-heading">
      <h2 id="payment-heading" className="mb-md text-lg font-bold">
        Payment
      </h2>

      {message && <p className="text-sm text-text-secondary">{message}</p>}

      {data && (
        <div className="space-y-md">
          <div className="grid gap-md sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold text-text-secondary">Method</p>
              <p className="mt-xs text-sm font-medium">{data.method === 'BKASH' ? 'bKash' : 'Cash on delivery'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary">Amount due</p>
              <p className="mt-xs text-sm font-medium">{formatPrice(data.amountDue)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary">Status</p>
              <div className="mt-xs">
                <PaymentStatusBadge value={data.status} />
              </div>
            </div>
          </div>

          {data.method === 'BKASH' && (
            <div>
              <p className="text-xs font-semibold text-text-secondary">bKash transaction ID</p>
              <p className="mt-xs font-mono text-sm">{data.bkashTransactionId ?? 'Not submitted'}</p>
            </div>
          )}

          {data.events.length > 0 && (
            <div>
              <p className="mb-xs text-xs font-semibold text-text-secondary">Payment history</p>
              <ol className="space-y-sm border-l border-border pl-md">
                {data.events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="text-sm">
                    <PaymentStatusBadge value={e.newStatus} />
                    <span className="ml-sm text-xs text-text-secondary">{formatDate(e.at, true)}</span>
                    {e.reason && <p className="mt-xs text-text-secondary">{e.reason}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
