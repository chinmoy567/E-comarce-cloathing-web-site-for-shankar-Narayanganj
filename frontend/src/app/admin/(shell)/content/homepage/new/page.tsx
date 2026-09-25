'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import type { CreateHomepageSectionRequest, HomepageSectionAdminResponse, SectionType } from '@/lib/admin/types';
import {
  emptySectionFormValues,
  HomepageSectionForm,
  toCreatePayloadDates,
  type SectionFormValues,
} from '@/components/admin/HomepageSectionForm';

const SECTION_TYPES: SectionType[] = ['HERO', 'CATEGORY_GRID', 'PRODUCT_CAROUSEL', 'CAMPAIGN_BANNER', 'PROMO_BANNER', 'CUSTOM_CONTENT'];

/** New section creation (13-homepage-cms §13.4). `sectionType` is picked once here and is locked after creation. */
export default function NewHomepageSectionPage() {
  const router = useRouter();
  const [sectionType, setSectionType] = useState<SectionType | null>(null);

  if (!sectionType) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="mb-lg text-xl font-bold md:text-[28px]">Add Section</h1>
        <p className="mb-md text-sm text-text-secondary">Choose a section type. This cannot be changed after creation.</p>
        <div className="grid grid-cols-2 gap-sm">
          {SECTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSectionType(type)}
              className="h-11 rounded-lg border border-border bg-background px-md text-sm font-medium hover:border-primary"
            >
              {type.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>
    );
  }

  async function handleSubmit(values: SectionFormValues) {
    const body: CreateHomepageSectionRequest = {
      sectionType: sectionType!,
      title: values.title || null,
      subtitle: values.subtitle || null,
      status: values.status,
      ctaLabel: values.ctaLabel || null,
      ctaUrl: values.ctaUrl || null,
      secondaryCtaLabel: values.secondaryCtaLabel || null,
      secondaryCtaUrl: values.secondaryCtaUrl || null,
      desktopImageUrl: values.desktopImageUrl || null,
      mobileImageUrl: values.mobileImageUrl || null,
      campaignId: values.campaignId || null,
      contentConfig: values.contentConfig,
      ...toCreatePayloadDates(values),
    };

    try {
      const created = await apiPost<HomepageSectionAdminResponse>('/api/admin/homepage/sections', body);
      router.replace(`/admin/content/homepage/${created.id}`);
    } catch (err) {
      throw new Error(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Add Section</h1>
      <HomepageSectionForm
        sectionType={sectionType}
        initial={emptySectionFormValues(sectionType)}
        onSubmit={handleSubmit}
        submitLabel="Create Section"
      />
    </div>
  );
}
