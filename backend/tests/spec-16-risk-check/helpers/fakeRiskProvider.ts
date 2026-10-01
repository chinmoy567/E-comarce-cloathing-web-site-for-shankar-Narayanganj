import { RiskProviderError } from '../../../src/services/fraud/providers/types.js';
import type { RiskCheckProvider, RiskCheckResult } from '../../../src/services/fraud/providers/types.js';

/**
 * A scriptable in-memory RiskCheckProvider for spec 16. It is NOT a recording of
 * BD Courier (CLAUDE.md §6): it exists so the risk service, the controller, the
 * permission layer and Postgres run for real while only the outbound provider is
 * replaced. The real adapter's wire contract is covered separately in
 * provider-mapping.unit.test.ts / provider-request.unit.test.ts.
 */
export type FakeMode = 'ok' | 'noHistory' | 'partial' | 'timeout' | 'http500' | 'plainThrow';

export const RAW_MARKER = 'PROVIDER-RAW-MARKER-do-not-leak';

export type FakeRiskProvider = RiskCheckProvider & {
  readonly state: { calls: string[]; mode: FakeMode; configured: boolean; result: RiskCheckResult };
  reset(): void;
};

const okResult = (): RiskCheckResult => ({
  riskLevel: 'LOW',
  riskScore: null,
  totalOrders: 25,
  successfulOrders: 22,
  returnedOrders: 3,
  raw: { status: 'success', providerOnlyKey: RAW_MARKER },
});

export function makeFakeRiskProvider(key = 'FAKE_RISK'): FakeRiskProvider {
  const state: FakeRiskProvider['state'] = { calls: [], mode: 'ok', configured: true, result: okResult() };

  const provider: FakeRiskProvider = {
    key,
    state,
    isConfigured: () => state.configured,
    async check(normalizedPhone: string): Promise<RiskCheckResult> {
      state.calls.push(normalizedPhone);
      switch (state.mode) {
        case 'timeout':
          throw new RiskProviderError('Risk provider could not be reached.', { reason: 'UPSTREAM_UNREACHABLE' });
        case 'http500':
          throw new RiskProviderError('Risk provider returned an error status.', { httpStatus: 500 });
        case 'plainThrow':
          throw new Error('boom: unexpected adapter failure');
        case 'noHistory':
          return { riskLevel: 'UNKNOWN', riskScore: null, totalOrders: null, successfulOrders: null, returnedOrders: null, raw: { status: 'success', providerOnlyKey: RAW_MARKER } };
        case 'partial':
          return { riskLevel: 'MEDIUM', riskScore: null, totalOrders: null, successfulOrders: null, returnedOrders: null, raw: { status: 'success', providerOnlyKey: RAW_MARKER } };
        default:
          return state.result;
      }
    },
    reset() {
      state.calls = [];
      state.mode = 'ok';
      state.configured = true;
      state.result = okResult();
    },
  };
  return provider;
}
