'use client';

import { useState } from 'react';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { SelectField } from '@/components/admin/SelectField';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import type { ShippingStrategy, ShippingZoneView } from '@/lib/admin/types';
import {
  STRATEGY_LABELS,
  describeRate,
  rateToFormValues,
  validateRateForm,
  type RateFormValues,
  type RateRequestBody,
} from '@/lib/admin/shippingView';
import { RateChangeConfirm } from './RateChangeConfirm';

/** Strategy / Charge / Free-over inputs, shared by the rate form and the new-zone form. */
export function RateFields({
  idPrefix,
  values,
  onChange,
  errors,
  disabled,
}: {
  idPrefix: string;
  values: RateFormValues;
  onChange: (next: RateFormValues) => void;
  errors: Partial<Record<'flatAmount' | 'freeOverAmount', string>>;
  disabled?: boolean;
}) {
  return (
    <>
      <SelectField
        id={`${idPrefix}-strategy`}
        label="Strategy"
        value={values.strategy}
        disabled={disabled}
        onChange={(e) => onChange({ ...values, strategy: e.target.value as ShippingStrategy })}
      >
        {(Object.keys(STRATEGY_LABELS) as ShippingStrategy[]).map((s) => (
          <option key={s} value={s}>
            {STRATEGY_LABELS[s]}
          </option>
        ))}
      </SelectField>
      {values.strategy !== 'FREE' && (
        <FormField
          id={`${idPrefix}-flat`}
          label="Charge (৳)"
          inputMode="decimal"
          value={values.flatAmount}
          disabled={disabled}
          error={errors.flatAmount}
          onChange={(e) => onChange({ ...values, flatAmount: e.target.value })}
        />
      )}
      {values.strategy === 'FREE_OVER_THRESHOLD' && (
        <FormField
          id={`${idPrefix}-threshold`}
          label="Free over (threshold, ৳)"
          inputMode="decimal"
          value={values.freeOverAmount}
          disabled={disabled}
          error={errors.freeOverAmount}
          onChange={(e) => onChange({ ...values, freeOverAmount: e.target.value })}
        />
      )}
    </>
  );
}

/**
 * Supersedes a zone's rate (spec 21). Saving opens the confirmation; the POST is sent only from the
 * dialog's confirm button, and is disabled while pending so a second click cannot insert a second row.
 */
export function ShippingRateForm({
  zone,
  onSaved,
  onCancel,
}: {
  zone: ShippingZoneView;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<RateFormValues>(rateToFormValues(zone.currentRate));
  const [errors, setErrors] = useState<Partial<Record<'flatAmount' | 'freeOverAmount', string>>>({});
  const [pending, setPending] = useState<RateRequestBody | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function review() {
    setServerError(null);
    const result = validateRateForm(values);
    setErrors(result.errors);
    if (result.body) setPending(result.body);
  }

  async function confirm() {
    if (!pending || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      await apiPost(`/api/admin/shipping/zones/${zone.id}/rates`, pending);
      setPending(null);
      onSaved();
    } catch (err) {
      setPending(null);
      if (err instanceof ApiClientError) {
        setErrors({ flatAmount: err.fieldError('flatAmount'), freeOverAmount: err.fieldError('freeOverAmount') });
        setServerError(err.status === 403 ? 'You do not have permission to change shipping rates.' : err.message);
      } else {
        setServerError('Could not reach the server. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  const nextText = pending
    ? describeRate({
        strategy: pending.strategy,
        flatAmount: pending.flatAmount ?? 0,
        freeOverAmount: pending.freeOverAmount ?? null,
      })
    : '';

  return (
    <section aria-labelledby={`rate-form-${zone.id}`} className="rounded-lg border border-border bg-background p-lg">
      <h3 id={`rate-form-${zone.id}`} className="mb-md text-base font-bold">
        Change rate — {zone.name}
      </h3>
      <p className="mb-md text-sm text-text-secondary">Current: {describeRate(zone.currentRate)}</p>

      <RateFields idPrefix={`rate-${zone.id}`} values={values} onChange={setValues} errors={errors} disabled={pending !== null} />

      {serverError && (
        <p role="alert" className="mb-md text-sm text-error">
          {serverError}
        </p>
      )}

      {pending ? (
        <RateChangeConfirm
          title="Confirm new rate"
          current={describeRate(zone.currentRate)}
          next={nextText}
          message="This changes what customers are charged from now on. Existing orders are not affected."
          confirmLabel="Apply new rate"
          busy={saving}
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      ) : (
        <div className="flex flex-col gap-sm sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 w-full rounded-lg border-2 border-border text-sm font-bold text-text-primary sm:w-auto sm:px-lg"
          >
            Cancel
          </button>
          <Button type="button" onClick={review} className="h-12">
            Review change
          </Button>
        </div>
      )}
    </section>
  );
}
