'use client';

import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/admin/Button';

/**
 * bKash screenshot (05-admin §5.3): a thumbnail-sized action that opens the image full screen.
 * The image is private — its signed URL is fetched only when the admin asks to view it (and
 * again on every open), because the URL is short-lived by design.
 */
export function PaymentProofViewer({ orderId }: { orderId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function open() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await apiGet<{ url: string }>(`/api/admin/orders/${orderId}/payment/proof`);
      setUrl(res.url);
    } catch (err) {
      setMessage(
        err instanceof ApiClientError && err.status === 403
          ? 'You do not have permission to view payment details.'
          : err instanceof ApiClientError && err.status === 404
            ? 'No screenshot is available for this order.'
            : 'Could not open the screenshot. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUrl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url]);

  return (
    <div>
      <Button variant="secondary" onClick={() => void open()} loading={loading}>
        View Screenshot
      </Button>
      {message && (
        <p role="alert" className="mt-xs text-xs text-error">
          {message}
        </p>
      )}

      {url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Payment screenshot"
          className="fixed inset-0 z-50 flex flex-col bg-black/90 p-md"
        >
          <div className="mb-md flex justify-end">
            <Button variant="secondary" autoFocus onClick={() => setUrl(null)}>
              Close
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL: Next image optimisation would cache or re-fetch it */}
            <img
              src={url}
              alt="bKash payment screenshot submitted by the customer"
              className="max-h-full max-w-full object-contain"
              onError={() => {
                setUrl(null);
                setMessage('The screenshot link expired. Please open it again.');
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
