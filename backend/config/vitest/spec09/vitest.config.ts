import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/** Spec 09 — server-side cart and wishlist. Files listed explicitly, like every other per-slice config here. */
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
    include: [
      'tests/spec-09-cart-wishlist/cart-operations.test.ts',
      'tests/spec-09-cart-wishlist/cart-merge.test.ts',
      'tests/spec-09-cart-wishlist/wishlist.test.ts',
      'tests/spec-09-cart-wishlist/security.test.ts',
    ],
  },
});
