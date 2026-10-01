'use client';

import { useState } from 'react';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { ToggleField } from '@/components/admin/ToggleField';
import { apiPatch, ApiClientError } from '@/lib/apiClient';
import type { CourierConfigView } from '@/lib/admin/types';

/**
 * One editable card per courier (spec 14, `courier.manage`). There are NO
 * credential fields: credentials live in server environment variables
 * (04-courier §4.8, 11-security §11.9). The page only shows whether they are
 * configured, never a value.
 */
export function CourierConfigRow({
  courier,
  onSaved,
}: {
  courier: CourierConfigView;
  onSaved: (updated: CourierConfigView) => void;
}) {
  const [isEnabled, setIsEnabled] = useState(courier.isEnabled);
  const [displayOrder, setDisplayOrder] = useState(String(courier.displayOrder));
  const [template, setTemplate] = useState(courier.trackingUrlTemplate ?? '');
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(courier.configSchema.map((f) => [f.key, String(courier.config[f.key] ?? '')])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiClientError | string | null>(null);
  const [saved, setSaved] = useState(false);

  const originalConfig = Object.fromEntries(courier.configSchema.map((f) => [f.key, String(courier.config[f.key] ?? '')]));
  const dirty =
    isEnabled !== courier.isEnabled ||
    displayOrder !== String(courier.displayOrder) ||
    template !== (courier.trackingUrlTemplate ?? '') ||
    courier.configSchema.some((f) => config[f.key] !== originalConfig[f.key]);

  const fieldError = (field: string) => (error instanceof ApiClientError ? error.fieldError(field) : undefined);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        isEnabled,
        displayOrder: Number(displayOrder),
        trackingUrlTemplate: template.trim() === '' ? null : template.trim(),
      };
      const changed = courier.configSchema.filter((f) => config[f.key] !== originalConfig[f.key]);
      if (changed.length > 0) {
        body.config = Object.fromEntries(
          changed.map((f) => [f.key, f.type === 'number' ? Number(config[f.key]) : config[f.key]]),
        );
      }
      const updated = await apiPatch<CourierConfigView>(`/api/admin/courier-config/${courier.code}`, body);
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : 'Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-lg" aria-labelledby={`courier-${courier.code}`}>
      <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
        <h2 id={`courier-${courier.code}`} className="text-lg font-bold">
          {courier.name}
        </h2>
        <p className="text-sm">
          <span className="text-text-secondary">Credentials: </span>
          <span className="font-medium">{courier.credentialsConfigured ? 'Configured' : 'Not configured'}</span>
        </p>
      </div>

      <p className="mb-md text-xs text-text-secondary">
        Cancel shipment: {courier.supportsCancel ? 'supported' : 'not supported'} · Tracking:{' '}
        {courier.supportsTracking ? 'supported' : 'not supported'}
      </p>

      <ToggleField id={`enabled-${courier.code}`} label="Enabled" checked={isEnabled} onChange={setIsEnabled} />
      {!isEnabled && courier.isEnabled && (
        <p className="-mt-sm mb-lg text-xs text-text-secondary">
          Orders already using this courier are not affected; it will no longer be offered for new shipments.
        </p>
      )}

      <FormField
        id={`order-${courier.code}`}
        label="Display order"
        inputMode="numeric"
        value={displayOrder}
        onChange={(e) => setDisplayOrder(e.target.value.replace(/[^0-9]/g, ''))}
        error={fieldError('displayOrder')}
      />

      <FormField
        id={`template-${courier.code}`}
        label="Tracking URL template"
        placeholder="https://example.com/track/{trackingId}"
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        error={fieldError('trackingUrlTemplate')}
      />

      {courier.configSchema.length > 0 && (
        <div>
          <p className="mb-sm text-xs text-text-secondary">
            Do not enter API keys, secrets or passwords here. Credentials are configured on the server.
          </p>
          {courier.configSchema.map((f) => (
            <FormField
              key={f.key}
              id={`cfg-${courier.code}-${f.key}`}
              label={f.label}
              type={f.type === 'number' ? 'text' : 'text'}
              inputMode={f.type === 'number' ? 'numeric' : undefined}
              value={config[f.key] ?? ''}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
              error={fieldError(`config.${f.key}`)}
            />
          ))}
        </div>
      )}

      {typeof error === 'string' && (
        <p role="alert" className="mb-md text-sm text-error">
          {error}
        </p>
      )}
      {error instanceof ApiClientError && error.details.length === 0 && (
        <p role="alert" className="mb-md text-sm text-error">
          {error.status === 403 ? 'You do not have permission to do this.' : error.message}
        </p>
      )}
      {saved && !dirty && (
        <p role="status" className="mb-md text-sm text-accent">
          Saved.
        </p>
      )}

      <Button disabled={!dirty} loading={saving} onClick={() => void save()}>
        Save
      </Button>
    </section>
  );
}
