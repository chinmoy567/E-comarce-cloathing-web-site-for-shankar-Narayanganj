'use client';

import { useState } from 'react';
import { Button } from '@/components/admin/Button';
import { SelectField } from '@/components/admin/SelectField';
import { apiPatch, ApiClientError } from '@/lib/apiClient';
import { formatDate } from '@/lib/account';
import type { ShippingZoneView, UnmatchedDistrictRow } from '@/lib/admin/types';

/**
 * Districts that fell through to the default zone at order time (spec 21). Each one is a possible
 * undercharge until it is mapped, so every row offers "Add to a zone". Adding the spelling clears the
 * row on the next refresh — there is no dismiss action.
 */
export function UnmatchedDistrictsPanel({
  rows,
  zones,
  onChanged,
}: {
  rows: UnmatchedDistrictRow[];
  zones: ShippingZoneView[];
  onChanged: () => void;
}) {
  const assignable = zones.filter((z) => !z.isDefault && z.currentRate);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) return null;

  async function add(district: string) {
    const zone = assignable.find((z) => z.id === zoneId);
    if (!zone || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/admin/shipping/zones/${zone.id}`, {
        districts: [...zone.districts, { district, metroOnly: false }],
      });
      setOpenFor(null);
      setZoneId('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="unmatched-title" className="mt-xl rounded-lg border border-border p-lg">
      <h2 id="unmatched-title" className="mb-sm text-lg font-bold">
        Unmatched districts
      </h2>
      <p className="mb-md text-sm text-text-secondary">
        These districts were charged the default zone&apos;s rate because no zone lists them. A misspelling may
        be undercharging orders — add the spelling to a zone to fix it.
      </p>

      {error && (
        <p role="alert" className="mb-md text-sm text-error">
          {error}
        </p>
      )}

      <ul className="space-y-md">
        {rows.map((row) => (
          <li key={row.district} className="rounded-lg bg-surface p-md">
            <div className="flex flex-wrap items-center justify-between gap-sm text-sm">
              <span className="font-semibold">{row.district}</span>
              <span className="text-text-secondary">
                {row.occurrences} {row.occurrences === 1 ? 'order' : 'orders'} · last seen {formatDate(row.lastSeenAt)}
              </span>
            </div>

            {openFor === row.district ? (
              <div className="mt-md">
                <SelectField
                  id={`unmatched-zone-${row.district}`}
                  label="Add to zone"
                  value={zoneId}
                  disabled={saving}
                  onChange={(e) => setZoneId(e.target.value)}
                >
                  <option value="">Choose a zone</option>
                  {assignable.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </SelectField>
                <div className="flex flex-col gap-sm sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setOpenFor(null)}
                    disabled={saving}
                    className="h-12 w-full rounded-lg border-2 border-border text-sm font-bold text-text-primary sm:w-auto sm:px-lg"
                  >
                    Cancel
                  </button>
                  <Button
                    type="button"
                    disabled={!zoneId}
                    loading={saving}
                    onClick={() => void add(row.district)}
                    className="h-12"
                  >
                    Add district
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setOpenFor(row.district);
                  setZoneId('');
                  setError(null);
                }}
                className="mt-sm text-sm font-semibold text-primary underline"
              >
                Add to a zone
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
