'use client';

import { useState } from 'react';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { ToggleField } from '@/components/admin/ToggleField';
import { apiPatch, apiPost, ApiClientError } from '@/lib/apiClient';
import type { ShippingDistrictMapping, ShippingZoneView } from '@/lib/admin/types';
import {
  EMPTY_RATE_FORM,
  cleanDistrictRows,
  findDistrictConflicts,
  findDuplicateDistrict,
  validateRateForm,
  validateZoneCode,
  type RateFormValues,
} from '@/lib/admin/shippingView';
import { RateFields } from './ShippingRateForm';

/**
 * Create or edit a zone (spec 21). `districts` is always sent as the FULL replacement list. There is no
 * delete control anywhere: a district is removed by editing the list, a rate is superseded, never deleted.
 * The default zone has no district rows by design — it is used when no district matches.
 */
export function ShippingZoneForm({
  zone,
  zones,
  onSaved,
  onCancel,
}: {
  zone?: ShippingZoneView;
  /** Every zone, to flag a district already assigned elsewhere before the backend rejects it. */
  zones: ShippingZoneView[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = zone !== undefined;
  const [code, setCode] = useState(zone?.code ?? '');
  const [name, setName] = useState(zone?.name ?? '');
  const [rows, setRows] = useState<ShippingDistrictMapping[]>(zone?.districts ?? []);
  const [rate, setRate] = useState<RateFormValues>(EMPTY_RATE_FORM);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const isDefaultZone = zone?.isDefault === true;
  const conflicts = isDefaultZone ? [] : findDistrictConflicts(zones, zone?.id ?? null, rows);

  function updateRow(index: number, patch: Partial<ShippingDistrictMapping>) {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (saving) return;
    setServerError(null);

    const next: Record<string, string | undefined> = {};
    if (!name.trim()) next.name = 'Required.';
    if (!editing) next.code = validateZoneCode(code);

    const cleaned = isDefaultZone ? [] : cleanDistrictRows(rows);
    const duplicate = findDuplicateDistrict(cleaned);
    if (duplicate) next.districts = `"${duplicate}" is listed twice.`;
    if (conflicts.length > 0) {
      next.districts = conflicts.map((c) => `"${c.district}" is already assigned to ${c.zoneName}. Remove it there first.`).join(' ');
    }

    let rateBody = null;
    if (!editing) {
      const result = validateRateForm(rate);
      rateBody = result.body;
      next.flatAmount = result.errors.flatAmount;
      next.freeOverAmount = result.errors.freeOverAmount;
    }

    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    setSaving(true);
    try {
      if (editing) {
        await apiPatch(`/api/admin/shipping/zones/${zone.id}`, {
          name: name.trim(),
          ...(isDefaultZone ? {} : { districts: cleaned }),
        });
      } else {
        await apiPost('/api/admin/shipping/zones', {
          code: code.trim(),
          name: name.trim(),
          districts: cleaned,
          rate: rateBody,
        });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors({
          code: err.fieldError('code'),
          name: err.fieldError('name'),
          districts: err.fieldError('districts'),
        });
        setServerError(err.status === 403 ? 'You do not have permission to change shipping zones.' : err.message);
      } else {
        setServerError('Could not reach the server. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="zone-form-title" className="rounded-lg border border-border bg-background p-lg">
      <h3 id="zone-form-title" className="mb-md text-base font-bold">
        {editing ? `Edit zone — ${zone.name}` : 'Add zone'}
      </h3>

      <FormField
        id="zone-code"
        label="Code"
        required
        value={code}
        readOnly={editing}
        disabled={saving}
        error={errors.code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <FormField
        id="zone-name"
        label="Name"
        required
        value={name}
        disabled={saving}
        error={errors.name}
        onChange={(e) => setName(e.target.value)}
      />

      <fieldset className="mb-lg" disabled={saving}>
        <legend className="mb-sm text-xs font-semibold text-text-primary">Districts</legend>
        {isDefaultZone ? (
          <p className="text-sm text-text-secondary">Used when no district matches.</p>
        ) : (
          <>
            {rows.length === 0 && <p className="mb-sm text-sm text-text-secondary">No districts assigned.</p>}
            {rows.map((row, index) => (
              <div key={index} className="mb-md flex flex-col gap-sm sm:flex-row sm:items-center">
                <div className="sm:flex-1">
                  <FormField
                    id={`district-${index}`}
                    label={`District ${index + 1}`}
                    value={row.district}
                    onChange={(e) => updateRow(index, { district: e.target.value })}
                  />
                </div>
                <ToggleField
                  id={`metro-${index}`}
                  label="Metro only"
                  checked={row.metroOnly}
                  onChange={(checked) => updateRow(index, { metroOnly: checked })}
                />
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  className="mb-lg text-xs font-semibold text-error underline"
                >
                  Remove from list
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((current) => [...current, { district: '', metroOnly: false }])}
              className="text-sm font-semibold text-primary underline"
            >
              Add district
            </button>
            {errors.districts && (
              <p role="alert" className="mt-sm text-xs text-error">
                {errors.districts}
              </p>
            )}
          </>
        )}
      </fieldset>

      {!editing && (
        <fieldset className="mb-lg" disabled={saving}>
          <legend className="mb-sm text-xs font-semibold text-text-primary">Initial rate</legend>
          <RateFields
            idPrefix="new-zone-rate"
            values={rate}
            onChange={setRate}
            errors={{ flatAmount: errors.flatAmount, freeOverAmount: errors.freeOverAmount }}
            disabled={saving}
          />
        </fieldset>
      )}

      {serverError && (
        <p role="alert" className="mb-md text-sm text-error">
          {serverError}
        </p>
      )}

      <div className="flex flex-col gap-sm sm:flex-row">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-12 w-full rounded-lg border-2 border-border text-sm font-bold text-text-primary disabled:opacity-50 sm:w-auto sm:px-lg"
        >
          Cancel
        </button>
        <Button type="button" onClick={() => void save()} loading={saving} className="h-12">
          {editing ? 'Save zone' : 'Create zone'}
        </Button>
      </div>
    </section>
  );
}
