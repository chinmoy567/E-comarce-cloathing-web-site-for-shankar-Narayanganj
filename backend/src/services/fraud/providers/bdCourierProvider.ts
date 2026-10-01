import { getEnv } from '../../../config/env.js';
import { UpstreamError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { safeFetch } from '../../../lib/safeFetch.js';
import { RiskProviderError, type RiskCheckProvider, type RiskCheckResult } from './types.js';

/**
 * BD Courier adapter (09-fraud-risk-check §7.3), written against the provider's
 * published developer docs (https://bdcourier.com/api-docs#endpoints):
 *
 *   POST {BD_COURIER_BASE_URL}/courier-check
 *   Authorization: Bearer <API key>
 *   body: { "phone": "01XXXXXXXXX" }
 *
 *   -> { status: "success", data: { <courier>: {...}, summary: {
 *          total_parcel, success_parcel, cancelled_parcel, success_ratio } },
 *        risk_verdict: { level: "safe"|"low"|"medium"|"high"|"danger", ... } }
 *
 * The provider returns NO numeric risk score, so `riskScore` is always null.
 * Its `cancelled_parcel` count is the closest field to "returned/failed
 * deliveries" (§7.5) and is mapped to `returnedOrders`. `success_ratio` is not
 * stored — the service derives it from the counts for display.
 */

const TIMEOUT_MS = 8_000;

type Level = RiskCheckResult['riskLevel'];

/** Provider band -> our level. Only bands the provider documents are mapped; anything else is UNKNOWN. */
const BAND_MAP: Record<string, Level> = {
  safe: 'LOW',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  danger: 'HIGH',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A non-negative integer count, or null when the field is absent/not a clean count (never 0 as a placeholder, §7.5). */
function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Pure mapping of a parsed provider body to a result. Exported for tests. */
export function mapBdCourierResponse(body: unknown): RiskCheckResult {
  if (!isRecord(body) || body.status !== 'success' || !isRecord(body.data) || !isRecord(body.data.summary)) {
    throw new RiskProviderError('Unrecognised risk provider response shape.');
  }

  const summary = body.data.summary;
  const total = count(summary.total_parcel);
  const raw = body;

  // No courier history: the provider reports zero parcels. Absence of history is not risk (§7.8).
  if (total === 0) {
    return { riskLevel: 'UNKNOWN', riskScore: null, totalOrders: null, successfulOrders: null, returnedOrders: null, raw };
  }

  let riskLevel: Level = 'UNKNOWN';
  const verdict = isRecord(body.risk_verdict) ? body.risk_verdict : null;
  const band = typeof verdict?.level === 'string' ? verdict.level.toLowerCase() : null;
  if (band && BAND_MAP[band]) {
    riskLevel = BAND_MAP[band];
  } else {
    logger.warn({ band }, 'Risk provider returned an unrecognised or missing risk band; mapped to UNKNOWN');
  }

  return {
    riskLevel,
    riskScore: null,
    totalOrders: total,
    successfulOrders: count(summary.success_parcel),
    returnedOrders: count(summary.cancelled_parcel),
    raw,
  };
}

export const bdCourierProvider: RiskCheckProvider = {
  key: 'BD_COURIER',

  isConfigured(): boolean {
    return Boolean(getEnv().BD_COURIER_API_KEY);
  },

  async check(normalizedPhone: string): Promise<RiskCheckResult> {
    const env = getEnv();
    const apiKey = env.BD_COURIER_API_KEY;
    if (!apiKey) throw new RiskProviderError('Risk provider is not configured.');

    const baseUrl = env.BD_COURIER_BASE_URL.replace(/\/+$/, '');
    let response: Response;
    try {
      response = await safeFetch(`${baseUrl}/courier-check`, {
        allowedHosts: [new URL(baseUrl).hostname],
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        // The normalized phone is the ONLY outbound field (§7.9).
        body: JSON.stringify({ phone: normalizedPhone }),
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: 1024 * 1024,
      });
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : 'UNKNOWN';
      throw new RiskProviderError('Risk provider could not be reached.', { reason: code });
    }

    if (!response.ok) {
      throw new RiskProviderError('Risk provider returned an error status.', { httpStatus: response.status });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RiskProviderError('Risk provider returned a non-JSON response.');
    }
    return mapBdCourierResponse(body);
  },
};
