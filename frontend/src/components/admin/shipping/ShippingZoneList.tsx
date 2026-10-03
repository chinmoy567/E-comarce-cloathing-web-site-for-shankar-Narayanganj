'use client';

import { Button } from '@/components/admin/Button';
import { StatusBadge } from '@/components/account/StatusBadge';
import { formatDate } from '@/lib/account';
import type { ShippingZoneView } from '@/lib/admin/types';
import { describeDistrict, describeRate } from '@/lib/admin/shippingView';

/**
 * One card per zone, in `sortOrder` (spec 21). No delete control: zones, districts and rates are never
 * hard-deleted. "Make default" is offered on non-default zones only.
 */
export function ShippingZoneList({
  zones,
  onEdit,
  onAddRate,
  onMakeDefault,
}: {
  zones: ShippingZoneView[];
  onEdit: (zone: ShippingZoneView) => void;
  onAddRate: (zone: ShippingZoneView) => void;
  onMakeDefault: (zone: ShippingZoneView) => void;
}) {
  return (
    <div className="grid gap-lg lg:grid-cols-2">
      {zones.map((zone) => (
        <section
          key={zone.id}
          aria-labelledby={`zone-${zone.id}`}
          className="rounded-lg border border-border bg-surface p-lg"
        >
          <div className="mb-sm flex flex-wrap items-center justify-between gap-sm">
            <h2 id={`zone-${zone.id}`} className="text-lg font-bold">
              {zone.name}
            </h2>
            {zone.isDefault && <StatusBadge label="Default (fallback)" tone="neutral" />}
          </div>

          <p className="mb-xs text-sm">
            <span className="font-semibold">{describeRate(zone.currentRate)}</span>
            {zone.currentRate && (
              <span className="text-text-secondary"> · effective {formatDate(zone.currentRate.effectiveFrom)}</span>
            )}
          </p>

          {zone.isDefault ? (
            <p className="mb-md text-sm text-text-secondary">Used when no district matches.</p>
          ) : zone.districts.length === 0 ? (
            <p className="mb-md text-sm text-text-secondary">No districts assigned.</p>
          ) : (
            <ul className="mb-md flex flex-wrap gap-xs" aria-label={`Districts in ${zone.name}`}>
              {zone.districts.map((d) => (
                <li
                  key={`${d.district}|${d.metroOnly}`}
                  className="rounded-full border border-border bg-background px-md py-xs text-xs"
                >
                  {describeDistrict(d)}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-sm sm:flex-row sm:flex-wrap">
            <Button type="button" variant="secondary" onClick={() => onEdit(zone)} className="h-12">
              Edit zone
            </Button>
            <Button type="button" onClick={() => onAddRate(zone)} className="h-12">
              Change rate
            </Button>
            {!zone.isDefault && zone.currentRate && (
              <Button type="button" variant="secondary" onClick={() => onMakeDefault(zone)} className="h-12">
                Make default
              </Button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
