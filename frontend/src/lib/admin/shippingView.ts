import { formatMoney } from '@/lib/account';
import type { ShippingDistrictMapping, ShippingRateView, ShippingStrategy, ShippingZoneView } from '@/lib/admin/types';

/**
 * Pure helpers for the Admin → Settings → Shipping screen (spec 21). The backend is the authority:
 * these only give the form an early, friendly check that mirrors its rules (all-or-nothing threshold,
 * amounts >= 0 with at most 2 decimals) and render rates in words. Nothing here prices an order.
 */

export const STRATEGY_LABELS: Record<ShippingStrategy, string> = {
  FLAT: 'Flat',
  FREE: 'Free',
  FREE_OVER_THRESHOLD: 'Free over threshold',
};

/** "Flat ৳60.00", "Free", "Free over ৳2,000.00, otherwise ৳100.00". */
export function describeRate(rate: Pick<ShippingRateView, 'strategy' | 'flatAmount' | 'freeOverAmount'> | null): string {
  if (!rate) return 'No rate set';
  switch (rate.strategy) {
    case 'FREE':
      return 'Free';
    case 'FREE_OVER_THRESHOLD':
      return `Free over ${formatMoney(rate.freeOverAmount ?? 0, { decimals: 2 })}, otherwise ${formatMoney(rate.flatAmount, { decimals: 2 })}`;
    case 'FLAT':
    default:
      return `Flat ${formatMoney(rate.flatAmount, { decimals: 2 })}`;
  }
}

export function describeDistrict(d: ShippingDistrictMapping): string {
  return d.metroOnly ? `${d.district} (metro only)` : d.district;
}

export type RateFormValues = { strategy: ShippingStrategy; flatAmount: string; freeOverAmount: string };

export type RateRequestBody = { strategy: ShippingStrategy; flatAmount?: number; freeOverAmount?: number };

export type RateFormResult = { errors: Partial<Record<'flatAmount' | 'freeOverAmount', string>>; body: RateRequestBody | null };

function parseAmount(raw: string): { value: number | null; error?: string } {
  const text = raw.trim();
  if (text === '') return { value: null, error: 'Required.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { value: null, error: 'Enter a number of zero or more.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { value: null, error: 'At most 2 decimal places.' };
  return { value: Number(text) };
}

/** `FREE` hides both amounts; a threshold exists iff the strategy is FREE_OVER_THRESHOLD. */
export function validateRateForm(values: RateFormValues): RateFormResult {
  const errors: RateFormResult['errors'] = {};
  const body: RateRequestBody = { strategy: values.strategy };

  if (values.strategy !== 'FREE') {
    const flat = parseAmount(values.flatAmount);
    if (flat.error) errors.flatAmount = flat.error;
    else body.flatAmount = flat.value!;
  }
  if (values.strategy === 'FREE_OVER_THRESHOLD') {
    const threshold = parseAmount(values.freeOverAmount);
    if (threshold.error) errors.freeOverAmount = threshold.error;
    else body.freeOverAmount = threshold.value!;
  }

  return { errors, body: Object.keys(errors).length === 0 ? body : null };
}

export const EMPTY_RATE_FORM: RateFormValues = { strategy: 'FLAT', flatAmount: '', freeOverAmount: '' };

export function rateToFormValues(rate: ShippingRateView | null): RateFormValues {
  if (!rate) return EMPTY_RATE_FORM;
  return {
    strategy: rate.strategy,
    flatAmount: rate.strategy === 'FREE' ? '' : String(rate.flatAmount),
    freeOverAmount: rate.freeOverAmount !== null ? String(rate.freeOverAmount) : '',
  };
}

/** The zone code is a UX hint only (uppercase letters, digits, underscores); the backend enforces it. */
export function validateZoneCode(code: string): string | undefined {
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code.trim())) return 'Use uppercase letters, digits and underscores, e.g. SYLHET_ZONE.';
  return undefined;
}

export function normalizeDistrictKey(district: string): string {
  return district.trim().toLowerCase();
}

/** Districts in `rows` that are already assigned to ANOTHER zone at the same metro specificity. */
export function findDistrictConflicts(
  zones: ShippingZoneView[],
  zoneId: string | null,
  rows: ShippingDistrictMapping[],
): Array<{ district: string; zoneName: string }> {
  const taken = new Map<string, string>();
  for (const zone of zones) {
    if (zone.id === zoneId) continue;
    for (const d of zone.districts) taken.set(`${normalizeDistrictKey(d.district)}|${d.metroOnly}`, zone.name);
  }
  const conflicts: Array<{ district: string; zoneName: string }> = [];
  for (const row of rows) {
    const zoneName = taken.get(`${normalizeDistrictKey(row.district)}|${row.metroOnly}`);
    if (zoneName && row.district.trim()) conflicts.push({ district: row.district.trim(), zoneName });
  }
  return conflicts;
}

/** Rows to send: trimmed, blanks dropped. */
export function cleanDistrictRows(rows: ShippingDistrictMapping[]): ShippingDistrictMapping[] {
  return rows.map((r) => ({ district: r.district.trim(), metroOnly: r.metroOnly })).filter((r) => r.district !== '');
}

export function findDuplicateDistrict(rows: ShippingDistrictMapping[]): string | undefined {
  const seen = new Set<string>();
  for (const r of cleanDistrictRows(rows)) {
    const key = `${normalizeDistrictKey(r.district)}|${r.metroOnly}`;
    if (seen.has(key)) return r.district;
    seen.add(key);
  }
  return undefined;
}
