import type { RiskCheckResponse, RiskLevel } from './types';

/**
 * Pure display logic for the Customer Risk section (spec 16 §Frontend build detail).
 * Kept free of React so it is unit-testable in this repo's node-only vitest setup.
 * The frontend never re-implements the CONFIRMED/PROCESSING gate, the cache, the
 * success-rate calculation or the risk bands — it renders what the backend returned.
 */

/** The five §7.7 labels, exactly. */
export const RISK_LABELS: Record<RiskLevel, string> = {
  LOW: 'LOW RISK',
  MEDIUM: 'MEDIUM RISK',
  HIGH: 'HIGH RISK',
  UNKNOWN: 'UNKNOWN',
  CHECK_FAILED: 'CHECK FAILED',
};

/** The documented palette (§7.7). Applied to a border and glyph, never to label text. */
export const RISK_COLORS: Record<RiskLevel, string> = {
  LOW: '#059669',
  MEDIUM: '#F59E0B',
  HIGH: '#DC2626',
  UNKNOWN: '#6B7280',
  CHECK_FAILED: '#6B7280',
};

export type RiskViewState = 'never-checked' | 'result' | 'no-history' | 'check-failed';

/** `available: false` is the only "never checked" signal; an UNKNOWN badge there would look like a result. */
export function viewState(data: RiskCheckResponse): RiskViewState {
  if (!data.available) return 'never-checked';
  if (data.riskLevel === 'CHECK_FAILED') return 'check-failed';
  if (data.riskLevel === 'UNKNOWN' && data.totalOrders === null) return 'no-history';
  return 'result';
}

export type RiskRow = { label: string; value: string };

/** Delivery-history rows. A field the provider did not return (null) is omitted — never "0" or "—" (§7.5). */
export function visibleRows(data: RiskCheckResponse): RiskRow[] {
  const rows: RiskRow[] = [{ label: 'Phone', value: data.phoneNumber }];
  const add = (label: string, value: number | null, suffix = '') => {
    if (value !== null) rows.push({ label, value: `${value}${suffix}` });
  };
  add('Total Orders', data.totalOrders);
  add('Delivered', data.successfulOrders);
  add('Returned', data.returnedOrders);
  add('Success Rate', data.successRatePercent, '%');
  add('Risk Score', data.riskScore);
  return rows;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `DD MMM YYYY` (design skill). Fixed month names, so ICU variants ("Sept") cannot leak in. */
export function formatCheckedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export type RiskActionError = {
  message: string;
  /** Remove the button (permission lost). */
  hideButton?: boolean;
  /** Re-run GET to resync (the backend's status gate disagreed with the UI). */
  refetch?: boolean;
  /** Disable the button for this many seconds. */
  cooldownSec?: number;
};

type ErrorLike = { code?: string; status?: number; message?: string; retryAfter?: number };

/** Maps a failed POST to what the section shows. Backend `message` wins; strings here are fallbacks. */
export function describePostError(err: ErrorLike): RiskActionError {
  const backend = err.message?.trim() || '';
  switch (err.status) {
    case 403:
      return { message: 'You do not have permission to view customer risk.', hideButton: true };
    case 409:
      return { message: backend || 'A new check cannot be run for this order right now.', refetch: true };
    case 422:
      return { message: backend || "This customer's phone number could not be checked." };
    case 503:
      return { message: backend || 'Risk check is not configured.' };
    case 429: {
      const sec = err.retryAfter && err.retryAfter > 0 ? err.retryAfter : 60;
      return { message: `Too many checks for this customer. Try again in ${sec} seconds.`, cooldownSec: sec };
    }
    default:
      if (err.code === 'NETWORK_ERROR') return { message: 'Could not reach the server. Check your connection and try again.' };
      return { message: backend || 'Something went wrong. Please try again.' };
  }
}
