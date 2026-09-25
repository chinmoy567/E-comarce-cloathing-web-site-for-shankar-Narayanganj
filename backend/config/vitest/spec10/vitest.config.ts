import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * The spec 10 suite on its own — the coupon/discount validation engine,
 * `recordCouponUsage`'s concurrency guarantees, the public preview endpoint,
 * and admin coupon CRUD/RBAC.
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
      'tests/spec-10-coupon/validateCoupon.unit.test.ts',
      'tests/spec-10-coupon/couponUsage.repository.test.ts',
      'tests/spec-10-coupon/coupons.api.test.ts',
      'tests/spec-10-coupon/couponValidate.api.test.ts',
    ],
  },
});
