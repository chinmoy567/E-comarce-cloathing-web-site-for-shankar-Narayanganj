'use client';

import { useState, type FormEvent } from 'react';
import { FormField } from '@/components/admin/FormField';
import { Button } from '@/components/admin/Button';
import { ImageUploadField } from '@/components/admin/ImageUploadField';
import type { CmsStoredStatus, HomepageSectionAdminResponse, SectionType } from '@/lib/admin/types';

export type SectionFormValues = {
  title: string;
  subtitle: string;
  status: CmsStoredStatus;
  ctaLabel: string;
  ctaUrl: string;
  secondaryCtaLabel: string;
  secondaryCtaUrl: string;
  desktopImageUrl: string;
  mobileImageUrl: string;
  startsAt: string;
  endsAt: string;
  campaignId: string;
  contentConfig: Record<string, unknown>;
};

const SECTION_TYPE_LABEL: Record<SectionType, string> = {
  HERO: 'Hero',
  CATEGORY_GRID: 'Category Grid',
  PRODUCT_CAROUSEL: 'Product Carousel',
  CAMPAIGN_BANNER: 'Campaign Banner',
  PROMO_BANNER: 'Promo Banner',
  CUSTOM_CONTENT: 'Custom Content',
};

function toIsoOrUndefined(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

/**
 * Shared section editor (13-homepage-cms §13.4, §13.12, plan §6). Shows only
 * the `content_config` fields relevant to the section's own type;
 * `sectionType` itself is fixed after creation (§13.4) — the `new` page picks
 * it once, the edit page displays it read-only.
 */
export function HomepageSectionForm({
  sectionType,
  initial,
  onSubmit,
  submitLabel,
}: {
  sectionType: SectionType;
  initial: SectionFormValues;
  onSubmit: (values: SectionFormValues) => Promise<void>;
  submitLabel: string;
}) {
  const [values, setValues] = useState<SectionFormValues>(initial);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  function set<K extends keyof SectionFormValues>(key: K, value: SectionFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function setConfig(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, contentConfig: { ...prev.contentConfig, [key]: value } }));
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

  const disabled = phase === 'submitting';
  const config = values.contentConfig;

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto max-w-lg">
      <p className="mb-lg text-sm font-semibold text-text-secondary">Section type: {SECTION_TYPE_LABEL[sectionType]}</p>

      <FormField label="Title" id="title" value={values.title} onChange={(e) => set('title', e.target.value)} />
      <FormField label="Subtitle" id="subtitle" value={values.subtitle} onChange={(e) => set('subtitle', e.target.value)} />

      <div className="mb-lg w-full">
        <label htmlFor="status" className="mb-sm block text-xs font-semibold text-text-primary">
          Status
        </label>
        <select
          id="status"
          value={values.status}
          onChange={(e) => set('status', e.target.value as CmsStoredStatus)}
          className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
        >
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </div>

      {sectionType !== 'CUSTOM_CONTENT' && (
        <>
          <FormField label="CTA label" id="ctaLabel" value={values.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} />
          <FormField label="CTA URL" id="ctaUrl" value={values.ctaUrl} onChange={(e) => set('ctaUrl', e.target.value)} />
        </>
      )}

      {sectionType === 'HERO' && (
        <>
          <FormField
            label="Secondary CTA label"
            id="secondaryCtaLabel"
            value={values.secondaryCtaLabel}
            onChange={(e) => set('secondaryCtaLabel', e.target.value)}
          />
          <FormField
            label="Secondary CTA URL"
            id="secondaryCtaUrl"
            value={values.secondaryCtaUrl}
            onChange={(e) => set('secondaryCtaUrl', e.target.value)}
          />
        </>
      )}

      {sectionType !== 'CUSTOM_CONTENT' && (
        <>
          <ImageUploadField label="Desktop image" id="desktopImageUrl" kind="section-desktop" value={values.desktopImageUrl} onChange={(url) => set('desktopImageUrl', url)} />
          <ImageUploadField label="Mobile image" id="mobileImageUrl" kind="section-mobile" value={values.mobileImageUrl} onChange={(url) => set('mobileImageUrl', url)} />
        </>
      )}

      <FormField
        label="Starts at"
        id="startsAt"
        type="datetime-local"
        value={values.startsAt}
        onChange={(e) => set('startsAt', e.target.value)}
      />
      <FormField label="Ends at" id="endsAt" type="datetime-local" value={values.endsAt} onChange={(e) => set('endsAt', e.target.value)} />

      {(sectionType === 'CAMPAIGN_BANNER' || sectionType === 'HERO' || sectionType === 'PROMO_BANNER') && (
        <FormField
          label={sectionType === 'CAMPAIGN_BANNER' ? 'Campaign ID (required)' : 'Campaign ID (optional)'}
          id="campaignId"
          value={values.campaignId}
          onChange={(e) => set('campaignId', e.target.value)}
        />
      )}

      {sectionType === 'HERO' && (
        <div className="mb-lg w-full">
          <label htmlFor="overlayPosition" className="mb-sm block text-xs font-semibold text-text-primary">
            Overlay position
          </label>
          <select
            id="overlayPosition"
            value={(config.overlayPosition as string) ?? ''}
            onChange={(e) => setConfig('overlayPosition', e.target.value || undefined)}
            className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
          >
            <option value="">Default</option>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      )}

      {sectionType === 'CATEGORY_GRID' && (
        <>
          <div className="mb-lg w-full">
            <label htmlFor="mode" className="mb-sm block text-xs font-semibold text-text-primary">
              Mode
            </label>
            <select
              id="mode"
              value={(config.mode as string) ?? 'ALL_ACTIVE_TOP_LEVEL'}
              onChange={(e) => setConfig('mode', e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
            >
              <option value="ALL_ACTIVE_TOP_LEVEL">All active top-level categories</option>
              <option value="MANUAL">Manual selection</option>
            </select>
          </div>
        </>
      )}

      {sectionType === 'PRODUCT_CAROUSEL' && (
        <>
          <div className="mb-lg w-full">
            <label htmlFor="pcMode" className="mb-sm block text-xs font-semibold text-text-primary">
              Mode
            </label>
            <select
              id="pcMode"
              value={(config.mode as string) ?? 'AUTOMATIC'}
              onChange={(e) => setConfig('mode', e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
            >
              <option value="AUTOMATIC">Automatic</option>
              <option value="MANUAL">Manual selection</option>
            </select>
          </div>

          {(config.mode ?? 'AUTOMATIC') === 'AUTOMATIC' && (
            <>
              <div className="mb-lg w-full">
                <label htmlFor="rule" className="mb-sm block text-xs font-semibold text-text-primary">
                  Rule
                </label>
                <select
                  id="rule"
                  value={(config.rule as string) ?? 'LATEST'}
                  onChange={(e) => setConfig('rule', e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
                >
                  <option value="LATEST">Latest</option>
                  <option value="FEATURED">Featured</option>
                  <option value="CATEGORY">Category</option>
                  <option value="ON_SALE">On sale</option>
                </select>
              </div>

              {config.rule === 'CATEGORY' && (
                <FormField
                  label="Category ID"
                  id="categoryId"
                  value={(config.categoryId as string) ?? ''}
                  onChange={(e) => setConfig('categoryId', e.target.value)}
                />
              )}

              <FormField
                label="Limit"
                id="limit"
                type="number"
                min={1}
                max={24}
                value={String(config.limit ?? 12)}
                onChange={(e) => setConfig('limit', Number(e.target.value))}
              />
            </>
          )}
        </>
      )}

      {sectionType === 'PROMO_BANNER' && (
        <>
          <div className="mb-lg w-full">
            <label htmlFor="linkType" className="mb-sm block text-xs font-semibold text-text-primary">
              Link type
            </label>
            <select
              id="linkType"
              value={(config.linkType as string) ?? ''}
              onChange={(e) => setConfig('linkType', e.target.value || undefined)}
              className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
            >
              <option value="">None</option>
              <option value="CATEGORY">Category</option>
              <option value="COUPON">Coupon</option>
              <option value="URL">URL</option>
            </select>
          </div>
          {config.linkType === 'CATEGORY' && (
            <FormField label="Category ID" id="promoCategoryId" value={(config.categoryId as string) ?? ''} onChange={(e) => setConfig('categoryId', e.target.value)} />
          )}
          {config.linkType === 'COUPON' && (
            <FormField label="Coupon code" id="couponCode" value={(config.couponCode as string) ?? ''} onChange={(e) => setConfig('couponCode', e.target.value)} />
          )}
        </>
      )}

      {sectionType === 'CUSTOM_CONTENT' && (
        <div className="mb-lg w-full">
          <label htmlFor="body" className="mb-sm block text-xs font-semibold text-text-primary">
            Body
          </label>
          <textarea
            id="body"
            rows={8}
            value={(config.body as string) ?? ''}
            onChange={(e) => setConfig('body', e.target.value)}
            className="w-full rounded-lg border border-border bg-background p-md text-base text-text-primary"
          />
          <p className="mt-xs text-xs text-text-secondary">Sanitized server-side before storage.</p>
        </div>
      )}

      {phase === 'error' && (
        <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="text-sm text-error">{errorMessage}</p>
        </div>
      )}

      <Button type="submit" loading={disabled}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function toCreatePayloadDates(values: SectionFormValues) {
  return {
    startsAt: toIsoOrUndefined(values.startsAt) ?? null,
    endsAt: toIsoOrUndefined(values.endsAt) ?? null,
  };
}

export function emptySectionFormValues(sectionType: SectionType): SectionFormValues {
  const defaults: Record<SectionType, Record<string, unknown>> = {
    HERO: {},
    CATEGORY_GRID: { mode: 'ALL_ACTIVE_TOP_LEVEL' },
    PRODUCT_CAROUSEL: { mode: 'AUTOMATIC', rule: 'LATEST', limit: 12 },
    CAMPAIGN_BANNER: {},
    PROMO_BANNER: {},
    CUSTOM_CONTENT: { body: '' },
  };

  return {
    title: '',
    subtitle: '',
    status: 'DRAFT',
    ctaLabel: '',
    ctaUrl: '',
    secondaryCtaLabel: '',
    secondaryCtaUrl: '',
    desktopImageUrl: '',
    mobileImageUrl: '',
    startsAt: '',
    endsAt: '',
    campaignId: '',
    contentConfig: defaults[sectionType],
  };
}

export function sectionToFormValues(section: HomepageSectionAdminResponse): SectionFormValues {
  return {
    title: section.title ?? '',
    subtitle: section.subtitle ?? '',
    status: section.status,
    ctaLabel: section.ctaLabel ?? '',
    ctaUrl: section.ctaUrl ?? '',
    secondaryCtaLabel: section.secondaryCtaLabel ?? '',
    secondaryCtaUrl: section.secondaryCtaUrl ?? '',
    desktopImageUrl: section.desktopImageUrl ?? '',
    mobileImageUrl: section.mobileImageUrl ?? '',
    startsAt: section.startsAt ? section.startsAt.slice(0, 16) : '',
    endsAt: section.endsAt ? section.endsAt.slice(0, 16) : '',
    campaignId: section.campaignId ?? '',
    contentConfig: (section.contentConfig as Record<string, unknown>) ?? {},
  };
}
