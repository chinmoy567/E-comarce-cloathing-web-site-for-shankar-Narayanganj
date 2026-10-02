'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, apiPatch, ApiClientError } from '@/lib/apiClient';
import type { HomepageSectionAdminResponse, UpdateHomepageSectionRequest } from '@/lib/admin/types';
import { HomepageSectionForm, sectionToFormValues, toCreatePayloadDates, type SectionFormValues } from '@/components/admin/HomepageSectionForm';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; status?: number }
  | { phase: 'loaded'; section: HomepageSectionAdminResponse };

/** Section edit (13-homepage-cms §13.4). `sectionType` is displayed but never sent — its absence in the update schema is the immutability enforcement. */
export default function EditHomepageSectionPage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    apiGet<HomepageSectionAdminResponse>(`/api/admin/homepage/sections/${params.id}`)
      .then((section) => setState({ phase: 'loaded', section }))
      .catch((err: unknown) => {
        setState({ phase: 'error', message: err instanceof ApiClientError ? err.message : 'Something went wrong.', ...(err instanceof ApiClientError ? { status: err.status } : {}) });
      });
  }, [params.id]);

  if (state.phase === 'loading') return <p className="text-text-secondary">Loading…</p>;
  if (state.phase === 'error' && state.status === 403) {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">You do not have access to the Homepage Builder.</p>
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">Could not load the section</p>
        <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
      </div>
    );
  }

  async function handleSubmit(values: SectionFormValues) {
    const body: UpdateHomepageSectionRequest = {
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

    // ApiClientError is rethrown as-is so the form can show field-level errors.
    const stored = await apiPatch<HomepageSectionAdminResponse>(`/api/admin/homepage/sections/${params.id}`, body);
    // Show what the server actually kept (e.g. the sanitized custom-content body).
    return sectionToFormValues(stored);
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link href="/admin/content/homepage" className="mb-md inline-block text-sm font-semibold text-primary hover:underline">
        ← Back to homepage sections
      </Link>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Edit Section</h1>
      <HomepageSectionForm
        sectionType={state.section.sectionType}
        sectionId={state.section.id}
        initial={sectionToFormValues(state.section)}
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
      />
    </div>
  );
}
