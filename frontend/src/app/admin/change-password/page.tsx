'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';

/**
 * Forced first-login password change (02-customer §2.7, spec 03 §Frontend
 * work). Reachable whether or not `mustChangePassword` is true — the shell
 * redirects here from every other route while it is true, but a user may also
 * open this page voluntarily to change their password later.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { state, refresh } = useAdminSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (state.phase === 'unauthenticated') {
      router.replace('/admin/login');
    }
  }, [state.phase, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhase('submitting');
    setErrorMessage('');

    try {
      await apiPost('/api/admin/auth/change-password', { currentPassword, newPassword });
      setPhase('success');
      await refresh();
      router.replace('/admin');
    } catch (err) {
      setPhase('error');
      setErrorMessage(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
      );
    }
  }

  if (state.phase === 'loading' || state.phase === 'unauthenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-text-secondary">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-lg py-2xl">
      <h1 className="mb-sm text-center text-[28px] font-bold leading-tight">Change Password</h1>
      <p className="mb-2xl text-center text-sm text-text-secondary">Choose a new password to continue.</p>

      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="Current Password"
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          disabled={phase === 'submitting'}
        />
        <FormField
          label="New Password"
          id="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={phase === 'submitting'}
        />
        <p className="-mt-md mb-lg text-xs text-text-secondary">
          At least 12 characters, with at least one letter and one digit.
        </p>

        {phase === 'error' && (
          <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
            <p className="text-sm font-medium text-error">{errorMessage}</p>
          </div>
        )}

        <Button type="submit" loading={phase === 'submitting'} className="w-full">
          Change Password
        </Button>
      </form>
    </div>
  );
}
