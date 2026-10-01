'use client';

import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import type { CourierConfigView } from '@/lib/admin/types';
import { CourierConfigRow } from '@/components/admin/settings/CourierConfigRow';

/** Courier settings (spec 14) — `courier.manage` only. Backend 403 shows a plain no-access state. */
export default function CourierSettingsPage() {
  const { hasPermission } = useAdminSession();
  const allowed = hasPermission('courier.manage');
  const [couriers, setCouriers] = useState<CourierConfigView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    apiGet<CourierConfigView[]>('/api/admin/courier-config', { signal: controller.signal })
      .then(setCouriers)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiClientError && err.status === 403) setDenied(true);
        else setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
      });
    return () => controller.abort();
  }, [allowed]);

  if (!allowed || denied) {
    return (
      <div>
        <h1 className="mb-lg text-xl font-bold md:text-[28px]">Courier settings</h1>
        <p role="alert" className="text-text-secondary">
          You do not have access to courier settings.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Courier settings</h1>
      <p className="mb-lg text-sm text-text-secondary">
        Enable couriers, set their order in the picker and manage non-secret settings. API credentials are configured on
        the server and are never shown here.
      </p>

      {couriers === null && !error && <p className="text-text-secondary">Loading couriers…</p>}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}

      <div className="grid gap-lg lg:grid-cols-2">
        {couriers?.map((c) => (
          <CourierConfigRow
            key={c.code}
            courier={c}
            onSaved={(updated) => setCouriers((list) => list?.map((x) => (x.code === updated.code ? updated : x)) ?? null)}
          />
        ))}
      </div>
    </div>
  );
}
