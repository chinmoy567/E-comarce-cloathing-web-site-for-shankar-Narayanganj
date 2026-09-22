'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiList, ApiClientError } from '@/lib/apiClient';
import type { ManagerListItem } from '@/lib/admin/types';
import type { PaginationBlock } from '@/lib/apiTypes';
import { Button } from '@/components/admin/Button';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: ManagerListItem[]; pagination: PaginationBlock };

/**
 * Managers list (spec 03 §Frontend work): paginated, card-per-row on mobile.
 * Reachable only when `/auth/me` includes `user.manager.create` — the shell
 * hides the nav link otherwise, and the backend independently 403s a direct
 * hit (§5.18, `frontend` skill §3).
 */
export default function ManagersListPage() {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });

    apiList<ManagerListItem>(`/api/admin/managers?page=${page}&pageSize=20`, {
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
  }, [page]);

  return (
    <div>
      <div className="mb-lg flex items-center justify-between gap-md">
        <h1 className="text-xl font-bold md:text-[28px]">Managers</h1>
        <Link href="/admin/managers/new">
          <Button type="button">Add Manager</Button>
        </Link>
      </div>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading managers…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load managers</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && (
        <p className="text-text-secondary">No Manager accounts yet.</p>
      )}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <>
          <ul className="flex flex-col gap-sm">
            {state.items.map((manager) => (
              <li key={manager.id}>
                <Link
                  href={`/admin/managers/${manager.id}`}
                  className="flex min-h-[80px] items-center justify-between rounded-lg border border-border bg-background p-lg"
                >
                  <div>
                    <p className="font-semibold text-text-primary">{manager.userIdentifier}</p>
                    <p className="text-xs text-text-secondary">
                      Created {new Date(manager.createdAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <span
                    className={`rounded-lg px-sm py-xs text-xs font-semibold ${
                      manager.isActive ? 'bg-accent/10 text-accent' : 'bg-text-tertiary/10 text-text-secondary'
                    }`}
                  >
                    {manager.isActive ? 'Active' : 'Deactivated'}
                  </span>
                </Link>
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
