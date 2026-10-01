# Spec 16 — Customer Risk Check: Implementation Plan

## Context
Spec: `.claude/implementation specs/16-customer-risk-check.md` (PRD `09-fraud-risk-check.md`). Admin/Manager can explicitly run a courier-history risk check from the order detail page; results are cached per `customer_id`, failures degrade gracefully, `raw_result` never leaves the backend.

Exploration shows the spec's "Quick Start ✅ Implemented" claim is false. Old spec-9 code exists and conflicts with the spec 16 contract almost everywhere, so this is a **rewrite of the risk-check slice**, not an extension:
- `backend/src/services/fraud/customerRiskService.ts`: raw `fetch`, guessed endpoint, invented score thresholds, `|| null` turns 0 into NULL, doesn't store UNKNOWN/CHECK_FAILED, `forceRefresh`, private duplicate phone normalizer, reads `process.env` directly.
- `orders.controller.ts` ~L509-625 `checkCustomerRiskController` (POST only, `/:id`, `{success,data}`, 400 not 409).
- `orders.routes.ts` L105-112, `orders.validation.ts` L95-101.
- `migrations/0008_customer_risk_checks.sql`: text risk_level, integer score, `order_id NOT NULL UNIQUE` (kills append-only history), NOT NULL raw_result/checked_by.
- Frontend `CustomerRiskSection.tsx` / `RiskLevelBadge.tsx` (POST only, client-side status gate, "—" for nulls, off-palette colours).
- Test `tests/spec-09-fraud-risk/customer-risk-service.unit.test.ts` (tests private methods that will be removed).

