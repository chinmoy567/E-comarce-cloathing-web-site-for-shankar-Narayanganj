'use client';

import { useState, type FormEvent } from 'react';
import { ApiClientError } from '@/lib/apiClient';
import { FormField } from '@/components/admin/FormField';
import { SelectField } from '@/components/admin/SelectField';
import { Button } from '@/components/admin/Button';
import { ImageUploadField } from '@/components/admin/ImageUploadField';
import { CategoryAttachmentEditor } from '@/components/admin/homepage/CategoryAttachmentEditor';
import { ProductAttachmentEditor } from '@/components/admin/homepage/ProductAttachmentEditor';
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
  heroMobileImageUrl: string;
  accent: '' | 'PRIMARY' | 'DARK' | 'ACCENT';
  treatment: '' | 'PLAIN' | 'BORDERED';
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
    heroMobileImageUrl: '',
    accent: '',
    treatment: '',
  };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function campaignToFormValues(campaign: CampaignAdminResponse): CampaignFormValues {
  const hero = (campaign.heroContent as Record<string, unknown> | null) ?? {};
  const theme = (campaign.visualTheme as Record<string, unknown> | null) ?? {};
  return {
    name: campaign.name,
    slug: campaign.slug,
    description: campaign.description ?? '',
    startsAt: toLocalInput(campaign.startsAt),
    endsAt: toLocalInput(campaign.endsAt),
    status: campaign.status,
    heroTitle: (hero.title as string) ?? '',
    heroSubtitle: (hero.subtitle as string) ?? '',
    heroCtaLabel: (hero.ctaLabel as string) ?? '',
    heroCtaUrl: (hero.ctaUrl as string) ?? '',
    heroDesktopImageUrl: (hero.desktopImageUrl as string) ?? '',
    heroMobileImageUrl: (hero.mobileImageUrl as string) ?? '',
    accent: (theme.accent as CampaignFormValues['accent']) ?? '',
    treatment: (theme.treatment as CampaignFormValues['treatment']) ?? '',
  };
}

export function campaignFormToPayload(values: CampaignFormValues) {
  const hasHero = values.heroTitle || values.heroSubtitle || values.heroCtaLabel || values.heroCtaUrl || values.heroDesktopImageUrl || values.heroMobileImageUrl;
  const heroContent = hasHero
    ? {
        title: values.heroTitle || undefined,
        subtitle: values.heroSubtitle || undefined,
        ctaLabel: values.heroCtaLabel || undefined,
        ctaUrl: values.heroCtaUrl || undefined,
        desktopImageUrl: values.heroDesktopImageUrl || undefined,
        mobileImageUrl: values.heroMobileImageUrl || undefined,
      }
    : null;

  const visualTheme = values.accent || values.treatment ? { accent: values.accent || undefined, treatment: values.treatment || undefined } : null;

  return {
    name: values.name,
    slug: values.slug,
    description: values.description || null,
    startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
    endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
    status: values.status,
    heroContent,
    visualTheme,
  };
}

type FieldErrors = Record<string, string>;

function validateLocally(values: CampaignFormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = 'Required.';
  if (!values.slug.trim()) errors.slug = 'Required.';
  else if (!/^[a-z0-9-]+$/.test(values.slug)) errors.slug = 'Use lowercase letters, numbers and hyphens only.';
  if (values.startsAt && values.endsAt && new Date(values.endsAt) <= new Date(values.startsAt)) errors.endsAt = 'Must be after the start time.';
  if (values.heroCtaLabel && !values.heroCtaUrl) errors['heroContent.ctaUrl'] = 'A URL is required when a label is set.';
  if (values.heroCtaUrl && !(values.heroCtaUrl.startsWith('/') || values.heroCtaUrl.startsWith('https://'))) {
    errors['heroContent.ctaUrl'] = 'Must start with / or https://';
  }
  return errors;
}

/**
 * Shared campaign editor (13-homepage-cms §13.7). `heroContent` and
 * `visualTheme` use the bounded shapes §13.13 requires (no raw CSS). Product and
 * category attachment need a saved campaign, so they appear only with `campaignId`.
 */
