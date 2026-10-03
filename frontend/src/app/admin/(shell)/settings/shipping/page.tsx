'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import type { ShippingZoneView, UnmatchedDistrictRow } from '@/lib/admin/types';
import { Button } from '@/components/admin/Button';
import { ShippingZoneList } from '@/components/admin/shipping/ShippingZoneList';
import { ShippingZoneForm } from '@/components/admin/shipping/ShippingZoneForm';
import { ShippingRateForm } from '@/components/admin/shipping/ShippingRateForm';
import { RateChangeConfirm } from '@/components/admin/shipping/RateChangeConfirm';
import { UnmatchedDistrictsPanel } from '@/components/admin/shipping/UnmatchedDistrictsPanel';
import { describeRate } from '@/lib/admin/shippingView';

type Mode =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; zone: ShippingZoneView }
  | { kind: 'rate'; zone: ShippingZoneView }
  | { kind: 'default'; zone: ShippingZoneView };

/**
 * Admin → Settings → Shipping (spec 21) — `system.configure` only. The nav entry is hidden for a user
 * without it (UX only); the backend is the real gate and a 403 shows a plain no-access state.
 * There is no delete control for zones, districts or rates.
 */
export default function ShippingSettingsPage() {
  const { hasPermission } = useAdminSession();
  const allowed = hasPermission('system.configure');

  const [zones, setZones] = useState<ShippingZoneView[] | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedDistrictRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [announcement, setAnnouncement] = useState('');
  const [switching, setSwitching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const [zoneList, unmatchedList] = await Promise.all([
        apiGet<ShippingZoneView[]>('/api/admin/shipping/zones', { signal }),
        apiGet<UnmatchedDistrictRow[]>('/api/admin/shipping/unmatched-districts?page=1&pageSize=50', { signal }),
      ]);
      setZones(zoneList);
      setUnmatched(unmatchedList);
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ApiClientError && err.status === 403) setDenied(true);
      else setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [allowed, load]);

  async function saved(message: string) {
    setMode({ kind: 'none' });
    setAnnouncement('');
    await load();
    setAnnouncement(message);
  }

  async function makeDefault(zone: ShippingZoneView) {
    if (switching) return;
    setSwitching(true);
    setActionError(null);
    try {
      await apiPost(`/api/admin/shipping/zones/${zone.id}/make-default`, {});
      await saved('Default zone updated.');
    } catch (err) {
      setMode({ kind: 'none' });
      setActionError(
        err instanceof ApiClientError
          ? err.status === 403
            ? 'You do not have permission to change shipping zones.'
            : err.message
          : 'Could not reach the server. Please try again.',
      );
    } finally {
      setSwitching(false);
    }
  }

  if (!allowed || denied) {
    return (
      <div>
        <h1 className="mb-lg text-xl font-bold md:text-[28px]">Shipping</h1>
        <p role="alert" className="text-text-secondary">
          You do not have access to shipping settings.
        </p>
      </div>
    );
  }

  const hasDefault = zones?.some((z) => z.isDefault) ?? true;

  return (
    <div>
      <div className="mb-lg flex flex-wrap items-center justify-between gap-md">
        <h1 className="text-xl font-bold md:text-[28px]">Shipping</h1>
        <Button type="button" onClick={() => setMode({ kind: 'add' })} disabled={zones === null || mode.kind !== 'none'}>
          Add zone
        </Button>
      </div>

      <p className="mb-lg text-sm text-text-secondary">
        Delivery charges are looked up from the customer&apos;s district. Changing a rate affects new orders only;
        existing orders keep the amount they were placed with.
      </p>

      <p role="status" aria-live="polite" className="mb-md text-sm font-semibold text-accent">
        {announcement}
      </p>

      {zones === null && !error && <p className="text-text-secondary">Loading zones…</p>}
      {error && (
        <div role="alert" className="mb-lg text-error">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-xs text-sm font-semibold underline">
            Retry
          </button>
        </div>
      )}
      {actionError && (
        <p role="alert" className="mb-md text-sm text-error">
          {actionError}
        </p>
      )}

      {zones !== null && zones.length === 0 && (
        <p className="text-text-secondary">No shipping zones are configured.</p>
      )}
      {zones !== null && !hasDefault && (
        <p role="alert" className="mb-md text-sm text-error">
          No default zone exists. Checkout will fail to price orders for unmapped districts until one is set.
        </p>
      )}

      {mode.kind === 'add' && zones && (
        <div className="mb-lg">
          <ShippingZoneForm zones={zones} onSaved={() => void saved('Zone created.')} onCancel={() => setMode({ kind: 'none' })} />
        </div>
      )}
      {mode.kind === 'edit' && zones && (
        <div className="mb-lg">
          <ShippingZoneForm
            zone={mode.zone}
            zones={zones}
            onSaved={() => void saved('Zone updated.')}
            onCancel={() => setMode({ kind: 'none' })}
          />
        </div>
      )}
      {mode.kind === 'rate' && (
        <div className="mb-lg">
          <ShippingRateForm zone={mode.zone} onSaved={() => void saved('Rate updated.')} onCancel={() => setMode({ kind: 'none' })} />
        </div>
      )}
      {mode.kind === 'default' && (
        <div className="mb-lg">
          <RateChangeConfirm
            title={`Make ${mode.zone.name} the default zone?`}
            current={zones?.find((z) => z.isDefault)?.name}
            next={`${mode.zone.name} (${describeRate(mode.zone.currentRate)})`}
            message="Addresses that match no district will be charged this zone's rate from now on. Existing orders are not affected."
            confirmLabel="Make default"
            busy={switching}
            onConfirm={() => void makeDefault(mode.zone)}
            onCancel={() => setMode({ kind: 'none' })}
          />
        </div>
      )}

      {zones && zones.length > 0 && (
        <ShippingZoneList
          zones={zones}
          onEdit={(zone) => setMode({ kind: 'edit', zone })}
          onAddRate={(zone) => setMode({ kind: 'rate', zone })}
          onMakeDefault={(zone) => setMode({ kind: 'default', zone })}
        />
      )}

      {zones && <UnmatchedDistrictsPanel rows={unmatched} zones={zones} onChanged={() => void saved('District added.')} />}
    </div>
  );
}
