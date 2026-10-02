# Spec 20 — Analytics & Business Reports: Implementation Plan

## Context
Spec 20 (`.claude/implementation specs/20-analytics-and-business-reports.md`) is the last slice: read-only back-office reporting (sales, orders, payments, products/stock, customers, shipments, coupons) gated by `analytics.view`, bounded/paginated, with async CSV export and a daily rollup for trends. Nothing in it writes business data. Exploration showed the spec's assumed schema differs from the real one in several places, so this plan maps spec → reality first, then lists the work.

## Spec ↔ reality reconciliation (decisions)
| Spec assumes | Reality | Decision |
|---|---|---|
| `orders.placed_at` | `orders.created_at` (indexed DESC) | Use `created_at`; add `(created_at)` range index only if the DESC one is not usable (it is for range scans — likely skip) |
| `orders.discount`, `.shipping` | `discount_amount` (nullable), `shipping_amount` | `COALESCE(discount_amount,0)` |
| `payments` table | none; state is on `orders` (`payment_method`, `payment_status`) | All payment figures come from `orders` |
| `product_categories` | single `products.category_id`, 2-level `categories.parent_id` | By-category groups by the product's own category (no parent roll-up in v1) |
| Migration `0020_reporting.sql` | latest is `0016`; no 0013/0020 | Name it `0017_reporting.sql` (runner orders by filename; avoids a gap). Flag to user |
| `permissions` seed for `analytics.view` | already seeded (0002) and in `PERMISSION_KEYS` | No new permission/seed |
| Admin orders filters `orderStatus`, `hasCodDiscrepancy` | real keys are `order_status`, `has_cod_discrepancy` (snake_case); schema is non-strict so camelCase is silently ignored; the orders page does **not** read URL params | Report deep links use snake_case; add small `useSearchParams` support to `admin/(shell)/orders/page.tsx` |
| `coupon_usages.distinct customers` | table has `customer_id`, `discount_amount`, `used_at` | `COUNT(DISTINCT customer_id)` only |
| Private storage bucket + signed URLs (spec 06) | only a public `homepage-images` bucket exists; no signed-URL code | New small private-bucket helper (see Exports) |
| Scheduler | only pattern is a standalone script run by the deployment scheduler (`scripts/pollCourierStatus.ts`, `npm run poll:couriers`) | Same pattern for rollup refresh and export worker; no in-process timers |
| Test config `backend/vitest.specXX.config.ts` | real: `backend/config/vitest/specNN/vitest.config.ts` | Follow the real layout (CLAUDE.md §10 text is stale) |

**Date basis (one rule):** every date-bounded figure and every rollup day is bucketed by `orders.created_at` in Asia/Dhaka (`created_at AT TIME ZONE 'Asia/Dhaka'`). Range `[from, to]` → `[from 00:00 Dhaka, (to+1) 00:00 Dhaka)`. This avoids joining `order_status_history` for a delivered-at date; consequence: "delivered revenue" for a range = orders *placed* in the range that are now `DELIVERED`. State this in `meta` copy.

**Revenue rule:** `deliveredRevenue` = Σ`total_amount` where `order_status='DELIVERED'`; `pipelineValue` = statuses `PENDING_CONFIRMATION, COD_VERIFICATION_PENDING, CONFIRMED, PROCESSING`; `cancelledValue` = `CANCELLED` only; `RETURNED` is in none of the three. Product/category revenue uses `order_items.line_total` on DELIVERED orders (pre-coupon; coupon discount is not allocated to lines), so its sum will not equal `deliveredRevenue` — documented in UI copy.

## Backend

### Migration `backend/migrations/0017_reporting.sql` (forward-only, `IF NOT EXISTS`)
- `report_daily_sales` per spec (day PK, counts, numerics, `refreshed_at`). Day is Dhaka calendar day.
- `report_exports` (id uuid PK, `requested_by` → users, `report` text CHECK in the 11 `ReportName`s, `range_from`/`range_to` date, `status` text CHECK `PENDING|PROCESSING|READY|FAILED`, `storage_path`, `error_message`, `created_at`, `started_at`, `completed_at`). Text+CHECK instead of a pg enum → no enum-parity mirror needed.
- Indexes: `order_items(product_id)`, `order_items(order_id)` (check 0006 first — `order_id` index exists), `shipments(courier, status)` (real column names `courier`, `shipment_status`), `coupon_usages(coupon_id)`, `customers(created_at)`, `report_exports(requested_by, created_at)`.

