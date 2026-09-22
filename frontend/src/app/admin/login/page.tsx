'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import type { AdminLoginResponse } from '@/lib/admin/types';

/**
 * Admin/Manager login (spec 03 §Frontend work).
 *
 * Idle / submitting / error / success states. The error message is always the
 * single generic string the backend returns — the endpoint deliberately gives
 * byte-identical responses for an unknown identifier, wrong password, and an
 * inactive account (§11.2), so the UI must not try to be more specific.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const { refresh } = useAdminSession();
  const [userIdentifier, setUserIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhase('submitting');
    setErrorMessage('');

    try {
      const result = await apiPost<AdminLoginResponse>('/api/admin/auth/login', {
        userIdentifier,
        password,
      });
      await refresh();
      router.replace(result.mustChangePassword ? '/admin/change-password' : '/admin');
    } catch (err) {
      setPhase('error');
      setErrorMessage(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
      );
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-lg py-2xl">
      <h1 className="mb-2xl text-center text-[28px] font-bold leading-tight">Admin Sign In</h1>

      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="User ID"
          id="userIdentifier"
          type="text"
          autoComplete="username"
          required
          value={userIdentifier}
          onChange={(e) => setUserIdentifier(e.target.value)}
          disabled={phase === 'submitting'}
        />
        <FormField
          label="Password"
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={phase === 'submitting'}
        />

        {phase === 'error' && (
          <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
            <p className="text-sm font-medium text-error">{errorMessage}</p>
          </div>
        )}

        <Button type="submit" loading={phase === 'submitting'} className="w-full">
          Sign In
        </Button>
      </form>
    </div>
  );
}
