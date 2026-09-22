'use client';

import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';

type HealthResponse = {
  status: 'ok';
  uptimeSeconds: number;
  database: 'ok' | 'unavailable';
};

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'success'; health: HealthResponse };

/**
 * Placeholder home page.
 *
 * Its purpose is to prove the loading / error / success discipline that every
 * later page must follow — not to be a real storefront page (spec 07 onward).
 */
export default function HomePage() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    apiGet<HealthResponse>('/api/health', { signal: controller.signal })
      .then((health) => setState({ phase: 'success', health }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message:
            err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="flex flex-col gap-2xl">
      <header className="flex flex-col gap-sm">
        <h1 className="text-[28px] font-bold leading-tight md:text-[36px]">Shankar</h1>
        <p className="text-text-secondary text-base">
          Platform foundation is in place. Storefront pages are built in a later slice.
        </p>
      </header>

      <section
        aria-labelledby="api-status-heading"
        className="border-border rounded-lg border bg-surface p-lg"
      >
        <h2 id="api-status-heading" className="text-xl font-semibold md:text-[28px]">
          API status
        </h2>

        <div className="mt-lg" aria-live="polite">
          {state.phase === 'loading' && (
            <p className="text-text-secondary">Checking the API…</p>
          )}

          {state.phase === 'error' && (
            <div className="border-error/30 bg-error/5 rounded-lg border p-lg">
              <p className="text-error font-medium">Could not load API status</p>
              <p className="text-text-secondary mt-xs text-sm">{state.message}</p>
            </div>
          )}

          {state.phase === 'success' && (
            <dl className="grid gap-md sm:grid-cols-1 md:grid-cols-3">
              <div>
                <dt className="text-text-secondary text-sm">Status</dt>
                <dd className="font-medium">{state.health.status}</dd>
              </div>
              <div>
                <dt className="text-text-secondary text-sm">Uptime</dt>
                <dd className="font-medium">{state.health.uptimeSeconds}s</dd>
              </div>
              <div>
                <dt className="text-text-secondary text-sm">Database</dt>
                <dd
                  className={
                    state.health.database === 'ok' ? 'text-accent font-medium' : 'text-warning font-medium'
                  }
                >
                  {state.health.database}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </section>
    </div>
  );
}