### Config
- `src/config/env.ts`: add `REPORT_MAX_RANGE_DAYS` (default 366), `REPORT_EXPORT_URL_TTL_SEC` (default 300); mirror in `backend/.env.example` (no secrets — note `.env.example` currently contains what looks like a real `DATABASE_URL`; flag to user, don't copy).
- `src/config/constants.ts`: `REPORT_TIMEZONE='Asia/Dhaka'`, `REPORT_EXPORT_BUCKET='reports-exports'`.
- `src/config/rateLimits.ts`: new `reportExport` limiter (template: `riskCheck`), keyed on actor id.

### Code (new files, `reports.*` naming — `analytics.*` is taken by Meta spec 18)
- `src/validation/reports.validation.ts` — zod `.strict()`: shared `reportRangeSchema` (`from`,`to` ISO dates required; `from<=to`; span ≤ `REPORT_MAX_RANGE_DAYS` else `ValidationError(msg, details, 'RANGE_TOO_LARGE')`); `granularity`; per-endpoint `sort`/`order` allowlists (by-product & performance: `unitsSold|revenue|orderCount`, default `unitsSold desc`; stock: `stockQuantity|productName`; by-category: `revenue|unitsSold`); stock `filter`; `createExportSchema`; reuse `paginationQuerySchema` from `src/lib/pagination.ts`.
- `src/repositories/reports.repository.ts` — one grouped SQL per report via `run(db, fn)`; sort keys mapped through allowlist → fixed SQL fragments; all values parameterized. Exposes the same query functions to the export worker so CSV == screen.
- `src/services/reports.service.ts` — attaches `ReportMeta` (`computedAt`, `rollupRefreshedAt`, `revenueRecognition:'ORDER_STATUS_DELIVERED'`), builds `byStatus` with all 7 `order_status` keys zero-filled (`src/types/orderEnums.ts`), computes AOV (0 if none), `deliverySuccessRatePercent = delivered/(delivered+failedDelivery+returned)` or `null`.
- `src/routes/admin/reports.routes.ts`, mounted in `src/routes/admin/index.ts` like dashboard: `router.use('/reports', requireAuth('admin'), rateLimit('authenticatedCeiling'), requirePasswordChanged, reportsRoutes)`; each route `requirePermission('analytics.view')` then `validate({query})`. Routes: the 11 from the spec + `GET /config` + `POST /exports` (extra `rateLimit('reportExport')`, 202) + `GET /exports/:id`.
- Report queries (all via live tables except trend):
  - sales/summary: single `FILTER` aggregate on `orders`.
  - sales/trend: reads `report_daily_sales`; week/month via `date_trunc` + `SUM`; `rollupRefreshedAt = MIN(refreshed_at)` over range.
  - by-product / performance: `order_items JOIN orders (DELIVERED) JOIN products`, grouped, paginated; includes `productId`.
  - by-category: join `products → categories`, grouped, paginated.
  - orders/summary: `GROUP BY order_status`; `failedShipments` = shipments with `CREATION_FAILED|DELIVERY_FAILED`; `byPaymentMethod`.
  - payments/summary: `FILTER` counts; `codCollectionDiscrepancies` = `COD AND DELIVERED AND PENDING_COLLECTION` (same predicate as `orders.repository.ts` ~L406), never stored.
  - products/stock: `product_variants` join `products`; derived `stockState` (`stock_quantity=0` → OUT, `<= low_stock_threshold` → LOW); `filter`; threshold null-safe.
  - customers/summary: over `customers` rows (`account_type`), `newCustomersInRange` by `customers.created_at`, returning = ≥2 orders all-time (grouped by `orders.customer_id`), order share by joining `orders→customers.account_type` in range.
  - shipments/summary: `couriers LEFT JOIN shipments` so a newly registered courier appears with zero code change; `byStatus` over all 10 `shipment_status` values.
  - coupons/summary: orders with/without `coupon_id`, `SUM(discount_amount)`, top coupons from `coupons` + `coupon_usages` (`couponId`, `usageCount`, `usageLimit`, `totalDiscount`, `COUNT(DISTINCT customer_id)`); no customer identity.
- **Rollup refresh** `scripts/refreshReportRollups.ts` (+ `npm run refresh:reports`): `pg_try_advisory_lock`, recompute a day window (default last 35 days, `--from/--to` flag for backfill) via one `INSERT … SELECT … ON CONFLICT (day) DO UPDATE` from `orders` — recomputed, never incremented → idempotent; fills zero-days. Service function `refreshDailySales(from,to)` in `src/services/reportRollup.service.ts` so tests call it directly; script wraps it and calls `resetTransactionPool()` (mirror `pollCourierStatus.ts`). Document hourly schedule.
- **Async export:** `POST /exports` inserts a `PENDING` row (owner = `req.actor` user id; note memory: use `req.actor`, not `req.user`) and returns `202 {id,status}`. Worker `scripts/processReportExports.ts` (+ `npm run process:exports`) claims rows with `FOR UPDATE SKIP LOCKED`, runs the shared repository query (iterating pages up to a hard row cap), writes CSV (escape cells; prefix `= + - @` with `'` to block CSV injection), uploads to the **private** bucket `reports-exports` (new `src/services/storage/reportExports.service.ts`: ensure-bucket-private, upload, `createSignedUrl` with TTL), marks `READY`/`FAILED` with `error_message`. `GET /exports/:id` is owner-scoped (other admin → 404) and mints a fresh signed URL on each READY read.

## Frontend (`frontend/src`)
- `lib/admin/nav.ts`: add `{ href:'/admin/reports', label:'Reports', requires:'analytics.view' }`.
- `lib/admin/reports.ts`: types mirrored from spec, `useReport<T>(path, params)` on `apiGet`/`apiList` with `AbortController` + latest-ticket stale guard (pattern from `OrderHistoryList.tsx`), `useReportConfig()` cached for session (`/reports/config`), pure helpers (range presets in Dhaka via `Intl.DateTimeFormat`, range validation, chart axis thinning, export poll logic) so they are unit-testable (frontend vitest is node-only, no jsdom).
- `lib/account.ts`: `formatMoney(amount, { decimals?: 2 })` (existing callers unchanged).
- Pages under `app/admin/(shell)/reports/`: `layout.tsx` (tabs `role=tablist`, range selector, URL-query state `from/to/granularity/page`), `page.tsx` (redirect → `sales`), and `sales|orders|payments|products|customers|shipments|coupons/page.tsx`. Each page shows full-page "You do not have access to reports." on 403.
- `components/admin/reports/`: `ReportRangeSelector`, `ReportHeader`, `MetricCard(Row)`, `ReportTable` (table ≥md / stacked `dl` cards <md), `ReportPagination`, `TrendChart` (hand-built SVG, single axis, `#1F2937` line, `#E5E7EB` grid, focusable points, tap-to-pin tooltip, `role="img"` + aria-label, table directly beneath), `ShareBar` (`#1F2937`/`#9CA3AF`), `BarList`, `ExportButton` (POST → poll 3 s up to 5 min → Download link / Get new link / FAILED+Retry), `ReportState`. No charting dependency.
- Sales page shows the three revenue figures separately, never merged; Payments discrepancy links to `/admin/orders?has_cod_discrepancy=true`; Orders status counts link to `/admin/orders?order_status=<ENUM>`; product rows → `/admin/catalogue/products/{id}`; top coupons → `/admin/marketing/coupons/{id}` (both routes exist).
- `app/admin/(shell)/orders/page.tsx`: read `order_status` / `has_cod_discrepancy` from `useSearchParams` to seed its filters (minimal change; verify existing behaviour is unchanged).
- Run the dataviz skill's `validate_palette.js` on `#1F2937`/`#9CA3AF`; check 320 px and 375 px.
- Frontend must not sum/derive any figure; no PII anywhere.

## Tests
- Backend: `backend/tests/spec-20-analytics-reports/` — `reports.api.test.ts` (per-status revenue recognition, discounted totals, 7 status buckets, payments lines, COD discrepancy computed, customers incl. claimed guest counted once, stock derived + per-variant threshold, courier registry-driven, coupon aggregate), `reports.security.test.ts` (permission matrix Admin / Manager ungranted 403 / Manager granted 200 on every endpoint; key-set no-PII assertion; missing/oversized range; pagination bound; sort allowlist 400; no writes — snapshot business tables before/after), `reportRollup.test.ts` (idempotent re-run; late cancellation reflected), `reportExports.test.ts` (202 immediate, owner-scoped 404, private bucket via fake storage, CSV == API payload). Seed with inline SQL (the shared `helpers/factories.ts` is stale); use `resetSchema('spec20_reports')`, `loginAsAdmin`, `describe.skipIf(!TEST_DATABASE_URL)`.
- Config: `backend/config/vitest/spec20/vitest.config.ts` (copy spec16: explicit `include`, `fileParallelism:false`), `package.json` script `test:spec20`, entry in `backend/tests/TEST_ORGANIZATION.md`.
- Frontend: `frontend/tests/reports.test.ts` for the pure helpers (range/cap validation, Dhaka presets, axis thinning, null success rate label, export poll timeout).
- Delegate test writing to the `testing-agent` after build.

## Build order
1. Migration + env/constants/rate limiter → 2. validation + repository + service + routes + `/config` → 3. rollup service/script → 4. export table/worker/storage helper → 5. backend tests + spec20 vitest config → 6. frontend lib/helpers/components/pages + orders-page URL params → 7. frontend tests, lint, responsive check.

## Verification
- `cd backend && npm run migrate` against a throwaway schema; `npm run test:spec20`; full `npm test` + `enums.parity` (unchanged) to confirm no regressions; `npm run lint`/typecheck both packages.
- Run `refresh:reports` twice, diff `report_daily_sales`; run `process:exports` and download via signed URL.
- `/run` the app: log in as Admin and as a Manager without `analytics.view` (nav hidden, direct URL → access state, API 403); view each tab at 375 px/320 px; confirm CSV matches screen.
- Note: migration is not applied to the real DB (consistent with specs 15/16 open items) — user applies.

## Open items to flag to the user
1. Revenue recognised on `DELIVERED` (spec's flagged assumption) and bucketed by **placed** date, not delivered date.
2. "Failed orders" = failed shipments; CSV export is beyond literal PRD text (§5.9).
3. Migration numbered 0017 (not 0020); `.claude/CLAUDE.md` §10 vitest path is stale.
4. `backend/.env.example` appears to contain a real Supabase `DATABASE_URL`/password — worth rotating/removing.
5. Product/category revenue is pre-coupon line totals; by-category uses leaf category only.
