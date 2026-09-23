# Test Organization — Spec-Based Structure

Tests are organized into spec-based subdirectories to improve clarity and enable targeted testing.

## Directory Structure

```
backend/tests/
├── setup.ts                      # Shared test setup (database, fixtures)
├── fixtures/                     # Shared test data and factories
├── helpers/                      # Shared test utilities
│
├── spec-01-auth/                 # Spec 01: Customer Authentication & Identity
│   ├── schema.identity.test.ts
│   ├── password.test.ts
│   ├── phone.test.ts
│   ├── adminAuth.service.test.ts
│   ├── adminAuth.api.test.ts
│   ├── requireAuth.test.ts
│   ├── refreshTokens.repository.test.ts
│   └── seedAdmin.test.ts
│
├── spec-02-admin-rbac/           # Spec 02: Admin Operations & RBAC
│   ├── permissions.repository.test.ts
│   ├── permissions.seed.test.ts
│   ├── permissions.service.test.ts
│   ├── rbacMatrix.test.ts
│   ├── managers.service.test.ts
│   ├── managers.api.test.ts
│   └── requirePermission.test.ts
│
├── spec-03-audit/                # Spec 03: Audit Logging
│   ├── audit.repository.test.ts
│   └── auditLogs.api.test.ts
│
├── spec-04-security/             # Spec 04: Security Hardening
│   ├── sanitizeHtml.test.ts
│   ├── securityHeaders.test.ts
│   ├── uploadValidation.test.ts
│   ├── rateLimit.api.test.ts
│   ├── adminHttpSurface.invariants.test.ts
│   └── paginationRegistry.invariants.test.ts
│
├── spec-05-catalogue/            # Spec 05: Catalogue & Admin Management
│   ├── catalogue.schema.test.ts
│   ├── catalogue.service.test.ts
│   ├── catalogue.api.test.ts
│   └── inventory.service.test.ts
│
└── shared/                       # Foundation tests (all specs)
    ├── env.test.ts
    ├── app.test.ts
    ├── migrate.test.ts
    ├── transaction.test.ts
    ├── health.repository.test.ts
    ├── enums.parity.test.ts
    ├── pagination.test.ts
    ├── users.repository.test.ts
    ├── customers.repository.test.ts
    ├── geography.repository.test.ts
    ├── geography.api.test.ts
    ├── courierLocationMapping.test.ts
    ├── resetAdminPassword.script.test.ts
    └── safeFetch.test.ts
```

## Test Scripts

Run tests for a specific spec using the corresponding npm script:

```bash
# Run all tests
npm test

# Run a specific spec
npm run test:spec02      # Spec 02: Admin/RBAC
npm run test:spec03      # Spec 03: Audit
npm run test:spec04      # Spec 04: Security
npm run test:spec05      # Spec 05: Catalogue

# Run geography (independent data tests)
npm run test:spec08geo

# Watch mode (all tests)
npm run test:watch
```

## Why This Structure?

1. **Clarity**: Each spec's tests are grouped together, making it easy to understand what's being tested
2. **Isolation**: Run tests for a single spec without waiting for all tests to complete
3. **Navigation**: Files are organized by feature/spec, matching the `.claude/project requirement documents/` structure
4. **Maintenance**: Easy to add new tests for a spec or remove tests when a spec is refactored
5. **Documentation**: The directory structure serves as a quick reference for project architecture

## Adding New Tests

When implementing a new spec:

1. Create a new directory: `spec-XX-feature-name/`
2. Add test files to that directory
3. Update the corresponding `vitest.specXX.config.ts` with the test file paths
4. Add an npm script `test:specXX` to `package.json`

## Shared Test Utilities

- `tests/setup.ts` — Database setup, fixture initialization (loaded by all configs)
- `tests/fixtures/` — Reusable test data factories
- `tests/helpers/` — Utility functions for tests

All vitest configs include `setupFiles: ['./tests/setup.ts']` to ensure database and fixtures are initialized.
