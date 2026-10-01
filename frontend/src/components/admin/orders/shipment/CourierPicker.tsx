'use client';

import type { CourierOption } from '@/lib/admin/types';

/**
 * Radio list of couriers returned by GET /api/admin/couriers (04-courier §4.9:
 * the list is data-driven). No courier name or code appears in this component.
 */
export function CourierPicker({
  couriers,
  value,
  onChange,
  disabled,
  disabledCode,
}: {
  couriers: CourierOption[];
  value: string | null;
  onChange: (code: string) => void;
  disabled: boolean;
  /** The courier that just failed — shown but not selectable when changing courier. */
  disabledCode?: string | null;
}) {
  return (
    <fieldset className="mb-md">
      <legend className="mb-sm text-xs font-semibold text-text-primary">Courier</legend>
      <div className="space-y-sm">
        {couriers.map((c) => {
          const isDisabled = disabled || c.code === disabledCode;
          return (
            <label
              key={c.code}
              className={`flex min-h-12 cursor-pointer items-center gap-md rounded-lg border px-md ${
                value === c.code ? 'border-2 border-primary' : 'border-border'
              } ${isDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="courier"
                className="h-5 w-5 accent-primary"
                checked={value === c.code}
                disabled={isDisabled}
                onChange={() => onChange(c.code)}
              />
              <span className="text-sm font-medium">{c.name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
