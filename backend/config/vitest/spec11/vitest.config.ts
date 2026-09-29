import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * The spec 11 suite on its own — customer checkout (guest + registered):
 * §2.9.3 ordered validation, idempotency, duplicate bKash transaction id
 * rejection, coupon revalidation at order creation, registered-customer
 * profile-completeness gating, and guest order lookup non-enumeration.
 *
 * Files listed explicitly rather than matched by a glob, like every other
 * per-slice config here — a pattern would silently pull in a later slice's
 * similarly-named tests.
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
    // Schema-building suites share one Supabase connection cap.
    fileParallelism: false,
    include: [
      'tests/spec-11-checkout/checkout.api.test.ts',
      'tests/spec-11-checkout/customerAccount.api.test.ts',
    ],
  },
});
