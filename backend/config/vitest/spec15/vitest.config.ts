import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Courier status sync, public Track Order, guest order lookup and customer order history
 * (implementation spec 15): the idempotent applier (duplicate/stale/convergence), webhook
 * signature verification, the DELIVERED/RETURNED cascades, non-enumeration and payload hygiene
 * of both public lookups, separate rate limiters, and account order scoping. Files listed
 * explicitly, like every other per-slice config here.
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
      'tests/spec-15-tracking/courierSync.api.test.ts',
      'tests/spec-15-tracking/trackOrder.api.test.ts',
      'tests/spec-15-tracking/guestLookupAndHistory.api.test.ts',
      'tests/spec-15-tracking/lookupRateLimits.api.test.ts',
    ],
  },
});
