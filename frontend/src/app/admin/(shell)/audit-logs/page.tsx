'use client';

import { useEffect, useState } from 'react';
import { apiList, ApiClientError } from '@/lib/apiClient';
import type { AuditLogEntry } from '@/lib/admin/types';
import type { PaginationBlock } from '@/lib/apiTypes';
import { Button } from '@/components/admin/Button';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: AuditLogEntry[]; pagination: PaginationBlock };

/** Audit log (spec 03 §Frontend work): paginated, filterable by entity type. */
export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });

    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (entityType) query.set('entityType', entityType);

    apiList<AuditLogEntry>(`/api/admin/audit-logs?${query.toString()}`, {
      signal: controller.signal,
    })
      .then(({ data, pagination }) => setState({ phase: 'loaded', items: data, pagination }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });

    return () => controller.abort();
  }, [page, entityType]);

  return (
    <div>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Audit Log</h1>

      <div className="mb-lg">
        <label htmlFor="entityType" className="mb-sm block text-xs font-semibold text-text-primary">
          Filter by entity type
        </label>
        <select
          id="entityType"
          className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none sm:w-64"
          value={entityType}
          onChange={(e) => {
            setPage(1);
            setEntityType(e.target.value);
          }}
        >
          <option value="">All entities</option>
          <option value="user">User</option>
        </select>
      </div>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading audit log…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load the audit log</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && (
        <p className="text-text-secondary">No audit entries yet.</p>
      )}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <>
          <ul className="flex flex-col gap-sm">
            {state.items.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border bg-background p-lg">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <span className="font-semibold text-text-primary">{entry.action}</span>
                  <span className="text-xs text-text-secondary">
                    {new Date(entry.createdAt).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="mt-xs text-xs text-text-secondary">
                  {entry.entityType}
                  {entry.entityId ? ` · ${entry.entityId}` : ''} · actor{' '}
                  {entry.actorType === 'SYSTEM' ? 'System' : entry.actorUserId ?? 'unknown'}
                </p>
              </li>
            ))}
          </ul>

          {state.pagination.totalPages > 1 && (
            <div className="mt-lg flex items-center justify-between gap-md">
              <Button
                type="button"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-text-secondary">
                Page {state.pagination.page} of {state.pagination.totalPages}
              </span>
              <Button
                type="button"
                variant="secondary"
                disabled={page >= state.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
