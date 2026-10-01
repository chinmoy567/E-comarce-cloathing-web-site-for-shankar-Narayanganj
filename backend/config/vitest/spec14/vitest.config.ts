import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Courier abstraction and shipment creation (implementation spec 14): the CREATING
 * concurrency lock, failure/no-cascade, retry and change-courier, bKash/COD gating,
 * discounted amounts, the cancellation port, courier.select vs courier.manage, and
 * the reusable adapter contract suite. Files listed explicitly, like every other
 * per-slice config here.
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
      'tests/spec-14-courier/courierAdapter.contract.test.ts',
      'tests/spec-14-courier/courierShipment.api.test.ts',
    ],
  },
});
