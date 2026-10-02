'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, apiPatch, ApiClientError } from '@/lib/apiClient';
import type { CampaignDetailAdminResponse } from '@/lib/admin/types';
import { CampaignForm, campaignFormToPayload, campaignToFormValues, type CampaignFormValues } from '@/components/admin/CampaignForm';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; status?: number }
  | { phase: 'loaded'; campaign: CampaignDetailAdminResponse };

export default function EditCampaignPage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    apiGet<CampaignDetailAdminResponse>(`/api/admin/campaigns/${params.id}`)
      .then((campaign) => setState({ phase: 'loaded', campaign }))
      .catch((err: unknown) => {
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong.',
          ...(err instanceof ApiClientError ? { status: err.status } : {}),
        });
      });
  }, [params.id]);

  if (state.phase === 'loading') return <p className="text-text-secondary">Loading…</p>;
  if (state.phase === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">
          {state.status === 403 ? 'You do not have access to Campaigns.' : 'Could not load the campaign'}
        </p>
        {state.status !== 403 && <p className="mt-xs text-sm text-text-secondary">{state.message}</p>}
      </div>
    );
  }

  async function handleSubmit(values: CampaignFormValues) {
    // ApiClientError is rethrown as-is so the form can show field-level errors.
    await apiPatch(`/api/admin/campaigns/${params.id}`, campaignFormToPayload(values));
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link href="/admin/content/campaigns" className="mb-md inline-block text-sm font-semibold text-primary hover:underline">
        ← Back to campaigns
      </Link>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Edit Campaign</h1>
      {state.campaign.sections.length > 0 && (
        <p className="mb-lg text-sm text-text-secondary">
          Used by:{' '}
          {state.campaign.sections.map((section, index) => (
            <span key={section.id}>
              {index > 0 && ', '}
              <Link href={`/admin/content/homepage/${section.id}`} className="font-semibold text-primary hover:underline">
                {section.title || 'Untitled section'}
              </Link>
            </span>
          ))}
        </p>
      )}
      <CampaignForm
        campaignId={state.campaign.id}
        initial={campaignToFormValues(state.campaign)}
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
      />
    </div>
  );
}
