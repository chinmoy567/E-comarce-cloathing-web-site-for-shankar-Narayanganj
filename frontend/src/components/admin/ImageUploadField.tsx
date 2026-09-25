'use client';

import { useState } from 'react';
import { ApiClientError } from '@/lib/apiClient';

/**
 * Uploads a homepage/campaign image via `POST /api/admin/homepage/images`
 * (13-homepage-cms §13.11, plan §6) and sets the returned public URL into the
 * caller's form field on success.
 */
export function ImageUploadField({
  label,
  id,
  kind,
  value,
  onChange,
}: {
  label: string;
  id: string;
  kind: 'section-desktop' | 'section-mobile' | 'campaign-hero';
  value: string;
  onChange: (url: string) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setPhase('uploading');
    setErrorMessage('');

    try {
      const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
      const csrfMatch = document.cookie.match(/(?:^|; )admin_csrf=([^;]*)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]!) : '';

      const buffer = await file.arrayBuffer();
      const res = await fetch(`${base}/api/admin/homepage/images?kind=${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': file.type, 'X-CSRF-Token': csrfToken },
        body: buffer,
      });

      const payload = (await res.json()) as { data?: { url: string }; error?: { message: string } };
      if (!res.ok) throw new Error(payload.error?.message ?? 'Upload failed.');

      onChange(payload.data!.url);
      setPhase('idle');
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : 'Upload failed.');
    }
  }

  return (
    <div className="mb-lg w-full">
      <label htmlFor={id} className="mb-sm block text-xs font-semibold text-text-primary">
        {label}
      </label>
      {value && <p className="mb-xs truncate text-xs text-text-secondary">{value}</p>}
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileChange}
        disabled={phase === 'uploading'}
        className="block w-full text-sm text-text-primary file:mr-md file:h-11 file:rounded-lg file:border-0 file:bg-primary file:px-lg file:text-sm file:font-bold file:text-white"
      />
      {phase === 'uploading' && <p className="mt-xs text-xs text-text-secondary">Uploading…</p>}
      {phase === 'error' && <p className="mt-xs text-xs text-error">{errorMessage}</p>}
    </div>
  );
}
