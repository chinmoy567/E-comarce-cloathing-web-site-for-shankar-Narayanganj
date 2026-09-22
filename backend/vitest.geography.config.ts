import { defineConfig } from 'vitest/config';

/**
 * The geography slice on its own — the Bangladesh administrative hierarchy,
 * its dataset seed, the lookup API, and the courier mapping boundary.
 *
 * Like spec 02's config, files are listed explicitly rather than globbed, so a
 * later slice's test cannot be pulled in by a similar name.
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    // Each suite builds and drops its own schema and seeds 579 rows into it.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One schema-building suite at a time: they share one Supabase connection cap.
    fileParallelism: false,
    include: [
      'tests/geography.repository.test.ts',
      'tests/geography.api.test.ts',
      'tests/courierLocationMapping.test.ts',
    ],
  },
});
