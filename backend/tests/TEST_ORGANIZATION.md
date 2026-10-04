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
├── spec-14-courier/                 # Courier abstraction, shipment creation/retry/change, cancellation port
├── spec-15-tracking/                # Courier status sync, public Track Order, guest lookup, customer order history
├── spec-16-risk-check/              # Customer risk check: cache, status gate, rate limit, failure, RBAC, audit, leak guards
├── spec-20-analytics-reports/       # Back-office reports: revenue recognition, permissions, bounded ranges, no-PII, rollup, async export
├── spec-21-shipping/                # Shipping fee computation: zone resolution, rate strategies, coupon ordering, snapshots, admin zone/rate API + RBAC
├── spec-22-storage/                 # Storage, implementation spec 06 private slice (legacy label spec06 is RBAC): bKash payment screenshot upload, private bucket, signed-URL admin read
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
- `spec-13-homepage-cms/cmsLookups.api.test.ts` — spec 17: product/category lookups, attachment reads, campaign `sections[]` + `displayStatus` (RBAC `cms.manage`)
- `spec-13-homepage-cms/homepageSections.limit.api.test.ts` — spec 17: `SECTION_LIMIT_REACHED` at the 101st section
- `spec-13-homepage-cms/homepage.ogImage.api.test.ts` — spec 17: `ogImageUrl` absolute `https://` or null, campaign hero override

### Spec 14: Courier Abstraction and Shipment Creation
- `spec-14-courier/courierShipment.api.test.ts` — HTTP + DB: CREATING concurrency lock, failure without cascade, retry/change courier/mark-shipped, bKash vs COD gating, discounted amounts, cancellation port, registry, `courier.select` vs `courier.manage`, audit/no-PII, reference lookup (schema `spec14_courier`)
- `spec-14-courier/courierAdapter.contract.test.ts` — reusable adapter contract suite (§4.9), no DB; add real adapters with one `runCourierAdapterContract(...)` call
- `spec-14-courier/helpers/fakeCourierAdapter.ts`, `helpers/courierAdapterContract.ts` — scriptable fake adapter and the contract function
- Deferred until official provider docs/fixtures exist: status normalization (spec test 11), provider address mapping (test 18), SSRF host allowlist (test 16, second half)

### Spec 15: Status Sync, Track Order, Guest Lookup and Order History
- `spec-15-tracking/courierSync.api.test.ts` — signed webhook route + poller + real applier: duplicate/stale/out-of-order, webhook/poll convergence, signature verification, DELIVERED/RETURNED cascades (stock restoration, rollback on a failed order write), COD payment untouched, CREATED→SHIPPED stays manual (schema `spec15_sync`)
- `spec-15-tracking/trackOrder.api.test.ts` — public Track Order: exact key-set hygiene, non-enumeration (byte-identical bodies), no fabricated tracking, validation, refresh TTL caching (schema `spec15_track`)
- `spec-15-tracking/guestLookupAndHistory.api.test.ts` — guest lookup pair/non-enumeration/hygiene/phone variants, three independent statuses, account history scoping and order-number routes (schema `spec15_lookup`)
- `spec-15-tracking/lookupRateLimits.api.test.ts` — separate limiters for the two public lookups (schema `spec15_limits`)
- `spec-15-tracking/helpers/syncFakeAdapter.ts` — scriptable fake adapter with its own TEST-ONLY HMAC webhook scheme (real provider schemes await official docs)
- Frontend (pure logic, node env): `frontend/tests/tracking.test.ts`

### Spec 16: Customer Risk Check
- `spec-16-risk-check/customer-risk-service.test.ts` — caching (GET never calls the provider, POST once), customer_id cache key, append-only history, tampered body ignored, phone normalization, no status side effects (schema `spec16_service`)
- `spec-16-risk-check/status-gate.test.ts` — server-side CONFIRMED/PROCESSING gate, one test per status, 404/400 handling (schema `spec16_status_gate`)
- `spec-16-risk-check/rate-limiting.test.ts` — under/over limit, per-customer isolation via the customer limiter, gate before limiter (schema `spec16_rate_limit`)
- `spec-16-risk-check/failure-handling.test.ts` — CHECK_FAILED degradation, no history is UNKNOWN, absent fields stay null, 503/422 rows (schema `spec16_failure`)
- `spec-16-risk-check/guest-parity.test.ts` — guest vs registered parity, no account_type branch (schema `spec16_guest`)
- `spec-16-risk-check/permissions.test.ts` — customer.risk.check on both verbs, 401/403 identity, ASSIGNED grant path (schema `spec16_permissions`)
- `spec-16-risk-check/audit-logging.test.ts` — audit row contents, atomicity by failure injection (schema `spec16_audit`)
- `spec-16-risk-check/security.test.ts` — raw_result key-set, outbound payload exactly `{phone}` through the real adapter (safeFetch mocked), API key never leaks, risk absent from guest lookup / Track Order / customer order detail and history (schema `spec16_security`)
- `spec-16-risk-check/provider-mapping.unit.test.ts` — `mapBdCourierResponse` (no database): band table, unrecognised band, absent fields null, no history
- `spec-16-risk-check/provider-request.unit.test.ts` — `bdCourierProvider.check` request shape and failure surfaces (no database, safeFetch mocked)
- `spec-16-risk-check/helpers/fakeRiskProvider.ts`, `helpers/riskFixture.ts` — scriptable fake provider (via `setRiskProvider`) and the shared real-Postgres fixture
- Provider bodies are shaped from the adapter's documented contract, NOT recorded official BD Courier payloads (none available)

