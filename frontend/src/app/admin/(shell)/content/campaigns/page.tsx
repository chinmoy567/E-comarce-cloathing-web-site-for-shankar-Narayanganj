'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiDelete, apiList, ApiClientError } from '@/lib/apiClient';
import type { CampaignAdminResponse } from '@/lib/admin/types';
import { Button } from '@/components/admin/Button';
import { DisplayStatusBadge } from '@/components/admin/homepage/DisplayStatusBadge';
import { ConfirmDialog } from '@/components/admin/homepage/ConfirmDialog';

type State =
  | { phase: 'loading' }
  | { phase: 'forbidden' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: CampaignAdminResponse[] };

function formatSchedule(campaign: CampaignAdminResponse): string {
  const fmt = (iso: string) => new Date(iso).toLocaleString();
  if (campaign.startsAt && campaign.endsAt) return `${fmt(campaign.startsAt)} – ${fmt(campaign.endsAt)}`;
  if (campaign.startsAt) return `From ${fmt(campaign.startsAt)}`;
  if (campaign.endsAt) return `Until ${fmt(campaign.endsAt)}`;
  return 'No schedule';
}

/** Admin Campaigns list (13-homepage-cms §13.12): computed status and the sections referencing each campaign. */
export default function CampaignsListPage() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CampaignAdminResponse | null>(null);

  function load() {
    setState({ phase: 'loading' });
    apiList<CampaignAdminResponse>('/api/admin/campaigns?pageSize=100')
      .then(({ data }) => setState({ phase: 'loaded', items: data }))
      .catch((err: unknown) => {
        if (err instanceof ApiClientError && err.status === 403) {
          setState({ phase: 'forbidden' });
          return;
        }
        setState({ phase: 'error', message: err instanceof ApiClientError ? err.message : 'Something went wrong.' });
      });
  }

  useEffect(load, []);

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    const target = pendingDelete;
    setBusy(true);
    setActionError(null);
    try {
      await apiDelete(`/api/admin/campaigns/${target.id}`);
      setState((prev) => (prev.phase === 'loaded' ? { phase: 'loaded', items: prev.items.filter((c) => c.id !== target.id) } : prev));
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Could not delete the campaign.');
    } finally {
      setPendingDelete(null);
      setBusy(false);
    }
  }

  if (state.phase === 'forbidden') {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">You do not have access to Campaigns.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-lg flex flex-col gap-md md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl font-bold md:text-[28px]">Campaigns</h1>
        <Link href="/admin/content/campaigns/new">
          <Button type="button">Add Campaign</Button>
        </Link>
      </div>

      {actionError && (
        <div role="alert" className="mb-md rounded-lg border border-error/30 bg-error/5 p-md">
          <p className="text-sm text-error">{actionError}</p>
        </div>
      )}

      {state.phase === 'loading' && <p className="text-text-secondary">Loading campaigns…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load campaigns</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
          <div className="mt-md">
            <Button type="button" variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && <p className="text-text-secondary">No campaigns yet.</p>}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <ul className="flex flex-col gap-sm">
          {state.items.map((campaign) => (
            <li key={campaign.id} className="flex flex-col gap-sm rounded-lg border border-border bg-background p-lg md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-text-primary">{campaign.name}</p>
                <p className="text-xs text-text-secondary">
                  {campaign.slug} · {formatSchedule(campaign)}
                </p>
                <p className="mt-xs text-xs text-text-secondary">
                  Sections:{' '}
                  {campaign.sections.length === 0
                    ? 'none'
                    : campaign.sections.map((section, index) => (
                        <span key={section.id}>
                          {index > 0 && ', '}
                          <Link href={`/admin/content/homepage/${section.id}`} className="font-semibold text-primary hover:underline">
                            {section.title || 'Untitled section'}
                          </Link>
                        </span>
                      ))}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-sm">
                <DisplayStatusBadge status={campaign.displayStatus} />
                <Link href={`/admin/content/campaigns/${campaign.id}`} aria-label={`Edit ${campaign.name}`}>
                  <Button type="button" variant="secondary" disabled={busy}>
                    Edit
                  </Button>
                </Link>
                <Button type="button" variant="destructive" disabled={busy} onClick={() => setPendingDelete(campaign)} aria-label={`Delete ${campaign.name}`}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this campaign?"
          message="Its sections stay but lose the campaign link. This cannot be undone."
          confirmLabel="Delete"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
