'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import { FormField } from '@/components/admin/FormField';
import { Button } from '@/components/admin/Button';

type Step = 'request' | 'confirm' | 'done';

const PHONE_PATTERN = /^01[3-9]\d{8}$/;

/**
 * Change the login mobile number (02-customer §2.6, spec 08 §Phone change): current password, then a
 * code emailed to the confirmed email address. A customer without a confirmed email is told how to
 * proceed; the server decides, this form only reflects it.
 */
export function PhoneChangeForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('request');
  const [newPhone, setNewPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otpId, setOtpId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(err: unknown) {
    setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!PHONE_PATTERN.test(newPhone)) {
      setError('Enter a valid Bangladesh mobile number, like 01XXXXXXXXX.');
      return;
    }
    setBusy(true);
    try {
      const data = await apiPost<{ otp_id: string }>('/api/customer/auth/phone-change/request', {
        new_phone_number: newPhone,
        current_password: password,
      });
      setOtpId(data.otp_id);
      setCode('');
      setStep('confirm');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost('/api/customer/auth/phone-change/confirm', {
        otp_id: otpId,
        otp_code: code,
        new_phone_number: newPhone,
      });
      setStep('done');
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-2xl border-t border-border pt-xl" aria-labelledby="phone-change-heading">
      <h2 id="phone-change-heading" className="mb-sm text-base font-semibold text-text-primary">
        Change mobile number
      </h2>
      <p className="mb-lg text-sm text-text-secondary">
        Your mobile number is your login. We email a code to your confirmed email address to approve the change.
      </p>

      {error && (
        <p role="alert" className="mb-lg text-sm text-error">
          {error}
        </p>
      )}

      {step === 'request' && (
        <form onSubmit={(e) => void requestCode(e)} noValidate>
          <FormField
            label="New mobile number"
            id="newPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            required
          />
          <FormField
            label="Current password"
            id="phoneChangePassword"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" loading={busy}>
            Send code
          </Button>
        </form>
      )}

      {step === 'confirm' && (
        <form onSubmit={(e) => void confirm(e)} noValidate>
          <p className="mb-lg text-sm text-text-secondary">
            If your details are valid, we emailed a 6-digit code. It expires in 10 minutes.
          </p>
          <FormField
            label="6-digit code"
            id="phoneChangeCode"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
          <Button type="submit" loading={busy} disabled={code.length !== 6}>
            Confirm new number
          </Button>
        </form>
      )}

      {step === 'done' && (
        <p role="status" className="text-sm text-accent">
          Your mobile number is now {newPhone}. Use it the next time you sign in.
        </p>
      )}
    </section>
  );
}
