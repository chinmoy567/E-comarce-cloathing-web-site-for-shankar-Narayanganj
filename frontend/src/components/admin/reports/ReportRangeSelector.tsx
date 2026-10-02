'use client';

import { useState } from 'react';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { SelectField } from '@/components/admin/SelectField';
import { PRESET_LABELS, presetRange, validateRange, type RangePreset } from '@/lib/admin/reportsView';
import type { ReportConfig } from '@/lib/admin/reports';

export type RangeValue = { from: string; to: string; granularity: 'day' | 'week' | 'month' };

/**
 * Presets (computed on the business-zone calendar from `/reports/config`) plus a Custom range. The
 * cap is enforced and EXPLAINED — an over-long range disables Apply with a message, never a silent
 * truncation. The backend 400 stays the authority if the cap changes.
 */
export function ReportRangeSelector({
  value,
  config,
  showGranularity,
  onChange,
}: {
  value: RangeValue;
  config: ReportConfig;
  showGranularity: boolean;
  onChange: (next: RangeValue) => void;
}) {
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  // Re-sync the inputs when the applied range changes elsewhere (preset click, back/forward).
  const [seen, setSeen] = useState(`${value.from}|${value.to}`);
  if (seen !== `${value.from}|${value.to}`) {
    setSeen(`${value.from}|${value.to}`);
    setFrom(value.from);
    setTo(value.to);
  }

  const error = validateRange(from, to, config.maxRangeDays);
  const unchanged = from === value.from && to === value.to;

  const chip = 'h-11 shrink-0 whitespace-nowrap rounded-full border px-md text-sm font-semibold border-border bg-background text-text-secondary hover:bg-surface';

  return (
    <section aria-label="Report period" className="mb-lg">
      <div className="-mx-lg mb-md flex gap-sm overflow-x-auto px-lg pb-xs md:mx-0 md:px-0">
        {(Object.keys(PRESET_LABELS) as RangePreset[]).map((p) => (
          <button
            key={p}
            type="button"
            className={chip}
            onClick={() => onChange({ ...value, ...presetRange(p, config.timezone) })}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-sm md:flex-row md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!error && !unchanged) onChange({ ...value, from, to });
        }}
      >
        <div className="md:w-48">
          <FormField id="report-from" label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div className="md:w-48">
          <FormField id="report-to" label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
        </div>
        {showGranularity && (
          <div className="md:w-40">
            <SelectField
              id="report-granularity"
              label="Group by"
              value={value.granularity}
              onChange={(e) => onChange({ ...value, granularity: e.target.value as RangeValue['granularity'] })}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </SelectField>
          </div>
        )}
        <div className="mb-lg md:mb-lg">
          <Button type="submit" disabled={Boolean(error) || unchanged} className="h-12">
            Apply
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="-mt-sm text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
}
