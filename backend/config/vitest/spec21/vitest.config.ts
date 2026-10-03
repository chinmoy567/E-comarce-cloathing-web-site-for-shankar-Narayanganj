import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Shipping fee computation (implementation spec 21): zone resolution, the three rate strategies and
 * the exact threshold boundary, the §8.14c/§8.10 ordering with coupons, snapshot immutability, the
 * single-default-zone guarantee, `.strict()` rejection of client-supplied amounts, and
 * `system.configure` enforcement with audit. Files listed explicitly, like every other per-slice config here.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    include: ['tests/spec-21-shipping/computeShipping.unit.test.ts', 'tests/spec-21-shipping/shipping.api.test.ts', 'tests/spec-21-shipping/shipping.limits.api.test.ts'],
  },
});
