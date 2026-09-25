'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiList, ApiClientError } from '@/lib/apiClient';
import type { CampaignAdminResponse } from '@/lib/admin/types';
import { Button } from '@/components/admin/Button';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: CampaignAdminResponse[] };

const DISPLAY_STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-accent/10 text-accent',
  DRAFT: 'bg-text-tertiary/10 text-text-secondary',
  SCHEDULED: 'bg-primary/10 text-primary',
  DISABLED: 'bg-text-tertiary/10 text-text-secondary',
  EXPIRED: 'bg-error/10 text-error',
};

/** Admin Campaigns list (13-homepage-cms §13.12, plan §6). */
export default function CampaignsListPage() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    apiList<CampaignAdminResponse>('/api/admin/campaigns?pageSize=100')
      .then(({ data }) => setState({ phase: 'loaded', items: data }))
      .catch((err: unknown) => {
        setState({ phase: 'error', message: err instanceof ApiClientError ? err.message : 'Something went wrong.' });
      });
  }, []);

  return (
    <div>
      <div className="mb-lg flex items-center justify-between gap-md">
        <h1 className="text-xl font-bold md:text-[28px]">Campaigns</h1>
        <Link href="/admin/content/campaigns/new">
          <Button type="button">Add Campaign</Button>
        </Link>
      </div>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading campaigns…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load campaigns</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && <p className="text-text-secondary">No campaigns yet.</p>}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <ul className="flex flex-col gap-sm">
          {state.items.map((campaign) => (
            <li key={campaign.id}>
              <Link
                href={`/admin/content/campaigns/${campaign.id}`}
                className="flex min-h-[80px] flex-col gap-xs rounded-lg border border-border bg-background p-lg sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold text-text-primary">{campaign.name}</p>
                  <p className="text-xs text-text-secondary">{campaign.slug}</p>
                </div>
                <span
                  className={`self-start rounded-lg px-sm py-xs text-xs font-semibold sm:self-center ${DISPLAY_STATUS_STYLE[campaign.displayStatus] ?? 'bg-text-tertiary/10 text-text-secondary'}`}
                >
                  {campaign.displayStatus}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
