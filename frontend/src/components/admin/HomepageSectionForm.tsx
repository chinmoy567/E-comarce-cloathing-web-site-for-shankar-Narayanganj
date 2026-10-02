'use client';

import { useState, type FormEvent } from 'react';
import { ApiClientError } from '@/lib/apiClient';
import { FormField } from '@/components/admin/FormField';
import { SelectField } from '@/components/admin/SelectField';
import { Button } from '@/components/admin/Button';
import { ImageUploadField } from '@/components/admin/ImageUploadField';
import { CampaignSelect } from '@/components/admin/homepage/CampaignSelect';
import { CategoryAttachmentEditor } from '@/components/admin/homepage/CategoryAttachmentEditor';
import { ProductAttachmentEditor } from '@/components/admin/homepage/ProductAttachmentEditor';
import { useCategoryLookup } from '@/components/admin/homepage/useCategoryLookup';
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

function isSafeUrl(value: string): boolean {
  return (value.startsWith('/') && !value.startsWith('//')) || value.startsWith('https://');
}

type FieldErrors = Record<string, string>;

/** UX-only checks; the backend stays authoritative and its errors are shown field-by-field. */
function validateLocally(sectionType: SectionType, values: SectionFormValues): FieldErrors {
  const errors: FieldErrors = {};
  const pairs: Array<[string, string, string, string]> = [
    ['ctaLabel', values.ctaLabel, 'ctaUrl', values.ctaUrl],
    ['secondaryCtaLabel', values.secondaryCtaLabel, 'secondaryCtaUrl', values.secondaryCtaUrl],
  ];
  for (const [labelKey, label, urlKey, url] of pairs) {
    if (label && !url) errors[urlKey] = 'A URL is required when a label is set.';
    if (url && !label) errors[labelKey] = 'A label is required when a URL is set.';
    if (url && !isSafeUrl(url)) errors[urlKey] = 'Must start with / or https://';
  }
  if (values.startsAt && values.endsAt && new Date(values.endsAt) <= new Date(values.startsAt)) {
    errors.endsAt = 'Must be after the start time.';
  }
  if (sectionType === 'CAMPAIGN_BANNER' && !values.campaignId) errors.campaignId = 'A campaign is required.';
  if (sectionType === 'PRODUCT_CAROUSEL') {
    const config = values.contentConfig;
    if ((config.mode ?? 'AUTOMATIC') === 'AUTOMATIC') {
      const limit = Number(config.limit ?? 12);
      if (!Number.isInteger(limit) || limit < 1 || limit > 24) errors['contentConfig.limit'] = 'Must be between 1 and 24.';
      if (config.rule === 'CATEGORY' && !config.categoryId) errors['contentConfig.categoryId'] = 'Select a category.';
    }
  }
  return errors;
}

/**
 * Shared section editor (13-homepage-cms §13.4, §13.12). Shows only the
 * `content_config` fields relevant to the section's own type; `sectionType` is
 * fixed after creation. Product/category attachment editors need a saved
 * section, so they appear only when `sectionId` is provided (edit page).
 *
 * `onSubmit` may return the stored values; the form then shows what was kept
 * (e.g. the sanitized custom-content body).
 */
