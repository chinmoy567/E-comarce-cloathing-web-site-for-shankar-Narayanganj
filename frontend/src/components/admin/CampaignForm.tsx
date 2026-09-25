'use client';

import { useState, type FormEvent } from 'react';
import { FormField } from '@/components/admin/FormField';
import { Button } from '@/components/admin/Button';
import { ImageUploadField } from '@/components/admin/ImageUploadField';
import type { CampaignAdminResponse, CmsStoredStatus } from '@/lib/admin/types';

export type CampaignFormValues = {
  name: string;
  slug: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: CmsStoredStatus;
  heroTitle: string;
  heroSubtitle: string;
  heroCtaLabel: string;
  heroCtaUrl: string;
  heroDesktopImageUrl: string;
  accentColor: '' | 'primary' | 'secondary' | 'accent';
  bannerTreatment: '' | 'STANDARD' | 'FULL_BLEED' | 'SPLIT';
};

export function emptyCampaignFormValues(): CampaignFormValues {
  return {
    name: '',
    slug: '',
    description: '',
    startsAt: '',
    endsAt: '',
    status: 'ACTIVE',
    heroTitle: '',
    heroSubtitle: '',
    heroCtaLabel: '',
    heroCtaUrl: '',
    heroDesktopImageUrl: '',
    accentColor: '',
    bannerTreatment: '',
  };
}

export function campaignToFormValues(campaign: CampaignAdminResponse): CampaignFormValues {
  const hero = (campaign.heroContent as Record<string, unknown> | null) ?? {};
  const theme = (campaign.visualTheme as Record<string, unknown> | null) ?? {};
  return {
    name: campaign.name,
    slug: campaign.slug,
    description: campaign.description ?? '',
    startsAt: campaign.startsAt ? campaign.startsAt.slice(0, 16) : '',
    endsAt: campaign.endsAt ? campaign.endsAt.slice(0, 16) : '',
    status: campaign.status,
    heroTitle: (hero.title as string) ?? '',
    heroSubtitle: (hero.subtitle as string) ?? '',
    heroCtaLabel: (hero.ctaLabel as string) ?? '',
    heroCtaUrl: (hero.ctaUrl as string) ?? '',
    heroDesktopImageUrl: (hero.desktopImageUrl as string) ?? '',
    accentColor: (theme.accentColor as CampaignFormValues['accentColor']) ?? '',
    bannerTreatment: (theme.bannerTreatment as CampaignFormValues['bannerTreatment']) ?? '',
  };
}

export function campaignFormToPayload(values: CampaignFormValues) {
  const heroContent =
    values.heroTitle || values.heroSubtitle || values.heroCtaLabel || values.heroCtaUrl || values.heroDesktopImageUrl
      ? {
          title: values.heroTitle || undefined,
          subtitle: values.heroSubtitle || undefined,
          ctaLabel: values.heroCtaLabel || undefined,
          ctaUrl: values.heroCtaUrl || undefined,
          desktopImageUrl: values.heroDesktopImageUrl || undefined,
        }
      : undefined;

  const visualTheme =
    values.accentColor || values.bannerTreatment
      ? { accentColor: values.accentColor || undefined, bannerTreatment: values.bannerTreatment || undefined }
      : undefined;

  return {
    name: values.name,
    slug: values.slug,
    description: values.description || null,
    startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
    endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
    status: values.status,
    ...(heroContent ? { heroContent } : {}),
    ...(visualTheme ? { visualTheme } : {}),
  };
}

/** Shared campaign editor (13-homepage-cms §13.7, plan §6). `heroContent`/`visualTheme` map to the same field set §13.13 constrains. */
export function CampaignForm({
  initial,
  onSubmit,
  submitLabel,
}: {
  initial: CampaignFormValues;
  onSubmit: (values: CampaignFormValues) => Promise<void>;
  submitLabel: string;
}) {
  const [values, setValues] = useState<CampaignFormValues>(initial);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  function set<K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhase('submitting');
    setErrorMessage('');
    try {
      await onSubmit(values);
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto max-w-lg">
      <FormField label="Name" id="name" required value={values.name} onChange={(e) => set('name', e.target.value)} />
      <FormField label="Slug" id="slug" required value={values.slug} onChange={(e) => set('slug', e.target.value)} />
      <FormField label="Description" id="description" value={values.description} onChange={(e) => set('description', e.target.value)} />

      <div className="mb-lg w-full">
        <label htmlFor="status" className="mb-sm block text-xs font-semibold text-text-primary">
          Status
        </label>
        <select
          id="status"
          value={values.status}
          onChange={(e) => set('status', e.target.value as CampaignFormValues['status'])}
          className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
        >
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </div>

      <FormField label="Starts at" id="startsAt" type="datetime-local" value={values.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
      <FormField label="Ends at" id="endsAt" type="datetime-local" value={values.endsAt} onChange={(e) => set('endsAt', e.target.value)} />

      <p className="mb-sm mt-lg text-sm font-semibold text-text-primary">Hero content (optional override)</p>
      <FormField label="Hero title" id="heroTitle" value={values.heroTitle} onChange={(e) => set('heroTitle', e.target.value)} />
      <FormField label="Hero subtitle" id="heroSubtitle" value={values.heroSubtitle} onChange={(e) => set('heroSubtitle', e.target.value)} />
      <FormField label="Hero CTA label" id="heroCtaLabel" value={values.heroCtaLabel} onChange={(e) => set('heroCtaLabel', e.target.value)} />
      <FormField label="Hero CTA URL" id="heroCtaUrl" value={values.heroCtaUrl} onChange={(e) => set('heroCtaUrl', e.target.value)} />
      <ImageUploadField
        label="Hero image"
        id="heroDesktopImageUrl"
        kind="campaign-hero"
        value={values.heroDesktopImageUrl}
        onChange={(url) => set('heroDesktopImageUrl', url)}
      />

      <p className="mb-sm mt-lg text-sm font-semibold text-text-primary">Visual theme</p>
      <div className="mb-lg w-full">
        <label htmlFor="accentColor" className="mb-sm block text-xs font-semibold text-text-primary">
          Accent color
        </label>
        <select
          id="accentColor"
          value={values.accentColor}
          onChange={(e) => set('accentColor', e.target.value as CampaignFormValues['accentColor'])}
          className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
        >
          <option value="">None</option>
          <option value="primary">Primary</option>
          <option value="secondary">Secondary</option>
          <option value="accent">Accent</option>
        </select>
      </div>
      <div className="mb-lg w-full">
        <label htmlFor="bannerTreatment" className="mb-sm block text-xs font-semibold text-text-primary">
          Banner treatment
        </label>
        <select
          id="bannerTreatment"
          value={values.bannerTreatment}
          onChange={(e) => set('bannerTreatment', e.target.value as CampaignFormValues['bannerTreatment'])}
          className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
        >
          <option value="">None</option>
          <option value="STANDARD">Standard</option>
          <option value="FULL_BLEED">Full bleed</option>
          <option value="SPLIT">Split</option>
        </select>
      </div>

      {phase === 'error' && (
        <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="text-sm text-error">{errorMessage}</p>
        </div>
      )}

      <Button type="submit" loading={phase === 'submitting'}>
        {submitLabel}
      </Button>
    </form>
  );
}
