'use client';

import { useEffect, useRef, useState } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';

type State = 'working' | 'done' | 'failed';

/**
 * Confirms the email-change token once on load. The ref guards React strict-mode's double effect: a
 * second POST would consume nothing but would show a misleading "expired" message.
 */
export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<State>('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    apiPost('/api/customer/auth/email-change/confirm', { token })
      .then(() => setState('done'))
      .catch((err: unknown) => {
        setMessage(
          err instanceof ApiClientError && err.status !== 400
            ? err.message
            : 'This link is invalid or has expired. Save your email again on your profile to get a new one.',
        );
        setState('failed');
      });
  }, [token]);

  if (state === 'working') return <p className="text-sm text-text-secondary">Confirming your email…</p>;
  if (state === 'done') {
    return (
      <p role="status" className="text-sm text-accent">
        Your email address is confirmed. You can now use it to reset your password.
      </p>
    );
  }
  return (
    <p role="alert" className="text-sm text-error">
      {message}
    </p>
  );
}
