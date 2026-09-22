'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { PermissionChecklist } from '@/components/admin/PermissionChecklist';
import type { ManagerDetail, PermissionCatalogueEntry } from '@/lib/admin/types';

type CatalogueState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; catalogue: PermissionCatalogueEntry[] };

export default function NewManagerPage() {
  const router = useRouter();
  const { state: session } = useAdminSession();
  const [catalogueState, setCatalogueState] = useState<CatalogueState>({ phase: 'loading' });
  const [userIdentifier, setUserIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    apiGet<PermissionCatalogueEntry[]>('/api/admin/permissions', { signal: controller.signal })
      .then((catalogue) => setCatalogueState({ phase: 'loaded', catalogue }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setCatalogueState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });
    return () => controller.abort();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhase('submitting');
    setErrorMessage('');

    try {
      const created = await apiPost<ManagerDetail>('/api/admin/managers', {
        userIdentifier,
        password,
        permissions: [...selected],
      });
      router.replace(`/admin/managers/${created.id}`);
    } catch (err) {
      setPhase('error');
      setErrorMessage(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
      );
    }
  }

  const actorPermissions =
    session.phase === 'authenticated' ? new Set(session.me.permissions) : new Set<string>();

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Add Manager</h1>

      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="User ID"
          id="userIdentifier"
          type="text"
          required
          minLength={3}
          maxLength={64}
          pattern="[a-zA-Z0-9._-]+"
          value={userIdentifier}
          onChange={(e) => setUserIdentifier(e.target.value)}
          disabled={phase === 'submitting'}
        />
        <FormField
          label="Password"
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={phase === 'submitting'}
        />

        {catalogueState.phase === 'loading' && (
          <p className="text-sm text-text-secondary">Loading permissions…</p>
        )}
        {catalogueState.phase === 'error' && (
          <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
            <p className="text-sm font-medium text-error">{catalogueState.message}</p>
          </div>
        )}
        {catalogueState.phase === 'loaded' && (
          <PermissionChecklist
            catalogue={catalogueState.catalogue}
            actorPermissions={actorPermissions}
            selected={selected}
            onChange={setSelected}
          />
        )}

        {phase === 'error' && (
          <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
            <p className="text-sm font-medium text-error">{errorMessage}</p>
          </div>
        )}

        <Button type="submit" loading={phase === 'submitting'}>
          Create Manager
        </Button>
      </form>
    </div>
  );
}
