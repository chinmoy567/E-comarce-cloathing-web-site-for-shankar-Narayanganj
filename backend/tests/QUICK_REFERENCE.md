# Test Files — Quick Reference

## Where to Save New Test Files

**Always save test files in spec-based folders, never in the root `tests/` folder.**

| Spec | Folder | Example | Config |
|------|--------|---------|--------|
| **01** | `spec-01-auth/` | `password.test.ts` | `vitest.spec02.config.ts` (includes spec 01) |
| **02** | `spec-02-admin-rbac/` | `managers.api.test.ts` | `vitest.spec02.config.ts` |
| **03** | `spec-03-audit/` | `audit.repository.test.ts` | `vitest.spec03.config.ts` |
| **04** | `spec-04-security/` | `rateLimit.api.test.ts` | `vitest.spec04.config.ts` |
| **05** | `spec-05-catalogue/` | `inventory.service.test.ts` | `vitest.spec05.config.ts` |
| **Shared** | `shared/` | `migrate.test.ts`, `transaction.test.ts` | `vitest.config.ts` (all configs) |

## Steps to Add a New Test

1. **Determine the spec** — Which requirement doc does this test cover?
   - Check `.claude/project requirement documents/` to find the right spec number

2. **Save in the right folder**:
   ```
   backend/tests/spec-XX-name/your-test.test.ts
   ```

3. **Update the vitest config** — Add the file to `include`:
   ```typescript
   // backend/vitest.specXX.config.ts
   include: [
     'tests/spec-XX-name/your-test.test.ts',
     // ... other tests
   ]
   ```

4. **Update TEST_ORGANIZATION.md** if creating a new spec folder

## Running Tests

```bash
# All tests
npm test

# Specific spec
npm run test:spec02    # Spec 02 tests
npm run test:spec05    # Spec 05 tests

# Watch mode
npm run test:watch
```

## Folder Purpose Reference

| Folder | Purpose |
|--------|---------|
| `spec-01-auth/` | Customer auth, identity schema, password, phone validation |
| `spec-02-admin-rbac/` | Admin auth, managers, permissions, RBAC matrix |
| `spec-03-audit/` | Audit log repository & API |
| `spec-04-security/` | Rate limiting, upload validation, HTML sanitization, headers |
| `spec-05-catalogue/` | Products, categories, variants, inventory |
| `shared/` | Migrations, transactions, enums, geography, utilities |

---

**See TEST_ORGANIZATION.md for full details.**
