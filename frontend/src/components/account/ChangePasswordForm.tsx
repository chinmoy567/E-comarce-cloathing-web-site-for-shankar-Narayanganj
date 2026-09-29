'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import { FormField } from '@/components/admin/FormField';
import { Button } from '@/components/admin/Button';

const MIN_LENGTH = 8;

/** Change password while signed in (02-customer §2.6): needs the current password. */
export function ChangePasswordForm() {
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const nextErrors: Record<string, string> = {};
    if (!oldPassword) nextErrors.oldPassword = 'Enter your current password.';
    if (newPassword.length < MIN_LENGTH) nextErrors.newPassword = `Use at least ${MIN_LENGTH} characters.`;
    else if (newPassword === oldPassword) nextErrors.newPassword = 'Choose a password different from the current one.';
    if (confirm !== newPassword) nextErrors.confirm = 'Passwords do not match.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      await apiPost('/api/customer/auth/change-password', {
        old_password: oldPassword,
        new_password: newPassword,
      });
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
      setMessage({ kind: 'success', text: 'Your password has been changed.' });
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 401 && err.code === 'UNAUTHORIZED' && !/current password/i.test(err.message)) {
          router.push('/auth/login');
          return;
        }
        setMessage({ kind: 'error', text: err.message });
      } else {
        setMessage({
          kind: 'error',
          text: 'Could not change your password. Please try again.',
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate>
      <FormField
        label="Current Password"
        id="oldPassword"
        type="password"
        required
        autoComplete="current-password"
        value={oldPassword}
        onChange={(e) => setOldPassword(e.target.value)}
        error={errors.oldPassword}
      />
      <FormField
        label="New Password"
        id="newPassword"
        type="password"
        required
        autoComplete="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        error={errors.newPassword}
      />
      <FormField
        label="Confirm New Password"
        id="confirmPassword"
        type="password"
        required
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
      />

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mb-lg text-sm ${message.kind === 'error' ? 'text-error' : 'text-accent'}`}
        >
          {message.text}
        </p>
      )}

      <Button type="submit" loading={saving}>
        Change Password
      </Button>
    </form>
  );
}
