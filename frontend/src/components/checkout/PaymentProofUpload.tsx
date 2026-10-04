'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/apiClient';
import { uploadPaymentProof, validateProofFile } from '@/lib/paymentProof';

/**
 * Optional bKash screenshot upload on the order confirmation (03-payment-order §3.1: Transaction
 * ID "and/or" screenshot). The phone number that proves ownership is the guest's checkout phone,
 * or — for a signed-in customer, whose checkout does not hold it — their profile phone.
 */
export function PaymentProofUpload({ orderNumber, phoneNumber }: { orderNumber: string; phoneNumber?: string }) {
  const [phone, setPhone] = useState(phoneNumber ?? '');
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (phoneNumber) return;
    apiGet<{ phone_number: string }>('/api/customer/auth/me')
      .then((me) => setPhone(me.phone_number))
      .catch(() => undefined);
  }, [phoneNumber]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const problem = validateProofFile(file);
    if (problem) {
      setPhase('error');
      setMessage(problem);
      return;
    }
    if (!phone) {
      setPhase('error');
      setMessage('We could not confirm your phone number. Please contact us with your Order Number.');
      return;
    }

    setPhase('uploading');
    setMessage('');
    try {
      await uploadPaymentProof(orderNumber, phone, file);
      setPhase('done');
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Could not upload the screenshot.');
    }
  }

  return (
    <div className="mb-lg rounded-lg border border-border p-lg text-left">
      <p className="text-sm font-semibold text-text-primary">Add your bKash payment screenshot</p>
      <p className="mb-md mt-xs text-xs text-text-secondary">
        Optional. It helps us verify your payment faster. JPG, PNG or WebP, up to 5 MB.
      </p>
      {phase === 'done' ? (
        <p role="status" className="text-sm font-medium text-success">
          Screenshot received. We will verify your payment shortly.
        </p>
      ) : (
        <>
          <label
            htmlFor="paymentProof"
            className="flex h-[60px] w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border text-sm font-semibold text-primary"
          >
            {phase === 'uploading' ? 'Uploading…' : 'Tap to upload or take photo'}
          </label>
          <input
            id="paymentProof"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => void handleFileChange(e)}
            disabled={phase === 'uploading'}
          />
          {phase === 'error' && (
            <p role="alert" className="mt-sm text-xs text-error">
              {message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
