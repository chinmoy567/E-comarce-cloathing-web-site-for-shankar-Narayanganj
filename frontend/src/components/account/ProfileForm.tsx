'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, apiPatch, ApiClientError } from '@/lib/apiClient';
import type { CustomerProfile } from '@/lib/account';
import { FormField } from '@/components/admin/FormField';
import { Button } from '@/components/admin/Button';

/**
 * View/edit the customer profile (02-customer §2.2/§2.6). The phone number is
 * the login identity and is shown read-only: changing it needs the
 * verification flow, which is not built yet.
 */
export function ProfileForm() {
  const router = useRouter();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<CustomerProfile>('/api/customer/auth/me')
      .then((data) => {
        setProfile(data);
        setFullName(data.full_name);
        setEmail(data.email ?? '');
      })
      .catch((err: unknown) => {
        if (err instanceof ApiClientError && err.status === 401) {
          router.push('/auth/login');
          return;
        }
        setLoadError('Could not load your profile.');
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const nextErrors: Record<string, string> = {};
    if (!fullName.trim()) nextErrors.fullName = 'Full name is required.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const updated = await apiPatch<CustomerProfile>('/api/customer/auth/profile', {
        full_name: fullName.trim(),
        email: email.trim() || null,
      });
      setProfile(updated);
      setFullName(updated.full_name);
      setEmail(updated.email ?? '');
      setMessage({ kind: 'success', text: 'Profile updated.' });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors({
          ...(err.fieldError('full_name') ? { fullName: err.fieldError('full_name')! } : {}),
          ...(err.fieldError('email') ? { email: err.fieldError('email')! } : {}),
        });
        setMessage({ kind: 'error', text: err.message });
      } else {
        setMessage({
          kind: 'error',
          text: 'Could not save your profile. Please try again.',
        });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-error">
        {loadError}
      </p>
    );
  }
  if (!profile) return <p className="text-sm text-text-secondary">Loading your profile…</p>;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate>
      {!profile.is_complete && (
        <div className="mb-xl rounded-lg border border-warning p-lg text-sm text-text-primary">
          Your profile is incomplete. A full name and a{' '}
          <Link href="/account/addresses" className="font-semibold text-primary underline">
            delivery address
          </Link>{' '}
          are required before you can check out as a registered customer.
        </div>
      )}

      <FormField
        label="Full Name"
        id="fullName"
        required
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        error={errors.fullName}
        autoComplete="name"
      />
      <FormField
        label="Email (optional)"
        id="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        autoComplete="email"
      />
      <FormField
        label="Mobile Number"
        id="phone"
        value={profile.phone_number}
        readOnly
        disabled
        aria-describedby="phone-help"
      />
      <p id="phone-help" className="-mt-md mb-lg text-xs text-text-secondary">
        Your mobile number is your login. It cannot be changed here yet.
      </p>

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mb-lg text-sm ${message.kind === 'error' ? 'text-error' : 'text-accent'}`}
        >
          {message.text}
        </p>
      )}

      <Button type="submit" loading={saving}>
        Save Changes
      </Button>
    </form>
  );
}
