'use client';

import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import { HomepageSection } from '@/components/homepage/HomepageSection';
import type { PreviewResponse } from '@/lib/publicTypes';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; data: PreviewResponse };

/**
 * Authenticated preview (13-homepage-cms §13.12, plan §6). Reuses the same
 * `<HomepageSection/>` components the public homepage renders, so preview
 * matches what will actually publish — always shown with a visible
 * "not live" banner so it is never ambiguous to the Admin viewing it.
 */
export default function HomepagePreviewPage() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    apiGet<PreviewResponse>('/api/admin/homepage/preview')
      .then((data) => setState({ phase: 'loaded', data }))
      .catch((err: unknown) => {
        setState({ phase: 'error', message: err instanceof ApiClientError ? err.message : 'Something went wrong.' });
      });
  }, []);

  return (
    <div>
      <div className="sticky top-0 z-10 mb-lg rounded-lg bg-warning/10 p-md text-center text-sm font-semibold text-warning">
        Preview — not live
      </div>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading preview…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load the preview</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && (
        <div className="flex flex-col gap-2xl">
          {state.data.sections.map((section, index) => (
            <div key={section.id} className="relative">
              <span className="absolute -top-sm right-0 rounded-lg bg-text-secondary/90 px-sm py-[2px] text-xs font-semibold text-white">
                {section.displayStatus}
              </span>
              <HomepageSection section={section} priority={index === 0} />
            </div>
          ))}
          {state.data.sections.length === 0 && <p className="text-text-secondary">No sections to preview.</p>}
        </div>
      )}
    </div>
  );
}
