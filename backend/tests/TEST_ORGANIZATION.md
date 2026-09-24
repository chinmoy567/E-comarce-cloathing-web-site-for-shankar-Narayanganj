# Test Organization

All test files are organized by spec in `backend/tests/`. Each spec has its own folder and corresponding vitest configuration for isolated test runs.

## Directory Structure

```
backend/tests/
├── spec-01-auth/                    # Customer auth & identity tests
├── spec-03-audit/                   # Audit logging tests
├── spec-04-security/                # Security hardening tests
├── spec-05-catalogue/               # Catalogue & product management tests
├── spec-06-rbac/                    # RBAC (Role-Based Access Control) - Admin role management, permissions, managers
├── spec-07-order-state-machine/     # Order/Payment/Shipment state machine tests
├── shared/                          # Foundation tests (utilities, migrations, enums, etc.)
└── setup.ts                         # Shared test setup
```

## Test Files by Spec

### Spec 01: Authentication
- `spec-01-auth/schema.identity.test.ts` — Database schema constraints for identity table
- `spec-01-auth/phone.test.ts` — Phone number validation
- `spec-01-auth/password.test.ts` — Password hashing and validation

### Spec 03: Audit
- `spec-03-audit/audit.repository.test.ts` — Audit log repository operations

### Spec 04: Security
- `spec-04-security/...` — Security hardening tests

### Spec 05: Catalogue
- `spec-05-catalogue/...` — Product catalogue and management tests

### Spec 06: RBAC (Role-Based Access Control)
- `spec-06-rbac/permissions.repository.test.ts` — Permission matrix data layer
- `spec-06-rbac/permissions.seed.test.ts` — Permission seeding on startup
- `spec-06-rbac/permissions.service.test.ts` — Permission resolution logic (Admin vs Manager)
- `spec-06-rbac/rbacMatrix.test.ts` — Permission matrix structure and validation
- `spec-06-rbac/requirePermission.test.ts` — Permission middleware enforcement
- `spec-06-rbac/managers.service.test.ts` — Manager CRUD and permission assignment
- `spec-06-rbac/managers.api.test.ts` — Manager API endpoints

### Spec 07: Order/Payment/Shipment State Machine
- `spec-07-order-state-machine/orderStateMachine.unit.test.ts` — Transition table validation (no DB)

### Shared
- `shared/migrate.test.ts` — Database migration tests
- `shared/enums.parity.test.ts` — Enum parity checks between DB and TypeScript
- `shared/transaction.test.ts` — Transaction handling tests
- `shared/users.repository.test.ts` — User repository operations
- `shared/customers.repository.test.ts` — Customer repository operations

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Spec-Specific Tests
```bash
npm run test:spec02      # Spec 02 (Identity & Schema)
npm run test:spec03      # Spec 03 (Audit)
npm run test:spec04      # Spec 04 (Security)
npm run test:spec05      # Spec 05 (Catalogue)
npm run test:spec06      # Spec 06 (RBAC)
npm run test:spec07      # Spec 07 (Order/Payment/Shipment State Machine)
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

## Adding a New Test

1. **Identify the spec** — Check `.claude/project requirement documents/` or the feature being tested
2. **Choose/create the folder** — Save in the appropriate `spec-XX-name/` folder
3. **Update the vitest config** — If creating a new spec folder:
   - Create `backend/config/vitest/specXX/vitest.config.ts`
   - Add `include` paths for your new tests
   - Add npm script: `"test:specXX": "vitest run --config config/vitest/specXX/vitest.config.ts"`
4. **Update this file** — Document the new test and its location

## Why This Organization Matters

- **Clear relationship** between tests and requirements
- **Isolated test runs** — `npm run test:spec06` runs only Spec 06 tests
- **Faster feedback** — Developers can run their spec's tests without waiting for the full suite
- **Maintainability** — Tests are colocated with related specs
- **Coverage auditing** — Easy to find which specs need more test coverage

## Test Configuration Files

Each spec has its own vitest config in `backend/config/vitest/`:

- `backend/config/vitest/vitest.config.ts` — Main config, runs all tests
- `backend/config/vitest/spec02/vitest.config.ts` — Spec 02 only
- `backend/config/vitest/spec03/vitest.config.ts` — Spec 03 only
- `backend/config/vitest/spec04/vitest.config.ts` — Spec 04 only
- `backend/config/vitest/spec05/vitest.config.ts` — Spec 05 only
- `backend/config/vitest/spec06/vitest.config.ts` — Spec 06 only (RBAC)
- `backend/config/vitest/spec07/vitest.config.ts` — Spec 07 only (Order State Machine)
- `backend/config/vitest/geography/vitest.config.ts` — Geography seeding