## Decisions (defaults chosen; flag if you disagree)
1. **Routes by `:orderNumber`**: add `GET/POST /api/admin/orders/:orderNumber/risk-check` alongside the existing UUID routes (use `ordersRepository.findByOrderNumber`). Order detail page keeps its UUID route; it passes `order.order_number` to the component. Register these before `/:id` patterns, with an order-number params schema. Remove the old `POST /:id/risk-check`.
2. **Migration 0016 is an ALTER** of the 0008 table (0008 can't be edited; `CREATE TABLE` would no-op). Create `risk_level` enum; convert `risk_level` text→enum (map existing values, unknown→`UNKNOWN`); `risk_score`→`numeric(6,2)`; drop `UNIQUE(order_id)`; `order_id` nullable + `ON DELETE SET NULL`; `raw_result`, `checked_by` nullable; `customer_id` FK `ON DELETE CASCADE`. Keep `(customer_id, checked_at DESC)` index. Forward-only, no transaction control (runner wraps it).
3. **Per-customer rate limit**: the `riskCheck` limiter is keyed per actor+IP. Add a customer-keyed limit (new `IdentifierSource` or a small `riskCheckRateLimiter.ts` in `services/fraud/`) reusing `RL_RISK_CHECK_MAX/WINDOW_SEC` (3 / 900s). Applied after the status gate, per customer and per actor. GET is already covered by `authenticatedCeiling` on `/orders`.
4. **New errors** in `lib/errors.ts`: 422 `INVALID_PHONE_NUMBER` and 503 `RISK_PROVIDER_UNCONFIGURED` subclasses (no existing class); 409 via `new ConflictError(msg, undefined, 'RISK_CHECK_NOT_ALLOWED')`.
5. **Provider API**: do NOT guess. First implementation step is fetching the current BD Courier docs (https://bdcourier.com/api-docs#endpoints) and writing the adapter against them. If docs define no risk bands/score thresholds, map to `UNKNOWN`.
6. **Spec inconsistencies** resolved in favour of the "Contract additions" section (no `forceRefresh`, no body, bare `RiskCheckResponse`, `triggerBlockedReason`, `/:orderNumber`). Quick Start block should be corrected afterwards.

## Backend steps
1. `migrations/0016_customer_risk_checks.sql` per decision 2.
2. `config/env.ts` + `.env.example`: add optional `BD_COURIER_API_KEY`, `BD_COURIER_BASE_URL` to the zod schema (never exposed; never logged).
3. `services/fraud/providers/types.ts` (`RiskCheckResult`, `RiskCheckProvider`) and `providers/bdCourierProvider.ts` using `safeFetch` (`lib/safeFetch.ts`; `allowedHosts` from `BD_COURIER_BASE_URL`, bounded `timeoutMs`). Missing field → `null`; no history → `UNKNOWN`; unrecognised band → `UNKNOWN` + log; only the normalized phone is sent. Provider selected via a small registry like `services/courier/registry.ts` (test seam for a fake provider).
4. `repositories/customerRiskChecks.repository.ts`: `findLatestForCustomer(customerId)` (explicit column list, **no `raw_result`**), `insert(...)`, and a separate audit-only `getRaw(id)`. No `SELECT *`.
5. Rewrite `services/fraud/customerRiskService.ts`: `getCached(orderNumber)` (no provider call, computes `available`, `canTriggerFreshCheck`, `triggerBlockedReason`, `successRatePercent` only when both inputs exist, `checkedByUserIdentifier`) and `runFreshCheck(orderNumber, actor)`: status gate (409) → customer limiter → `normalizeBdPhone` from `lib/phone.ts` (422) → provider configured? (503) → call → insert row (success/UNKNOWN/CHECK_FAILED with error in `raw_result`, `order_id` provenance, `checked_by`) → `audit.repository.append` in the same transaction (`withTransaction`). Provider failure returns 200 `CHECK_FAILED` with "Risk check unavailable — please try again."; never touches order/payment/shipment status. Remove the private normalizer and `getSupabase()` usage.
6. Controller/routes/validation: replace old controller with `getRiskCheck` / `postRiskCheck`; `requirePermission('customer.risk.check')`; POST chain adds `rateLimit('riskCheck')`; strict empty-body validation; responses use the repo's `{data}` envelope (bare `RiskCheckResponse` inside it).
7. Delete the stale spec-9 service unit test (replaced by spec-16 tests).

## Frontend steps
1. `lib/admin/types.ts`: add `RiskCheckResponse` exactly per spec (+ `triggerBlockedReason`), no raw field.
2. Rewrite `components/admin/orders/CustomerRiskSection.tsx` (props `orderNumber`, `canCheck`): GET on mount only, POST on button click only (no body), `inFlight` ref, states table from spec (loading, never-checked keyed off `available:false`, result, no history, CHECK_FAILED→"Try Again", disabled with visible `triggerBlockedReason`, 429 countdown from `ApiClientError.retryAfter`, 403/409/422/503 handling, `role="status"/"alert"`), `dl/dt/dd`, omit null fields, wrap in error boundary, 48px full-width button at 375px (Button is `h-11`; override via className). Heading "Customer Risk"; no "fraud/criminal/blacklist/scam/suspect" wording.
3. Rewrite `RiskLevelBadge.tsx`: palette `#059669/#F59E0B/#DC2626/#6B7280` on a 4px start border + inline SVG glyph, label text `#111827`, `aria-label`, no score inside the badge.
4. `app/admin/(shell)/orders/[id]/page.tsx` (L237): render the section only when `hasPermission('customer.risk.check')`, pass `order.order_number`; drop `orderStatus`/`orderId` props.
5. Dates: use `formatDate` from `lib/account.ts`; verify en-GB month output ("Sept" vs "Sep") and normalise to `DD MMM YYYY` if needed.

## Tests (spec-wise, per CLAUDE.md §10)
- Create `backend/tests/spec-16-risk-check/` with files from spec Key Files list covering all 16 "Tests required" (caching, customer-keyed cache across two orders, status gate per status incl. direct API calls, failure/UNKNOWN/null handling, unrecognised band, raw_result key-set assertion, outbound payload minimality, phone normalization, per-customer rate limit, 403, guest parity, audit row, no status side effects, risk absent from customer-facing payloads for guest lookup/Track Order/customer order detail).
- Fake provider test seam + `tests/spec-16-risk-check/helpers/`; copy `config/vitest/spec15/vitest.config.ts` → `config/vitest/spec16/vitest.config.ts` with explicit includes; add `test:spec16` to `package.json`; update `TEST_ORGANIZATION.md`.
- Frontend: vitest env is `node` with no component tooling; extract display logic (field visibility, state selection, labels) into a pure module and unit test it, rather than adding jsdom/testing-library (avoid new tech). Include a wording-discipline test and `grep BD_COURIER frontend/` check.
- Use the `testing-agent` for the test slice after implementation.

## Reuse
`lib/safeFetch.ts`, `lib/phone.ts` (`normalizeBdPhone`), `repositories/audit.repository.ts` (`append`), `middleware/requirePermission.ts`, `middleware/rateLimit.ts` + `config/rateLimits.ts`, `ordersRepository.findByOrderNumber`, `customers.repository.findById`, `lib/errors.ts`, `withTransaction`; frontend `apiGet/apiPost/ApiClientError`, `useAdminSession().hasPermission`, `components/admin/Button.tsx`.

## Verification
1. `npm run migrate` against a disposable DB; confirm schema, and old rows convert.
2. `npm run test:spec16`, plus backend typecheck and the existing spec-09/11/15 suites (leak guards must still pass), and the RBAC matrix test.
3. Frontend typecheck/lint/tests; `grep -ri BD_COURIER frontend/` returns nothing.
4. Manual via running app (`run` skill): open a CONFIRMED order (zero provider calls on load), click Check Customer Risk with the fake/real provider, check PENDING order → button disabled + direct POST 409, failure path, 375px layout.
5. Real provider smoke test only with a user-supplied API key.

## Open items to tell the user
- Real provider key/docs needed at build time; no key = 503 `RISK_PROVIDER_UNCONFIGURED` (spec Quick Start's "returns UNKNOWN" claim is overridden by the Error cases table).
- Spec Quick Start block is inaccurate (claims implemented, `forceRefresh`, `/{id}` paths) and should be corrected.
