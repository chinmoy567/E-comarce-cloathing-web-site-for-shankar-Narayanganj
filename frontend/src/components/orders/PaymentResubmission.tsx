'use client';

import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import { resubmitTransactionId, uploadPaymentProof, validateResubmission } from '@/lib/paymentProof';
import { Button } from '@/components/admin/Button';

/**
 * Lets a customer fix a bKash payment (03-payment-order §3.4). After a rejection they send a new
 * Transaction ID and/or a clearer screenshot; while the payment is only awaiting verification they
 * can still add a screenshot. Shown when the order view says resubmission is allowed. The payment
 * rejection reason is internal and is not shown here.
 *
 * The phone number that proves ownership is the one the guest looked the order up with, or — for a
 * signed-in customer — their profile phone.
 */
export function PaymentResubmission({
  orderNumber,
  paymentStatus,
  phoneNumber,
  onChanged,
}: {
  orderNumber: string;
  paymentStatus: string;
  phoneNumber?: string;
  /** Called after anything was accepted, so the page can reload the order. */
  onChanged: () => void;
}) {
  const rejected = paymentStatus === 'REJECTED';
  const [phone, setPhone] = useState(phoneNumber ?? '');
  const [transactionId, setTransactionId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (phoneNumber) {
      setPhone(phoneNumber);
      return;
    }
    apiGet<{ phone_number: string }>('/api/customer/auth/me')
      .then((me) => setPhone(me.phone_number))
      .catch(() => undefined);
  }, [phoneNumber]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const problem = validateResubmission({ paymentStatus, transactionId, file });
    if (problem) {
      setMessage({ kind: 'error', text: problem });
      return;
    }
    if (!phone) {
      setMessage({ kind: 'error', text: 'We could not confirm your phone number. Please contact us with your Order Number.' });
      return;
    }

    setBusy(true);
    let sentId = false;
    try {
      // The ID goes first: it is what moves a rejected payment back to "awaiting verification",
      // and a screenshot is accepted in either state.
      if (transactionId.trim()) {
        await resubmitTransactionId(orderNumber, phone, transactionId);
        sentId = true;
      }
      if (file) await uploadPaymentProof(orderNumber, phone, file);
      setMessage({ kind: 'ok', text: 'Thank you. We have received your payment details and will verify them shortly.' });
      setTransactionId('');
      setFile(null);
      setFileKey((k) => k + 1);
      onChanged();
    } catch (err) {
      const text = err instanceof Error || err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.';
      if (sentId) {
        // The ID is already accepted; do not make the customer send it again.
        setMessage({ kind: 'error', text: `Your Transaction ID was received, but the screenshot could not be uploaded: ${text}` });
        setTransactionId('');
        onChanged();
      } else {
        setMessage({ kind: 'error', text });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-warning p-lg" aria-labelledby="payment-resubmit-heading">
      <h2 id="payment-resubmit-heading" className="text-base font-bold text-text-primary">
        {rejected ? 'We could not verify your payment' : 'Add a payment screenshot'}
      </h2>
      <p className="mb-md mt-xs text-sm text-text-secondary">
        {rejected
          ? 'Please send the Transaction ID of your bKash payment again and/or a clear screenshot of it.'
          : 'Optional. A screenshot helps us verify your payment faster.'}
      </p>

      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        {rejected && (
          <div className="mb-lg">
            <label htmlFor="resubmit-txn" className="mb-sm block text-xs font-semibold text-text-primary">
              bKash Transaction ID
            </label>
            <input
              id="resubmit-txn"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={50}
              value={transactionId}
              disabled={busy}
              onChange={(e) => setTransactionId(e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-background px-md font-mono text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none"
            />
          </div>
        )}

        <div className="mb-lg">
          <label htmlFor="resubmit-file" className="mb-sm block text-xs font-semibold text-text-primary">
            Payment screenshot {rejected ? '(optional if you entered an ID)' : ''}
          </label>
          <input
            key={fileKey}
            id="resubmit-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-text-primary file:mr-md file:h-11 file:rounded-lg file:border-0 file:bg-primary file:px-lg file:text-sm file:font-bold file:text-white"
          />
          <p className="mt-xs text-xs text-text-secondary">JPG, PNG or WebP, up to 5 MB.</p>
        </div>

        {message && (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={`mb-md text-sm ${message.kind === 'error' ? 'text-error' : 'text-success'}`}
          >
            {message.text}
          </p>
        )}

        <Button type="submit" loading={busy}>
          {rejected ? 'Resubmit Payment' : 'Upload Screenshot'}
        </Button>
      </form>
    </section>
  );
}
