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
├── spec-10-coupon/                  # Coupon/discount engine and admin coupon management tests
├── spec-13-homepage-cms/            # Homepage/campaign CMS: visibility, product resolution, admin CRUD, RBAC
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
- `spec-07-order-state-machine/SPEC07_SECURITY_TESTING.md` — Comprehensive security, API, and frontend test specifications

### Spec 10: Coupon / Discount Engine and Admin Management
- `spec-10-coupon/validateCoupon.unit.test.ts` — Validation engine and §8.14 discount calculation (no DB)
- `spec-10-coupon/couponUsage.repository.test.ts` — `recordCouponUsage` concurrency (§8.25), delete-vs-archive (§8.9), code normalization
- `spec-10-coupon/coupons.api.test.ts` — Admin coupon CRUD, RBAC matrix rows, audit rows
- `spec-10-coupon/couponValidate.api.test.ts` — Public `POST /api/coupons/validate`: non-enumeration, client-economics rejection, rate limiting

### Spec 13: Homepage / Campaign CMS
- `spec-13-homepage-cms/visibility.unit.test.ts` — `computeVisibility()` (§13.7a), no DB
- `spec-13-homepage-cms/contentConfig.validation.test.ts` — per-`section_type` `content_config` schemas (§13.3), no DB
- `spec-13-homepage-cms/homepageCms.urlValidation.test.ts` — `ctaUrl`/`secondaryCtaUrl` (§13.13), no DB
- `spec-13-homepage-cms/homepageCms.visualThemeConstrained.test.ts` — `visual_theme` allowlist (§13.13), no DB
- `spec-13-homepage-cms/homepageImages.upload.test.ts` — content-sniffed image validation (§13.11), no DB
- `spec-13-homepage-cms/homepageSections.sectionTypeImmutable.test.ts` — DB trigger rejects a direct `section_type` change (§13.4)
- `spec-13-homepage-cms/homepageSections.reorder.repository.test.ts` — atomic reorder, invalid list rejected (§13.12)
- `spec-13-homepage-cms/productResolution.automaticRules.test.ts` — LATEST/FEATURED/CATEGORY, Inactive/out-of-stock exclusion (§13.5)
- `spec-13-homepage-cms/productResolution.onSale.test.ts` — ON_SALE union of compare_at_price + restricted-coupon sources (§13.5)
- `spec-13-homepage-cms/productResolution.manualSelection.test.ts` — manual mode order/Inactive/out-of-stock badge (§13.6)
- `spec-13-homepage-cms/homepage.campaignInteraction.test.ts` — a section hidden when its campaign is non-visible (§13.4)
- `spec-13-homepage-cms/homepage.serverTimeOnly.test.ts` — no client-supplied evaluation timestamp (§13.7a)
- `spec-13-homepage-cms/homepage.renderingOrder.test.ts` — response sorted by `display_order`, reorder changes it (§13.8)
- `spec-13-homepage-cms/homepage.emptyCarouselOmitted.test.ts` — zero-product carousel dropped entirely (§13.8)
- `spec-13-homepage-cms/homepage.previewIsolation.test.ts` — DRAFT/DISABLED never on the public route (§13.12), highest-value security test
- `spec-13-homepage-cms/homepageCms.permissions.test.ts` — `cms.manage` RBAC gate on every mutating + preview endpoint (§13.14)
- `spec-13-homepage-cms/homepage.noDuplicatedCatalogueData.test.ts` — a product rename reflected with zero CMS writes (§13.1)
- `spec-13-homepage-cms/homepage.publicProjection.test.ts` — response matches `PublicProductSummary`'s key set exactly
- `spec-13-homepage-cms/homepage.imageFallback.test.ts` — desktop-only/mobile-only sections resolve both fields (§13.11)
- `spec-13-homepage-cms/homepageCms.richTextSanitization.test.ts` — `CUSTOM_CONTENT.body` sanitized before storage (§13.13)
- `spec-13-homepage-cms/homepageCms.audit.test.ts` — one audit row per logical mutation, none on a rejected request (§5.15 rule 10)
- `spec-13-homepage-cms/campaigns.crud.test.ts` — campaign CRUD, slug uniqueness, delete nulls linked sections' `campaign_id` (§13.7)

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
npm run test:spec10      # Spec 10 (Coupon/Discount Engine)
npm run test:spec13      # Spec 13 (Homepage/Campaign CMS)
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
- `backend/config/vitest/spec10/vitest.config.ts` — Spec 10 only (Coupon/Discount Engine)
- `backend/config/vitest/spec13/vitest.config.ts` — Spec 13 only (Homepage/Campaign CMS)
