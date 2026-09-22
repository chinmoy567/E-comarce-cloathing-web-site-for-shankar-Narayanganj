import { defineConfig } from 'vitest/config';

/**
 * The spec 03 suite on its own — Admin seed, back-office authentication, RBAC
 * middleware, and Manager account/permission management.
 *
 * Real Express middleware and a real test database throughout: the
 * permission-check layer is never mocked, because it is the thing under test
 * (spec 03 §Tests required). Running them alone, with `npm run test:spec03`,
 * keeps that feedback loop short while `npm test` still runs everything.
 *
 * Files listed explicitly rather than matched by a glob, matching
 * `vitest.spec02.config.ts` — a pattern would silently pull in a later
 * slice's tests, and this config's whole job is to delimit spec 03.
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: [
      'tests/seedAdmin.test.ts',
      'tests/resetAdminPassword.script.test.ts',
      'tests/adminAuth.service.test.ts',
      'tests/adminAuth.api.test.ts',
      'tests/requireAuth.test.ts',
      'tests/requirePermission.test.ts',
      'tests/permissions.service.test.ts',
      'tests/managers.service.test.ts',
      'tests/managers.api.test.ts',
      'tests/rbacMatrix.test.ts',
      'tests/auditLogs.api.test.ts',
      'tests/refreshTokens.repository.test.ts',
      'tests/adminHttpSurface.invariants.test.ts',
    ],
  },
});
