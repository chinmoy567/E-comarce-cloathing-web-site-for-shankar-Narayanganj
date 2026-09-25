import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * The spec 04 suite on its own — rate limiting, upload validation, HTML
 * sanitization, the SSRF-guarded fetch wrapper, security headers, and the
 * pagination registry invariant (spec 04 §Tests required).
 *
 * Real Express middleware, a real `rate-limiter-flexible` store, and a real
 * test database throughout for the HTTP-level suite: the composite
 * identifier+IP keying and the audit-log rejection row are the things under
 * test, and a mock would assert nothing (spec 04 §Tests required preamble).
 *
 * Files listed explicitly rather than matched by a glob, matching
 * `vitest.spec02.config.ts` / `vitest.spec03.config.ts` — a pattern would
 * silently pull in a later slice's similarly named tests.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    include: [
      'tests/spec-04-security/rateLimit.api.test.ts',
      'tests/spec-04-security/uploadValidation.test.ts',
      'tests/spec-04-security/sanitizeHtml.test.ts',
      'tests/shared/safeFetch.test.ts',
      'tests/spec-04-security/securityHeaders.test.ts',
      'tests/spec-04-security/paginationRegistry.invariants.test.ts',
    ],
  },
});