export function HomepageSectionForm({
  sectionType,
  sectionId,
  initial,
  onSubmit,
  submitLabel,
}: {
  sectionType: SectionType;
  sectionId?: string;
  initial: SectionFormValues;
  onSubmit: (values: SectionFormValues) => Promise<SectionFormValues | void>;
  submitLabel: string;
}) {
  const [values, setValues] = useState<SectionFormValues>(initial);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const { categories } = useCategoryLookup();

  function set<K extends keyof SectionFormValues>(key: K, value: SectionFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function setConfig(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, contentConfig: { ...prev.contentConfig, [key]: value } }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === 'submitting') return;

    const local = validateLocally(sectionType, values);
    setFieldErrors(local);
    if (Object.keys(local).length > 0) {
      setPhase('error');
      setErrorMessage('Please fix the highlighted fields.');
      return;
    }

    setPhase('submitting');
    setErrorMessage('');
    try {
      const stored = await onSubmit(values);
      if (stored) setValues(stored);
      setPhase('saved');
    } catch (err) {
      setPhase('error');
      if (err instanceof ApiClientError && err.details.length > 0) {
        const mapped: FieldErrors = {};
        for (const detail of err.details) mapped[detail.field] = detail.message;
        setFieldErrors(mapped);
        setErrorMessage(err.code === 'INVALID_URL' || err.code === 'VALIDATION_ERROR' ? 'Please fix the highlighted fields.' : err.message);
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    }
  }

  const disabled = phase === 'submitting';
  const config = values.contentConfig;
  const mode = (config.mode as string | undefined) ?? (sectionType === 'CATEGORY_GRID' ? 'ALL_ACTIVE_TOP_LEVEL' : 'AUTOMATIC');

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto max-w-lg">
      <p className="mb-lg text-sm font-semibold text-text-secondary">Section type: {SECTION_TYPE_LABEL[sectionType]}</p>

      <FormField label="Title" id="title" value={values.title} error={fieldErrors.title} onChange={(e) => set('title', e.target.value)} />
      <FormField label="Subtitle" id="subtitle" value={values.subtitle} error={fieldErrors.subtitle} onChange={(e) => set('subtitle', e.target.value)} />

      <SelectField label="Status" id="status" value={values.status} error={fieldErrors.status} onChange={(e) => set('status', e.target.value as CmsStoredStatus)}>
        <option value="DRAFT">Draft</option>
        <option value="ACTIVE">Active</option>
        <option value="DISABLED">Disabled</option>
      </SelectField>

      {sectionType !== 'CUSTOM_CONTENT' && (
        <>
          <FormField label="CTA label" id="ctaLabel" value={values.ctaLabel} error={fieldErrors.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} />
          <FormField label="CTA URL" id="ctaUrl" value={values.ctaUrl} error={fieldErrors.ctaUrl} onChange={(e) => set('ctaUrl', e.target.value)} />
        </>
      )}

      {sectionType === 'HERO' && (
        <>
          <FormField
            label="Secondary CTA label"
            id="secondaryCtaLabel"
            value={values.secondaryCtaLabel}
            error={fieldErrors.secondaryCtaLabel}
            onChange={(e) => set('secondaryCtaLabel', e.target.value)}
          />
          <FormField
            label="Secondary CTA URL"
            id="secondaryCtaUrl"
            value={values.secondaryCtaUrl}
            error={fieldErrors.secondaryCtaUrl}
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

      <p className="mb-sm text-xs text-text-secondary">Times are in your browser&apos;s time zone.</p>
      <FormField label="Starts at" id="startsAt" type="datetime-local" value={values.startsAt} error={fieldErrors.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
      <FormField label="Ends at" id="endsAt" type="datetime-local" value={values.endsAt} error={fieldErrors.endsAt} onChange={(e) => set('endsAt', e.target.value)} />

      {(sectionType === 'CAMPAIGN_BANNER' || sectionType === 'HERO' || sectionType === 'PROMO_BANNER') && (
        <CampaignSelect
          value={values.campaignId}
          required={sectionType === 'CAMPAIGN_BANNER'}
          error={fieldErrors.campaignId}
          onChange={(id) => set('campaignId', id)}
        />
      )}

      {sectionType === 'HERO' && (
        <SelectField
          label="Overlay position"
          id="overlayPosition"
          value={(config.overlayPosition as string) ?? ''}
          onChange={(e) => setConfig('overlayPosition', e.target.value || undefined)}
        >
          <option value="">Default</option>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </SelectField>
      )}

      {sectionType === 'CATEGORY_GRID' && (
        <>
          <SelectField label="Mode" id="mode" value={mode} onChange={(e) => setConfig('mode', e.target.value)}>
            <option value="ALL_ACTIVE_TOP_LEVEL">All active top-level categories</option>
            <option value="MANUAL">Manual selection</option>
          </SelectField>
          <SelectField
            label="Columns (large screens)"
            id="columns"
            value={String(config.columns ?? 4)}
            onChange={(e) => setConfig('columns', Number(e.target.value))}
          >
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </SelectField>
          {mode === 'MANUAL' &&
            (sectionId ? (
              <CategoryAttachmentEditor target={{ kind: 'section', id: sectionId }} />
            ) : (
              <p className="mb-lg text-sm text-text-secondary">Save the section first, then choose its categories.</p>
            ))}
        </>
      )}

      {sectionType === 'PRODUCT_CAROUSEL' && (
        <>
          <SelectField
            label="Mode"
            id="pcMode"
            value={mode}
            onChange={(e) => {
              // Switching modes replaces the whole config so no stale key survives the strict server schema.
              setValues((prev) => ({
                ...prev,
                contentConfig: e.target.value === 'MANUAL' ? { mode: 'MANUAL', sort: 'manually_selected' } : { mode: 'AUTOMATIC', rule: 'LATEST', limit: 12 },
              }));
            }}
          >
            <option value="AUTOMATIC">Automatic</option>
            <option value="MANUAL">Manual selection</option>
          </SelectField>

          {mode === 'AUTOMATIC' && (
            <>
              <SelectField
                label="Rule"
                id="rule"
                value={(config.rule as string) ?? 'LATEST'}
                onChange={(e) => {
                  const next: Record<string, unknown> = { ...config, rule: e.target.value };
                  if (e.target.value !== 'CATEGORY') delete next.categoryId;
                  setValues((prev) => ({ ...prev, contentConfig: next }));
                }}
              >
                <option value="LATEST">Latest</option>
                <option value="FEATURED">Featured</option>
                <option value="CATEGORY">Category</option>
                <option value="ON_SALE">On sale</option>
              </SelectField>

              {config.rule === 'CATEGORY' && (
                <SelectField
                  label="Category"
                  id="categoryId"
                  required
                  value={(config.categoryId as string) ?? ''}
                  error={fieldErrors['contentConfig.categoryId']}
                  onChange={(e) => setConfig('categoryId', e.target.value || undefined)}
                >
                  <option value="">Select a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.parentId ? '— ' : ''}
                      {category.name}
                    </option>
                  ))}
                </SelectField>
              )}

              <FormField
                label="Limit (1–24)"
                id="limit"
                type="number"
                min={1}
                max={24}
                value={String(config.limit ?? 12)}
                error={fieldErrors['contentConfig.limit']}
                onChange={(e) => setConfig('limit', Number(e.target.value))}
              />
            </>
          )}

          {mode === 'MANUAL' &&
            (sectionId ? (
              <ProductAttachmentEditor target={{ kind: 'section', id: sectionId }} />
            ) : (
              <p className="mb-lg text-sm text-text-secondary">Save the section first, then choose its products.</p>
            ))}
        </>
      )}

      {sectionType === 'PROMO_BANNER' && (
        <>
          <SelectField
            label="Link type"
            id="linkType"
            value={(config.linkType as string) ?? ''}
            onChange={(e) => setConfig('linkType', e.target.value || undefined)}
          >
            <option value="">None</option>
            <option value="CATEGORY">Category</option>
            <option value="COUPON">Coupon</option>
            <option value="URL">URL</option>
          </SelectField>
          {config.linkType === 'CATEGORY' && (
            <SelectField
              label="Category"
              id="promoCategoryId"
              value={(config.categoryId as string) ?? ''}
              onChange={(e) => {
                const category = categories.find((c) => c.id === e.target.value);
                setConfig('categoryId', e.target.value || undefined);
                // The storefront links through `ctaUrl` alone, so fill it from the chosen category.
                if (category) set('ctaUrl', `/category/${category.slug}`);
              }}
            >
              <option value="">Select a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parentId ? '— ' : ''}
                  {category.name}
                </option>
              ))}
            </SelectField>
          )}
          {config.linkType === 'COUPON' && (
            <FormField label="Coupon code (shown as text only)" id="couponCode" value={(config.couponCode as string) ?? ''} onChange={(e) => setConfig('couponCode', e.target.value)} />
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
          <p className="mt-xs text-xs text-text-secondary">Unsupported markup is removed when you save.</p>
        </div>
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

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    startsAt: toLocalInput(section.startsAt),
    endsAt: toLocalInput(section.endsAt),
    campaignId: section.campaignId ?? '',
    contentConfig: (section.contentConfig as Record<string, unknown>) ?? {},
  };
}
