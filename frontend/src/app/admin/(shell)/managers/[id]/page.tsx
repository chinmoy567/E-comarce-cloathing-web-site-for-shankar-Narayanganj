'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { PermissionChecklist } from '@/components/admin/PermissionChecklist';
import type { ManagerDetail, PermissionCatalogueEntry } from '@/lib/admin/types';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; manager: ManagerDetail; catalogue: PermissionCatalogueEntry[] };

/**
 * Manager detail/edit (spec 03 §Frontend work): update User ID/password,
 * grant/revoke `ASSIGNED`-tier permissions, deactivate/reactivate, delete.
 * Every action here also has a real backend gate (`user.manager.update`,
 * `user.manager.delete`, `permission.assign`) — a 403 the UI didn't
 * anticipate is handled, not assumed away (`frontend` skill §3).
 */
export default function ManagerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { state: session } = useAdminSession();

  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [userIdentifier, setUserIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      apiGet<ManagerDetail>(`/api/admin/managers/${params.id}`, { signal: controller.signal }),
      apiGet<PermissionCatalogueEntry[]>('/api/admin/permissions', { signal: controller.signal }),
    ])
      .then(([manager, catalogue]) => {
        setState({ phase: 'loaded', manager, catalogue });
        setUserIdentifier(manager.userIdentifier);
        setSelected(new Set(manager.permissions));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });

    return () => controller.abort();
  }, [params.id]);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.phase !== 'loaded') return;
    setSavingProfile(true);
    setActionError('');
    setNotice('');

    try {
      const body: { userIdentifier?: string; password?: string } = {};
      if (userIdentifier !== state.manager.userIdentifier) body.userIdentifier = userIdentifier;
      if (password) body.password = password;

      const updated = await apiPatch<ManagerDetail>(`/api/admin/managers/${params.id}`, body);
      setState({ ...state, manager: updated });
      setPassword('');
      setNotice('Manager updated.');
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePermissionsSubmit() {
    setSavingPermissions(true);
    setActionError('');
    setNotice('');

    try {
      const result = await apiPut<{ permissions: string[] }>(
        `/api/admin/managers/${params.id}/permissions`,
        { permissions: [...selected] },
      );
      if (state.phase === 'loaded') {
        setState({ ...state, manager: { ...state.manager, permissions: result.permissions } });
      }
      setNotice('Permissions updated.');
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSavingPermissions(false);
    }
  }

  async function handleToggleActive() {
    if (state.phase !== 'loaded') return;
    setStatusBusy(true);
    setActionError('');
    setNotice('');

    const action = state.manager.isActive ? 'deactivate' : 'reactivate';
    try {
      const updated = await apiPost<ManagerDetail>(`/api/admin/managers/${params.id}/${action}`);
      setState({ ...state, manager: updated });
      setNotice(updated.isActive ? 'Manager reactivated.' : 'Manager deactivated.');
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleDelete() {
    setStatusBusy(true);
    setActionError('');

    try {
      await apiDelete(`/api/admin/managers/${params.id}`);
      router.replace('/admin/managers');
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
      setStatusBusy(false);
    }
  }

  if (state.phase === 'loading') {
    return <p className="text-text-secondary">Loading manager…</p>;
  }

  if (state.phase === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">Could not load this manager</p>
        <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
      </div>
    );
  }

  const actorPermissions =
    session.phase === 'authenticated' ? new Set(session.me.permissions) : new Set<string>();

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-lg flex items-center justify-between gap-md">
        <h1 className="text-xl font-bold md:text-[28px]">{state.manager.userIdentifier}</h1>
        <span
          className={`rounded-lg px-sm py-xs text-xs font-semibold ${
            state.manager.isActive ? 'bg-accent/10 text-accent' : 'bg-text-tertiary/10 text-text-secondary'
          }`}
        >
          {state.manager.isActive ? 'Active' : 'Deactivated'}
        </span>
      </div>

      {notice && (
        <div className="mb-lg rounded-lg border border-accent/30 bg-accent/5 p-md">
          <p className="text-sm font-medium text-accent">{notice}</p>
        </div>
      )}
      {actionError && (
        <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
          <p className="text-sm font-medium text-error">{actionError}</p>
        </div>
      )}

      <form onSubmit={handleProfileSubmit} noValidate className="mb-2xl">
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
          disabled={savingProfile}
        />
        <FormField
          label="New Password (leave blank to keep current)"
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={savingProfile}
        />
        <Button type="submit" loading={savingProfile}>
          Save Changes
        </Button>
      </form>

      <div className="mb-2xl">
        <h2 className="mb-md text-base font-bold">Permissions</h2>
        <PermissionChecklist
          catalogue={state.catalogue}
          actorPermissions={actorPermissions}
          selected={selected}
          onChange={setSelected}
        />
        <Button type="button" loading={savingPermissions} onClick={() => void handlePermissionsSubmit()}>
          Save Permissions
        </Button>
      </div>

      <div className="flex flex-col gap-md sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          disabled={statusBusy}
          onClick={() => void handleToggleActive()}
        >
          {state.manager.isActive ? 'Deactivate' : 'Reactivate'}
        </Button>
        <Button type="button" variant="destructive" disabled={statusBusy} onClick={() => void handleDelete()}>
          Delete Manager
        </Button>
      </div>
    </div>
  );
}
