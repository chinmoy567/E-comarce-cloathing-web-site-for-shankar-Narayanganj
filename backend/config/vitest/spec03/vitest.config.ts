import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: [
      'tests/spec-01-auth/seedAdmin.test.ts',
      'tests/shared/resetAdminPassword.script.test.ts',
      'tests/spec-01-auth/adminAuth.service.test.ts',
      'tests/spec-01-auth/adminAuth.api.test.ts',
      'tests/spec-01-auth/requireAuth.test.ts',
      'tests/spec-02-admin-rbac/requirePermission.test.ts',
      'tests/spec-02-admin-rbac/permissions.service.test.ts',
      'tests/spec-02-admin-rbac/managers.service.test.ts',
      'tests/spec-02-admin-rbac/managers.api.test.ts',
      'tests/spec-02-admin-rbac/rbacMatrix.test.ts',
      'tests/spec-03-audit/auditLogs.api.test.ts',
      'tests/spec-01-auth/refreshTokens.repository.test.ts',
      'tests/spec-04-security/adminHttpSurface.invariants.test.ts',
    ],
  },
});
