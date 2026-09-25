'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, apiPatch, ApiClientError } from '@/lib/apiClient';
import type { CampaignDetailAdminResponse } from '@/lib/admin/types';
import { CampaignForm, campaignFormToPayload, campaignToFormValues, type CampaignFormValues } from '@/components/admin/CampaignForm';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; campaign: CampaignDetailAdminResponse };

export default function EditCampaignPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    apiGet<CampaignDetailAdminResponse>(`/api/admin/campaigns/${params.id}`)
      .then((campaign) => setState({ phase: 'loaded', campaign }))
      .catch((err: unknown) => {
        setState({ phase: 'error', message: err instanceof ApiClientError ? err.message : 'Something went wrong.' });
      });
  }, [params.id]);

  if (state.phase === 'loading') return <p className="text-text-secondary">Loading…</p>;
  if (state.phase === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">Could not load the campaign</p>
        <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
      </div>
    );
  }

  async function handleSubmit(values: CampaignFormValues) {
    try {
      await apiPatch(`/api/admin/campaigns/${params.id}`, campaignFormToPayload(values));
      router.push('/admin/content/campaigns');
    } catch (err) {
      throw new Error(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Edit Campaign</h1>
      <p className="mb-lg text-sm text-text-secondary">Linked sections: {state.campaign.linkedSectionCount}</p>
      <CampaignForm initial={campaignToFormValues(state.campaign)} onSubmit={handleSubmit} submitLabel="Save Changes" />
    </div>
  );
}
