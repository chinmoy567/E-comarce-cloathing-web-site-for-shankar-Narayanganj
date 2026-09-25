'use client';

import { useRouter } from 'next/navigation';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import type { CampaignAdminResponse } from '@/lib/admin/types';
import { CampaignForm, campaignFormToPayload, emptyCampaignFormValues, type CampaignFormValues } from '@/components/admin/CampaignForm';

export default function NewCampaignPage() {
  const router = useRouter();

  async function handleSubmit(values: CampaignFormValues) {
    try {
      const created = await apiPost<CampaignAdminResponse>('/api/admin/campaigns', campaignFormToPayload(values));
      router.replace(`/admin/content/campaigns/${created.id}`);
    } catch (err) {
      throw new Error(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Add Campaign</h1>
      <CampaignForm initial={emptyCampaignFormValues()} onSubmit={handleSubmit} submitLabel="Create Campaign" />
    </div>
  );
}
