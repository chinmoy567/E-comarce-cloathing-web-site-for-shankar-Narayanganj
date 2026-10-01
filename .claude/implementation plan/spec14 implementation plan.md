# Spec 14 — Courier Abstraction & Shipment Creation: Implementation Plan

## Context
Spec: `.claude/implementation specs/14-courier-abstraction-and-shipment-creation.md` (PRD 04 §4.1–4.11, 4.15; 05 §5.5–5.6; 07 §5.21.5/5.21.7; 06 §5.16). Goal: Admin/Manager picks a courier and creates a shipment from the order panel; data-driven courier registry; Pathao + Steadfast adapters behind one contract; `CREATING` as concurrency lock; retry/change-courier; Cancel Shipment port wired into order cancellation.

**Codebase reality (differs from the spec's assumptions):**
- Spec 12 (new state-machine API) is NOT built. Only legacy `services/shipmentStatus.service.ts` (`updateShipmentStatus`, `recordCourierError`) and `services/orderStatus.service.ts` (`cancelOrder`, `startProcessing`) exist; no `status_sequence`, no guard trigger, no `CourierCancellationPort`. **Decision (user): adapt spec 14 to the existing services.**
- Migration `0012` is taken (admin order views); latest is `0012`, no `0013`. `geography_and_courier_mapping.sql` is unnumbered and sorts AFTER numbered files, so new migrations must not FK to `courier_location_mappings`.
- `shipments` already exists (`0006_orders.sql:113`) with columns `courier`, `shipment_status`, `courier_order_id`, `courier_error`, `courier_error_at`; read by shipments/orders repos, adminOrderPanel, checkout, dashboard, tests. **Rename is high blast radius → add columns, keep existing names.** `createShipmentRow` has zero callers, so real orders have no shipment row → upsert on create.
- Existing courier pieces to reuse: `services/courier/courierLocation.service.ts` (`resolveLevels`), `mappings/pathao.mapping.ts`, `steadfast.mapping.ts`, `repositories/courierLocationMapping.repository.ts` (empty mapping tables, no sync).
- Existing shipment transition table lacks change-courier/cancel edges.
- User has Pathao/Steadfast sandbox access → live verification is in scope.
- **Flag:** `backend/.env.example` is tracked and holds a real-looking `DATABASE_URL`. Replace with placeholder (and rotate the credential) before adding courier vars. Needs user OK since it's outside spec.

## Step 0 — Pre-work
1. Fetch current official Pathao + Steadfast API docs (WebFetch) — auth, create/track/cancel/lookup endpoints, status vocab, Pathao city/zone/area lookup. Record findings in the adapter files' header comments. No guessing (CLAUDE.md §6).
2. Sanitize `.env.example`; add `PATHAO_*`, `STEADFAST_*` (base URLs + creds, all optional like `META_*` pattern in `config/env.ts`), `DEFAULT_PARCEL_WEIGHT_GRAMS`.

## Step 1 — Migration `0014_couriers_and_shipments.sql`
(Use 0013 only if a number gap is unwanted; runner sorts by filename.)
- `couriers` table per spec (+ `supports_reference_lookup`), seed `PATHAO`, `STEADFAST`. `code` format CHECK matching `courier_location_mappings` (`^[A-Z][A-Z0-9_]{1,31}$`).
- `ALTER shipments ADD`: `tracking_url`, `cod_amount numeric(12,2)`, `declared_weight_grams`, `last_error_courier`, `created_with_courier_at`, `shipped_at`, `cancelled_with_courier_at`. Keep `courier` (add FK → `couriers(code)` NOT VALID/validate after backfill), `courier_error`, `courier_error_at` as the spec's `last_error`/`last_error_at`. No `status_sequence`.
- `courier_requests` (digest only, no PII).
- Seed no new permissions (all six keys already in `0002` and `PermissionKey`).
- Update `tests/shared/enums.parity.test.ts` only if enums change (none planned).

## Step 2 — Courier service layer (`backend/src/services/courier/`)
- `types.ts`: `CourierAdapter`, `CourierShipmentRequest/Result`, `NormalizedTracking` exactly as spec.
- `registry.ts`: `adapter_key → adapter` map; resolve via `couriers` row (enabled check).
- `adapters/pathao.adapter.ts`, `adapters/steadfast.adapter.ts`: use `lib/safeFetch.ts` (allowlist from configured base URLs), per-adapter status map (unknown → null, logged+ignored), reuse `courierLocation.service.resolveLevels` for Pathao ids; unresolved address → clear actionable error. Declare non-secret `configSchema`.
- `courierService.ts`: wraps every call with timeout, `courier_requests` row (SHA-256 digest of payload), error normalization to sanitized message; no internal retry on create; no raw provider data returned.
- `repositories/couriers.repository.ts`, `courierRequests.repository.ts`; extend `shipments.repository.ts` (upsert row, new columns, `FOR UPDATE` read).

## Step 3 — Shipment orchestration (`services/shipment.service.ts`)
Single creation path used by create / retry / change-courier:
1. Tx A (`withTransaction`): lock order + upsert/lock shipment `FOR UPDATE`; guard: `CREATING`→409 `SHIPMENT_CREATION_IN_PROGRESS`, `CREATED+`→409 `SHIPMENT_ALREADY_EXISTS`, order must be CONFIRMED/PROCESSING (`ORDER_NOT_READY_FOR_SHIPMENT`), bKash needs `PAID_VERIFIED` (`PAYMENT_NOT_VERIFIED`), courier enabled (`COURIER_UNAVAILABLE`); set `courier`, transition →`CREATING` via `updateShipmentStatus`. Commit.
2. Call adapter OUTSIDE tx (for retry w/ `supports_reference_lookup`: lookup by order reference first).
3. Tx B: success → `CREATED`, store id/tracking_url/cod_amount/weight, then `startProcessing` if order CONFIRMED (needs small refactor so it can join an outer client, or run after commit); failure → `CREATION_FAILED` + `recordCourierError` (+`last_error_courier`). Nothing else changes (no payment/order mutation).
- Amounts: `orders.total_amount`; `codAmount` = total for COD, 0 for bKash. Weight = Σ `weight_grams × qty` else default.
- Add shipment transitions needed: `CREATION_FAILED→CREATING` (exists); change-courier is the same edge with a new courier (no `CREATED→CREATING`). `mark-shipped`: `CREATED→SHIPPED` (exists).
- `CourierCancellationPort` (`services/courier/cancellationPort.ts`) + wire into `orderStatus.service.cancelOrder`: if shipment ≥ CREATED, call cancel; `cancelled:false` or `supports_cancel=false` → 409 `COURIER_CANCELLATION_FAILED`, order unchanged. Update legacy `cancelOrderController` (`controllers/admin/orders.controller.ts:252`) to surface that code.
- `ShipmentView` builder incl. `allowedActions` (single place) and `retryMayDuplicate`; extend `computeAllowedActions`/order detail shipment shape in `adminOrderPanel.service.ts`.

## Step 4 — Routes, validation, config
- `validation/shipment.validation.ts` (`.strict()` zod): `{courierCode}`, courier-config PATCH (config keys ∈ adapter `configSchema`; `trackingUrlTemplate` https + one `{trackingId}`).
- Order-scoped routes in `routes/admin/orders.routes.ts` (`:id` param, matching current `/orders/:id` convention; spec says `:orderNumber` — confirm with existing panel, keep `:id` for consistency): GET shipment, POST create, retry, change-courier, mark-shipped, GET requests (paginated). Permissions per spec table; create/change also `courier.select`.
- New `routes/admin/couriers.routes.ts` mounted in `routes/admin/index.ts`: `GET /couriers` (`courier.select`), `GET/PATCH /courier-config` (`courier.manage`). All behind `requireAuth('admin')` + `rateLimit('authenticatedCeiling')`; consider a `shipmentCreate` limiter in `config/rateLimits.ts`.
- Add 501 not needed (cancellation failure is 409); `COURIER_REQUEST_FAILED` via `UpstreamError` with code. Audit every action via `audit.repository.append`.

## Step 5 — Frontend (`frontend/src/`)
- Types `ShipmentView`, `CourierOption`, `CourierConfigView` in `lib/admin/types.ts`.
- `components/admin/orders/shipment/`: `ShipmentSection`, `CourierPicker`, `ShipmentCreatePanel`, `ShipmentStatusCard`, `ShipmentFailureNotice` (retry dialog only when `retryMayDuplicate`); replaces read-only slot in `app/admin/(shell)/orders/[id]/page.tsx`, `onOrderChanged` → existing `reload`. Single `inFlight` flag, 5 s poll while `CREATING` (stop at 2 min), error-code handling per spec.
- `app/admin/(shell)/settings/couriers/page.tsx` + `components/admin/settings/CourierConfigRow.tsx`; nav entry in `lib/admin/nav.ts` (`requires: 'courier.manage'`). No credential fields.
- Route rename `[id]`→`[orderNumber]` is spec 13's concern; keep `[id]` to avoid scope creep (note as known deviation).
- Reuse `Button`, `FormField`, `ToggleField`, `ShipmentStatusBadge`, `apiGet/apiPost/apiPatch`, `useAdminSession().hasPermission`. Do not use `lib/account.ts` `courierLabel`.

## Step 6 — Tests (spec-wise)
New `backend/tests/spec-14-courier/` (+ `config/vitest/spec14/vitest.config.ts`, `test:spec14` script, `TEST_ORGANIZATION.md` entry). Seed orders/shipments with raw INSERT helpers like `adminOrderPanel.api.test.ts`. Cover the spec's 18 required tests: concurrent create (one adapter call), create-from-CREATED rejected, no-cascade on failure, no auto-retry, retry only from CREATION_FAILED, change courier, SHIPPED unreachable, bKash/COD gating, discounted amounts, shared adapter contract suite, status normalization (+unknown ignored), no raw provider data, registry data-driven, cancellation port, permission separation, no credentials/SSRF, audit/no PII, address mapping. Adapters tested against recorded real sandbox fixtures (no invented payloads). Use `testing-agent` for this step.

## Verification
- `npm run typecheck` and `npm run test:spec14`, plus existing `test:spec07`, `test:spec12`, `test:spec11` (shared shipment columns/cancel path) and `tests/shared`.
- `grep -ri "PATHAO_CLIENT_SECRET\|STEADFAST_API_KEY" frontend/` → empty.
- Live sandbox run: create shipment for a COD and a bKash order via each courier, retry-after-failure, change courier, cancel an order with a CREATED shipment; verify `courier_requests` has digests only.
- Browser check of order page at 375 px and `/admin/settings/couriers` (Manager default: no access).

## Risks / open items
- Pathao zone/area resolution depends on empty `courier_location_mappings` (no sync routine) → plan includes a minimal lookup-and-cache in the Pathao adapter; actionable error when unresolved.
- `startProcessing` opens its own tx; may need an optional `client` param.
- Providers without merchant-reference lookup → duplicate-parcel risk after timeouts (UI warns).
