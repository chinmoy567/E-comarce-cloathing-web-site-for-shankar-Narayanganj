/**
 * Pure display logic for the back-office reports (spec 20 §Frontend build detail). Free of React so it
 * is unit-testable in this repo's node-only vitest setup. The frontend never computes, sums, ranks or
 * re-derives a report figure — it renders what the API returned. The only arithmetic here is chart
 * GEOMETRY (pixel positions) and calendar-date maths for the range selector.
 */

const MS_PER_DAY = 86_400_000;

export const EXPORT_POLL_INTERVAL_MS = 3_000;
export const EXPORT_POLL_TIMEOUT_MS = 5 * 60_000;

/** The §5.21 order statuses in the state machine's order (zero counts are shown, never hidden). */
export const ORDER_STATUS_ORDER = [
  'PENDING_CONFIRMATION',
  'COD_VERIFICATION_PENDING',
  'CONFIRMED',
  'PROCESSING',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
] as const;

/** §5.21.4 shipment statuses in lifecycle order. */
export const SHIPMENT_STATUS_ORDER = [
  'NOT_CREATED',
  'CREATING',
  'CREATED',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CREATION_FAILED',
  'DELIVERY_FAILED',
  'RETURNED',
] as const;

// ---- Dates ---------------------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's calendar date in the business time zone (from `/reports/config`), never the viewer's. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days between two ISO dates, inclusive of both ends. */
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY) + 1;
}

export type RangePreset = 'today' | '7d' | '30d' | 'month';
export const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  month: 'This month',
};

export function presetRange(preset: RangePreset, timeZone: string, now: Date = new Date()): { from: string; to: string } {
  const today = todayInZone(timeZone, now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

/** Returns the message to show beside a disabled Apply, or null when the range may be applied. */
export function validateRange(from: string, to: string, maxRangeDays: number): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return 'Enter a start and an end date.';
  if (from > to) return 'The start date must be on or before the end date.';
  if (rangeDays(from, to) > maxRangeDays) return `Choose a range of ${maxRangeDays} days or fewer.`;
  return null;
}

/** DD MMM YYYY from an ISO date or timestamp. Dates are read as calendar dates (UTC) so they never shift. */
export function formatReportDate(value: string): string {
  const d = new Date(ISO_DATE.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(ISO_DATE.test(value) ? { timeZone: 'UTC' } : {}),
  });
}

/** "12 Jun 2026, 14:05" in the business zone, for the freshness line. */
export function formatReportDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
}

// ---- Query strings -------------------------------------------------------------------------------

/** Builds `a=1&b=2`, skipping undefined/empty values. Values are encoded. */
export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

// ---- Labels --------------------------------------------------------------------------------------

/** `34 / 100`, or `34 / No limit` (§8.29). */
export function usageLabel(usageCount: number, usageLimit: number | null): string {
  return `${usageCount} / ${usageLimit === null ? 'No limit' : usageLimit}`;
}

/** A null success rate renders "Not available", never "0%". The percentage itself is the backend's. */
export function successRateLabel(rate: number | null): string {
  return rate === null ? 'Not available' : `${rate}%`;
}

export const TREND_MEASURES = [
  { key: 'netRevenue', label: 'Delivered revenue', money: true },
  { key: 'ordersPlaced', label: 'Orders placed', money: false },
  { key: 'ordersDelivered', label: 'Orders delivered', money: false },
  { key: 'totalDiscount', label: 'Discount given', money: true },
] as const;
export type TrendMeasure = (typeof TREND_MEASURES)[number]['key'];

export const REVENUE_RECOGNITION_COPY: Record<string, string> = {
  ORDER_STATUS_DELIVERED:
    'Revenue is recognized when an order is Delivered. Orders that are not yet delivered are shown as pipeline value, and cancelled or returned orders are excluded.',
};

// ---- Export lifecycle ----------------------------------------------------------------------------

export type ExportPhase = 'idle' | 'starting' | 'pending' | 'ready' | 'failed' | 'timeout' | 'gone';

/** What to do after a poll tick: keep polling, or give up after the 5-minute window. */
export function nextPollAction(elapsedMs: number): 'poll' | 'timeout' {
  return elapsedMs >= EXPORT_POLL_TIMEOUT_MS ? 'timeout' : 'poll';
}

// ---- Chart geometry ------------------------------------------------------------------------------

export type ChartGeometry = {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
};

export const CHART: ChartGeometry = { width: 640, height: 280, padLeft: 56, padRight: 16, padTop: 16, padBottom: 40 };

export type PlotPoint = { x: number; y: number; value: number; label: string };

/** Pixel positions for a single-axis line. The value domain always starts at 0 so the line is honest. */
export function plotPoints(
  items: Array<{ label: string; value: number }>,
  geo: ChartGeometry = CHART,
): { points: PlotPoint[]; max: number; ticks: number[] } {
  const innerW = geo.width - geo.padLeft - geo.padRight;
  const innerH = geo.height - geo.padTop - geo.padBottom;
  const max = Math.max(1, ...items.map((i) => i.value));
  const points = items.map((item, i) => ({
    label: item.label,
    value: item.value,
    x: geo.padLeft + (items.length <= 1 ? innerW / 2 : (i / (items.length - 1)) * innerW),
    y: geo.padTop + innerH - (item.value / max) * innerH,
  }));
  return { points, max, ticks: [0, max / 2, max] };
}

/** Indexes whose x-axis label is drawn: first, last and a few between, so labels never overlap. */
export function labelIndexes(count: number, maxLabels = 5): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const out = new Set<number>([0, count - 1]);
  for (let i = 1; i < maxLabels - 1; i++) out.add(Math.round((i * (count - 1)) / (maxLabels - 1)));
  return [...out].sort((a, b) => a - b);
}

/** Share of a segment as a CSS width. This is bar geometry, never shown as a figure. */
export function segmentWidths(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  return total === 0 ? counts.map(() => 0) : counts.map((c) => (c / total) * 100);
}

/** Bar length relative to the largest bar in the list (CSS width %). Geometry only, never shown as a figure. */
export function barWidths(counts: number[]): number[] {
  const max = Math.max(0, ...counts);
  return max === 0 ? counts.map(() => 0) : counts.map((c) => (c / max) * 100);
}