export function CampaignForm({
  campaignId,
  initial,
  onSubmit,
  submitLabel,
}: {
  campaignId?: string;
  initial: CampaignFormValues;
  onSubmit: (values: CampaignFormValues) => Promise<void>;
  submitLabel: string;
}) {
  const [values, setValues] = useState<CampaignFormValues>(initial);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function set<K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === 'submitting') return;

    const local = validateLocally(values);
    setFieldErrors(local);
    if (Object.keys(local).length > 0) {
      setPhase('error');
      setErrorMessage('Please fix the highlighted fields.');
      return;
    }

    setPhase('submitting');
    setErrorMessage('');
    try {
      await onSubmit(values);
      setPhase('saved');
    } catch (err) {
      setPhase('error');
      if (err instanceof ApiClientError && err.details.length > 0) {
        const mapped: FieldErrors = {};
        for (const detail of err.details) mapped[detail.field] = detail.message;
        setFieldErrors(mapped);
        setErrorMessage('Please fix the highlighted fields.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto max-w-lg">
      <FormField label="Name" id="name" required value={values.name} error={fieldErrors.name} onChange={(e) => set('name', e.target.value)} />
      <FormField label="Slug" id="slug" required value={values.slug} error={fieldErrors.slug} onChange={(e) => set('slug', e.target.value)} />
      <FormField label="Description" id="description" value={values.description} error={fieldErrors.description} onChange={(e) => set('description', e.target.value)} />

      <SelectField label="Status" id="status" value={values.status} onChange={(e) => set('status', e.target.value as CmsStoredStatus)}>
        <option value="DRAFT">Draft</option>
        <option value="ACTIVE">Active</option>
        <option value="DISABLED">Disabled</option>
      </SelectField>

      <p className="mb-sm text-xs text-text-secondary">Times are in your browser&apos;s time zone.</p>
      <FormField label="Starts at" id="startsAt" type="datetime-local" value={values.startsAt} error={fieldErrors.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
      <FormField label="Ends at" id="endsAt" type="datetime-local" value={values.endsAt} error={fieldErrors.endsAt} onChange={(e) => set('endsAt', e.target.value)} />

      <p className="mb-sm mt-lg text-sm font-semibold text-text-primary">Hero content (optional override)</p>
      <FormField label="Hero title" id="heroTitle" value={values.heroTitle} error={fieldErrors['heroContent.title']} onChange={(e) => set('heroTitle', e.target.value)} />
      <FormField label="Hero subtitle" id="heroSubtitle" value={values.heroSubtitle} error={fieldErrors['heroContent.subtitle']} onChange={(e) => set('heroSubtitle', e.target.value)} />
      <FormField label="Hero CTA label" id="heroCtaLabel" value={values.heroCtaLabel} error={fieldErrors['heroContent.ctaLabel']} onChange={(e) => set('heroCtaLabel', e.target.value)} />
      <FormField label="Hero CTA URL" id="heroCtaUrl" value={values.heroCtaUrl} error={fieldErrors['heroContent.ctaUrl']} onChange={(e) => set('heroCtaUrl', e.target.value)} />
      <ImageUploadField label="Hero image (desktop)" id="heroDesktopImageUrl" kind="campaign-hero" value={values.heroDesktopImageUrl} onChange={(url) => set('heroDesktopImageUrl', url)} />
      <ImageUploadField label="Hero image (mobile)" id="heroMobileImageUrl" kind="campaign-hero" value={values.heroMobileImageUrl} onChange={(url) => set('heroMobileImageUrl', url)} />

      <p className="mb-sm mt-lg text-sm font-semibold text-text-primary">Visual theme</p>
      <SelectField label="Accent" id="accent" value={values.accent} onChange={(e) => set('accent', e.target.value as CampaignFormValues['accent'])}>
        <option value="">None</option>
        <option value="PRIMARY">Primary</option>
        <option value="DARK">Dark</option>
        <option value="ACCENT">Accent</option>
      </SelectField>
      <SelectField label="Banner treatment" id="treatment" value={values.treatment} onChange={(e) => set('treatment', e.target.value as CampaignFormValues['treatment'])}>
        <option value="">None</option>
        <option value="PLAIN">Plain</option>
        <option value="BORDERED">Bordered</option>
      </SelectField>

      {campaignId ? (
        <>
          <ProductAttachmentEditor target={{ kind: 'campaign', id: campaignId }} />
          <CategoryAttachmentEditor target={{ kind: 'campaign', id: campaignId }} />
        </>
      ) : (
        <p className="mb-lg text-sm text-text-secondary">Save the campaign first, then attach products and categories.</p>
      )}

      {phase === 'error' && (
        <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="text-sm text-error">{errorMessage}</p>
        </div>
      )}
      {phase === 'saved' && (
        <p role="status" className="mb-lg text-sm text-accent">
          Saved.
        </p>
      )}

      <Button type="submit" loading={phase === 'submitting'}>
        {submitLabel}
      </Button>
    </form>
  );
}
