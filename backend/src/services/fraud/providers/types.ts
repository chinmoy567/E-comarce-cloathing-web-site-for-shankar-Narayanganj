/**
 * Risk-check provider contract (spec 16 §Backend work, 09-fraud-risk-check §7.3).
 *
 * The provider adapter owns everything provider-specific: endpoint, auth, request
 * shape, response parsing. The service only ever sees this normalized result.
 */

/** The mapped, displayable outcome of one successful provider call. */
export type RiskCheckResult = {
  /** `UNKNOWN` covers "no courier history" and unrecognised provider bands — never HIGH (§7.8). */
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  /** Only if the provider returns one (§7.5). */
  riskScore: number | null;
  totalOrders: number | null;
  successfulOrders: number | null;
  returnedOrders: number | null;
  /** Stored for audit, never returned to the frontend (§7.6, §7.8). */
  raw: unknown;
};

export interface RiskCheckProvider {
  /** Stored in `customer_risk_checks.provider`. */
  readonly key: string;
  isConfigured(): boolean;
  /**
   * Looks up `normalizedPhone` (the ONLY outbound field, §7.9).
   * Throws `RiskProviderError` when the provider is unreachable, times out,
   * or answers with something that is not a usable result.
   */
  check(normalizedPhone: string): Promise<RiskCheckResult>;
}

/** A provider failure. The message is internal-safe (never contains credentials). */
export class RiskProviderError extends Error {
  constructor(
    message: string,
    /** Sanitised context for `raw_result`; never the API key. */
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RiskProviderError';
  }
}
