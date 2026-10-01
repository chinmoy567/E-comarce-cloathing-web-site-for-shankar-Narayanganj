import { bdCourierProvider } from './bdCourierProvider.js';
import type { RiskCheckProvider } from './types.js';

/**
 * One configured provider in v1 (spec 16 open question 5), behind the
 * `RiskCheckProvider` interface so a second can be added without touching the
 * service or the panel. `setRiskProvider` is the test seam.
 */
let active: RiskCheckProvider = bdCourierProvider;

export function getRiskProvider(): RiskCheckProvider {
  return active;
}

/** Test seam: swap the provider; call with no argument to restore BD Courier. */
export function setRiskProvider(provider?: RiskCheckProvider): void {
  active = provider ?? bdCourierProvider;
}