### Spec 20: Analytics and Business Reports
Run with `npm run test:spec20` (`config/vitest/spec20/vitest.config.ts`).
- `spec-20-analytics-reports/reports.api.test.ts` — revenue recognition per order status, discounted totals, Asia/Dhaka day boundaries, seven order-status buckets, payments lines and computed COD discrepancy, derived stock with per-variant thresholds, customer composition (claimed guest counted once), registry-driven courier grouping, coupon aggregates, `analytics.view` matrix (401/403/200 on every endpoint), bounded ranges / pagination / sort allowlists, no-PII key-set, no writes (table hashes), daily rollup idempotency and late cancellation, async export (202, owner-scoped 404, signed URL, CSV equals API, FAILED handling, rate limit) (schema `spec20_reports`; the private storage module is faked)
- `spec-20-analytics-reports/reports.unit.test.ts` — range/cap/sort-allowlist schemas, CSV escaping and formula neutralising, default rollup window (no database)

Run with `npm run test:spec21` (`config/vitest/spec21/vitest.config.ts`).

Run with `npm run test:spec22` (`config/vitest/spec22/vitest.config.ts`).
- `spec-22-storage/paymentProof.api.test.ts` — customer upload (`POST /api/orders/:orderNumber/payment-proof`, raw body + `X-Order-Phone`): WebP re-encode with EXIF stripped and edge <= 2000px, server-generated path in the private bucket, wrong phone == unknown order, SVG/HTML/PHP rejected with nothing stored, 5 MB cap without leaking the global 100 kb limit, only bKash orders awaiting verification, replacement retires the old object (row kept if the bucket delete fails), compensating delete on a failed DB write, public bucket refused, audit row; guest lookup never exposes the proof; admin `GET /api/admin/orders/:id/payment/proof` signed URL (TTL, `no-store`, 401/403 without `payment.view`). Supabase Storage is replaced by an in-memory fake (schema `spec22_payment_proof_api`)
- `spec-21-shipping/computeShipping.unit.test.ts` — zone resolution (metro / non-metro / default, case- and whitespace-insensitive), the three strategies and the exact free-over-threshold boundary, exact poisha arithmetic, append-only rate history and future-dated rates, determinism, the unmatched-district tally (only at order time) and the schema CHECKs / single-default-zone index (schema `spec21_shipping_unit`)
- `spec-21-shipping/shipping.api.test.ts` — public quote and `POST /api/checkout/validate` (derived metro flag, `.strict()` rejection, no unmatched writes), `createOrder` totals + `shipping_zone_code` snapshot + total CHECK, §8.14c discount-before-shipping and §8.10 minimum-order interplay, post-discount free-shipping threshold, snapshot immutability + audit before/after, admin zone/rate API (`system.configure` 401/403 on every route, atomic create, full district replacement, make-default, no delete route) and a concurrent-checkout invariant (schema `spec21_shipping_api`)
- `spec-21-shipping/shipping.limits.api.test.ts` — security regressions on the public pricing endpoint: `couponValidate` limiter applies when `checkout/validate` carries a coupon code (and not otherwise), 50-line cap on validate and order creation, bounded unmatched-district key (schema `spec21_shipping_limits`)

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
npm run test:spec12      # Admin order panel, customers, dashboard (implementation spec 13)
npm run test:spec13      # Spec 13 (Homepage/Campaign CMS); implementation spec 17 tests live here too
npm run test:spec14      # Spec 14 (Courier abstraction & shipment creation)
npm run test:spec15      # Spec 15 (Status sync, Track Order, guest lookup, order history)
npm run test:spec16      # Spec 16 (Customer risk check)
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
- `backend/config/vitest/spec14/vitest.config.ts` — Spec 14 only (Courier & shipment creation)
- `backend/config/vitest/spec15/vitest.config.ts` — Spec 15 only (Status sync, Track Order, guest lookup, order history)
- `backend/config/vitest/spec16/vitest.config.ts` — Spec 16 only (Customer risk check)
- `backend/config/vitest/spec21/vitest.config.ts` — Spec 21 only (Shipping fee computation)
- `backend/config/vitest/spec22/vitest.config.ts` — Storage / payment screenshot only (implementation spec 06 private slice)
- `backend/config/vitest/geography/vitest.config.ts` — Geography seeding
- `backend/config/vitest/spec10/vitest.config.ts` — Spec 10 only (Coupon/Discount Engine)
- `backend/config/vitest/spec12/vitest.config.ts` — Admin order panel / customers / dashboard (implementation spec 13)
- `backend/config/vitest/spec13/vitest.config.ts` — Spec 13 only (Homepage/Campaign CMS)

## Spec 09 — cart and wishlist

`tests/spec-09-cart-wishlist/` — cart CRUD and pricing, guest-to-account merge, wishlist, schema/PII checks. Run with `npm run test:spec09`; config in `config/vitest/spec09/vitest.config.ts`.
