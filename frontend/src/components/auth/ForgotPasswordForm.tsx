'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiClientError, apiPost } from '@/lib/apiClient';

type Step = 'email' | 'code' | 'password' | 'done';

const INPUT_CLASS =
  'mt-2 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';
const BUTTON_CLASS =
  'w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 transition';

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
    <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
      {error}
    </div>
  );

  if (step === 'done') {
    return (
      <div className="space-y-6 text-center">
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-green-800 text-sm">
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
          <label htmlFor="new_password" className="block text-sm font-medium text-gray-700">
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
          <p className="mt-1 text-xs text-gray-500">At least 8 characters.</p>
        </div>
        <div>
          <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700">
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
        <p className="text-sm text-gray-600">
          If an account with that email exists, we have sent a 6-digit code to it. The code expires in 10 minutes and
          works once.
        </p>
        <div>
          <label htmlFor="otp_code" className="block text-sm font-medium text-gray-700">
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
          className="w-full text-sm text-gray-600 hover:text-gray-800"
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
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
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
        <p className="mt-1 text-xs text-gray-500">
          Recovery works only if you have added an email address to your account.
        </p>
      </div>
      <button type="submit" disabled={busy} className={BUTTON_CLASS}>
        {busy ? 'Sending...' : 'Send code'}
      </button>
    </form>
  );
}
