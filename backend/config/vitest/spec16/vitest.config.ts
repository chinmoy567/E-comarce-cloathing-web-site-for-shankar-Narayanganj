import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Customer risk check (implementation spec 16, 09-fraud-risk-check §7): customer_id-keyed caching,
 * the server-side CONFIRMED/PROCESSING gate, per-customer rate limiting, graceful provider failure,
 * guest parity, customer.risk.check enforcement, audit rows, raw_result / outbound-payload hygiene,
 * absence of risk data from customer-facing payloads, and the BD Courier adapter mapping.
 * Files listed explicitly, like every other per-slice config here.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    include: [
      'tests/spec-16-risk-check/provider-mapping.unit.test.ts',
      'tests/spec-16-risk-check/provider-request.unit.test.ts',
      'tests/spec-16-risk-check/customer-risk-service.test.ts',
      'tests/spec-16-risk-check/status-gate.test.ts',
      'tests/spec-16-risk-check/rate-limiting.test.ts',
      'tests/spec-16-risk-check/failure-handling.test.ts',
      'tests/spec-16-risk-check/guest-parity.test.ts',
      'tests/spec-16-risk-check/permissions.test.ts',
      'tests/spec-16-risk-check/audit-logging.test.ts',
      'tests/spec-16-risk-check/security.test.ts',
    ],
  },
});
