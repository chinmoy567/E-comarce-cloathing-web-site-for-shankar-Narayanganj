import { describe, expect, it } from 'vitest';
import { formatMoney } from '../src/lib/account';
import {
  addDays,
  barWidths,
  buildQuery,
  EXPORT_POLL_TIMEOUT_MS,
  formatReportDate,
  isIsoDate,
  labelIndexes,
  nextPollAction,
  ORDER_STATUS_ORDER,
  plotPoints,
  presetRange,
  rangeDays,
  segmentWidths,
  successRateLabel,
  todayInZone,
  usageLabel,
  validateRange,
} from '../src/lib/admin/reportsView';

describe('reports view logic (spec 20)', () => {
  it('uses the business time zone for "today", not the viewer zone', () => {
    // 20:00 UTC on 3 Oct is already 02:00 on 4 Oct in Dhaka (UTC+6).
    const now = new Date('2026-10-03T20:00:00Z');
    expect(todayInZone('Asia/Dhaka', now)).toBe('2026-10-04');
    expect(todayInZone('UTC', now)).toBe('2026-10-03');
  });

  it('computes the presets on the Dhaka calendar', () => {
    const now = new Date('2026-10-03T20:00:00Z'); // 4 Oct in Dhaka
    expect(presetRange('today', 'Asia/Dhaka', now)).toEqual({ from: '2026-10-04', to: '2026-10-04' });
    expect(presetRange('7d', 'Asia/Dhaka', now)).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(presetRange('30d', 'Asia/Dhaka', now)).toEqual({ from: '2026-09-05', to: '2026-10-04' });
    expect(presetRange('month', 'Asia/Dhaka', now)).toEqual({ from: '2026-10-01', to: '2026-10-04' });
  });

  it('counts range days inclusively and shifts dates', () => {
    expect(rangeDays('2026-06-01', '2026-06-01')).toBe(1);
    expect(rangeDays('2025-06-30', '2026-06-30')).toBe(366);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('validates the range against the cap from the config, with the spec wording', () => {
    expect(validateRange('2026-06-01', '2026-06-30', 366)).toBeNull();
    expect(validateRange('2026-06-30', '2026-06-01', 366)).toBe('The start date must be on or before the end date.');
    expect(validateRange('2025-01-01', '2026-06-30', 366)).toBe('Choose a range of 366 days or fewer.');
    expect(validateRange('2025-01-01', '2026-06-30', 800)).toBeNull(); // the cap is the server's, never hard-coded
    expect(validateRange('', '2026-06-30', 366)).toBe('Enter a start and an end date.');
  });

  it('recognises only real ISO calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('28/02/2026')).toBe(false);
  });

  it('formats dates as DD MMM YYYY without shifting the calendar day', () => {
    expect(formatReportDate('2026-06-05')).toBe('05 Jun 2026');
    expect(formatReportDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('formats money with decimals only when asked, leaving existing callers unchanged', () => {
    expect(formatMoney(1500)).toBe('৳1,500');
    expect(formatMoney(1500, { decimals: 2 })).toBe('৳ 1,500.00');
    expect(formatMoney(0, { decimals: 2 })).toBe('৳ 0.00');
  });

  it('builds query strings, skipping empty values and encoding the rest', () => {
    expect(buildQuery({ from: '2026-06-01', to: '2026-06-30', page: 2, sort: undefined, x: '' })).toBe('from=2026-06-01&to=2026-06-30&page=2');
    expect(buildQuery({ q: 'a b&c' })).toBe('q=a%20b%26c');
  });

  it('shows usage against the limit in the 34 / 100 form', () => {
    expect(usageLabel(34, 100)).toBe('34 / 100');
    expect(usageLabel(34, null)).toBe('34 / No limit');
  });

  it('renders a null success rate as "Not available", never 0%', () => {
    expect(successRateLabel(null)).toBe('Not available');
    expect(successRateLabel(0)).toBe('0%');
    expect(successRateLabel(87.5)).toBe('87.5%');
  });

  it('lists every one of the seven order statuses in state-machine order', () => {
    expect(ORDER_STATUS_ORDER).toHaveLength(7);
    expect(ORDER_STATUS_ORDER[0]).toBe('PENDING_CONFIRMATION');
    expect(ORDER_STATUS_ORDER[6]).toBe('RETURNED');
  });

  it('gives up polling an export after five minutes', () => {
    expect(nextPollAction(0)).toBe('poll');
    expect(nextPollAction(EXPORT_POLL_TIMEOUT_MS - 1)).toBe('poll');
    expect(nextPollAction(EXPORT_POLL_TIMEOUT_MS)).toBe('timeout');
  });

  it('thins x-axis labels to first, last and a few between', () => {
    expect(labelIndexes(0)).toEqual([]);
    expect(labelIndexes(3)).toEqual([0, 1, 2]);
    const idx = labelIndexes(30);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(29);
    expect(idx.length).toBeLessThanOrEqual(5);
  });

  it('plots on one axis whose domain starts at zero', () => {
    const { points, max, ticks } = plotPoints([
      { label: 'a', value: 0 },
      { label: 'b', value: 50 },
      { label: 'c', value: 100 },
    ]);
    expect(max).toBe(100);
    expect(ticks).toEqual([0, 50, 100]);
    expect(points[0]!.y).toBeGreaterThan(points[2]!.y); // a larger value is higher on screen
    expect(points[0]!.x).toBeLessThan(points[2]!.x);
    expect(plotPoints([{ label: 'z', value: 0 }]).max).toBe(1); // an all-zero series never divides by zero
  });

  it('derives bar geometry without producing a displayed figure', () => {
    expect(barWidths([5, 10, 0])).toEqual([50, 100, 0]);
    expect(barWidths([0, 0])).toEqual([0, 0]);
    expect(segmentWidths([1, 3])).toEqual([25, 75]);
    expect(segmentWidths([0, 0])).toEqual([0, 0]);
  });
});
