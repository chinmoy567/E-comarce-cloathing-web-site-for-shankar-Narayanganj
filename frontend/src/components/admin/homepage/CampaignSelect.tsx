'use client';

import { useEffect, useState } from 'react';
import { apiList } from '@/lib/apiClient';
import type { CampaignAdminResponse } from '@/lib/admin/types';
import { SelectField } from '@/components/admin/SelectField';

/** Campaign picker — campaigns are chosen from a list, never typed as UUIDs. */
export function CampaignSelect({
  value,
  onChange,
  required = false,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  error?: string;
}) {
  const [campaigns, setCampaigns] = useState<CampaignAdminResponse[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiList<CampaignAdminResponse>('/api/admin/campaigns?pageSize=100')
      .then(({ data }) => setCampaigns(data))
      .catch(() => setFailed(true));
  }, []);

  return (
    <SelectField
      label="Campaign"
      id="campaignId"
      required={required}
      value={value}
      error={error ?? (failed ? 'Could not load campaigns.' : undefined)}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{required ? 'Select a campaign' : 'None'}</option>
      {campaigns.map((campaign) => (
        <option key={campaign.id} value={campaign.id}>
          {campaign.name} ({campaign.displayStatus.toLowerCase()})
        </option>
      ))}
    </SelectField>
  );
}
