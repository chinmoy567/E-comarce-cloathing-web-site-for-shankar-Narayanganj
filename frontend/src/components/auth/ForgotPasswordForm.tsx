'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiClientError, apiPost } from '@/lib/apiClient';

type Step = 'email' | 'code' | 'password' | 'done';

const INPUT_CLASS =
  'mt-2 h-11 w-full rounded-lg border border-border bg-background px-md text-base outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary';
const BUTTON_CLASS =
  'h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Password recovery by email OTP (02-customer §2.5): email, then the emailed code, then a new
 * password. The backend answers identically for every email, so this page never says whether an
 * account exists; it only states the §2.5 requirement that an email must be on file.
 */
export function ForgotPasswordForm() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otpId, setOtpId] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'An unexpected error occurred');
    } finally {
      setBusy(false);
    }
  }

  function requestCode(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const data = await apiPost<{ otp_id: string }>('/api/customer/auth/request-otp', { email });
      setOtpId(data.otp_id);
      setCode('');
      setStep('code');
    });
  }

  function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const data = await apiPost<{ reset_token: string }>('/api/customer/auth/verify-otp', {
        otp_id: otpId,
        otp_code: code,
      });
      setResetToken(data.reset_token);
      setStep('password');
    });
  }

  function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    void run(async () => {
      await apiPost('/api/customer/auth/reset-password', { reset_token: resetToken, new_password: password });
      setStep('done');
    });
  }

  const errorBox = error && (
    <div role="alert" className="rounded-lg border border-error/30 bg-error/10 p-lg text-sm text-error">
      {error}
    </div>
  );

  if (step === 'done') {
    return (
      <div className="space-y-6 text-center">
        <div className="rounded-lg border border-success/30 bg-success/10 p-lg text-sm text-text-primary">
          Your password has been changed. Please sign in with your new password.
        </div>
        <Link href="/auth/login" className={`${BUTTON_CLASS} inline-block`}>
          Sign in
        </Link>
      </div>
    );
  }

  if (step === 'password') {
    return (
      <form onSubmit={savePassword} className="space-y-6">
        {errorBox}
        <div>
          <label htmlFor="new_password" className="block text-sm font-medium text-text-primary">
            New password
          </label>
          <input
            id="new_password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
          />
          <p className="mt-1 text-xs text-text-secondary">At least 8 characters.</p>
        </div>
        <div>
          <label htmlFor="confirm_password" className="block text-sm font-medium text-text-primary">
            Confirm new password
          </label>
          <input
            id="confirm_password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <button type="submit" disabled={busy} className={BUTTON_CLASS}>
          {busy ? 'Saving...' : 'Set new password'}
        </button>
      </form>
    );
  }

  if (step === 'code') {
    return (
      <form onSubmit={verifyCode} className="space-y-6">
        {errorBox}
        <p className="text-sm text-text-secondary">
          If an account with that email exists, we have sent a 6-digit code to it. The code expires in 10 minutes and
          works once.
        </p>
        <div>
          <label htmlFor="otp_code" className="block text-sm font-medium text-text-primary">
            6-digit code
          </label>
          <input
            id="otp_code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={`${INPUT_CLASS} tracking-widest text-lg`}
          />
        </div>
        <button type="submit" disabled={busy || code.length !== 6} className={BUTTON_CLASS}>
          {busy ? 'Checking...' : 'Verify code'}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setStep('email');
          }}
          className="w-full text-sm text-text-secondary hover:text-text-primary"
        >
          Use a different email or request a new code
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={requestCode} className="space-y-6">
      {errorBox}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-text-primary">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-xs text-text-secondary">
          Recovery works only if you have added an email address to your account.
        </p>
      </div>
      <button type="submit" disabled={busy} className={BUTTON_CLASS}>
        {busy ? 'Sending...' : 'Send code'}
      </button>
    </form>
  );
}
