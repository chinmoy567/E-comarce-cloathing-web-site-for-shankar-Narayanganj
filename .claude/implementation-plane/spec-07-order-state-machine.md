# Spec 7 — Order/Payment/Shipment State Machine: Implementation Plan

## Context

Spec 7 (`07-order-state-machine.md` §5.21) is the **authoritative** source for the `orders` table's three independent status fields (`orderStatus`, `paymentStatus`, `shipmentStatus`), their allowed values, and every legal transition between them. No `orders`, `payments`, or `shipments` table exists yet — this is greenfield schema work, confirmed by a full backend exploration (no matches for `orderService`/`orderController`/`orderRoutes`/`orders` table anywhere in `backend/`).

Critically, the surrounding infrastructure was **already built anticipating this spec**:
- `backend/src/lib/transaction.ts`'s own docstring names "the shipment/order cascade... 07-order-state-machine §5.21.6" as a required use of `withTransaction`.
- `backend/src/types/permissions.ts` already contains every permission key this spec needs (`order.confirm`, `order.cancel`, `order.cod.confirm`, `payment.verify`, `payment.reject`, `payment.review`, `shipment.create`, `shipment.retry`, `shipment.courier.change`, `courier.select`, etc.) — no new RBAC keys required.
- `backend/src/repositories/audit.repository.ts`'s `append(entry, db)` is designed to be called with the caller's transaction client so a status change and its audit row commit atomically — exactly what §5.21.11 requires ("previous status, new status, timestamp, triggering user or system process, reason, related event").
- `backend/src/repositories/inventory.repository.ts`'s `conditionalDecrement`/`unconditionalIncrement` already implement the atomic check-and-decrement / unconditional-restore primitives that §5.1's stock rules (referenced by 05-admin-operations, cross-linked from Spec 7) require on `CONFIRMED` and on `CANCELLED`/`RETURNED`.

This plan scaffolds the `orders`/`payments`/`shipments` schema, a pure transition-table validator, and the repository/service/controller/route layers — following the exact layering already established by the catalogue module (spec 05) — so that every transition in §5.21 is enforced server-side, atomically, with a full audit trail, and gated by the existing RBAC middleware.

**Scope boundary:** this plan covers the state machine itself (schema, enums, transition validation, transition endpoints, stock cascade, audit trail) per §5.21. It does NOT cover: bKash payment screenshot upload/verification UI details (§3.1, partially out of scope — only the `paymentStatus` transitions themselves are in scope), courier API adapters (Section 4, a separate spec), coupon calculation (Section 8/10, separate spec — only the passive `coupon_id`/`discount_amount` columns are included here since §5.21.11 says coupon fields "coexist" on the same order row), or the fraud/risk-check feature (Section 9). Order *creation* (the full checkout transaction described in 03-payment-order §3) is also a separate concern — this plan adds a minimal internal `createOrder` capable of inserting a row in its correct initial status so the state machine can be tested end-to-end, but the full checkout validation/idempotency-key/coupon-revalidation flow is out of scope here.

---

## 1. Database Migration — `backend/migrations/0006_orders.sql`

Follow the exact style of `0005_catalogue.sql` (comment header naming the spec, section-delimited comments citing spec sections, `uuid` PKs via `gen_random_uuid()`, `timestamptz DEFAULT now()`, explicit `CONSTRAINT ..._pkey`/`..._fkey`/`..._check` names, partial/composite indexes where needed).

### Enums (§5.21, §5.21.2, §5.21.3, §5.21.4)

```sql
CREATE TYPE order_status AS ENUM (
  'PENDING_CONFIRMATION', 'COD_VERIFICATION_PENDING', 'CONFIRMED',
  'PROCESSING', 'DELIVERED', 'CANCELLED', 'RETURNED'
);

CREATE TYPE payment_method AS ENUM ('BKASH', 'COD');

-- bKash values ('PENDING_VERIFICATION','PAID_VERIFIED','REJECTED') and COD
-- values ('PENDING_COLLECTION','PAID_COLLECTED','REJECTED') share one enum;
-- which subset is valid for a given order is enforced in the service layer
-- keyed off payment_method, not by two separate Postgres enums, since the
-- column itself is single-valued regardless of method.
CREATE TYPE payment_status AS ENUM (
  'PENDING_VERIFICATION', 'PAID_VERIFIED', 'REJECTED',
  'PENDING_COLLECTION', 'PAID_COLLECTED'
);

CREATE TYPE shipment_status AS ENUM (
  'NOT_CREATED', 'CREATING', 'CREATED', 'SHIPPED', 'IN_TRANSIT',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'CREATION_FAILED', 'DELIVERY_FAILED', 'RETURNED'
);
```

### `orders` table

Columns: `id uuid pk`, `order_number text unique` (store-generated, distinct from any courier ID per §4.15), `customer_id uuid not null references customers(id)`, `payment_method payment_method not null`, `order_status order_status not null`, `payment_status payment_status not null`, `subtotal numeric(12,2) not null`, `shipping_amount numeric(12,2) not null default 0`, `coupon_id uuid null` (no FK yet — `coupons` table doesn't exist; add the FK constraint in the Spec 10 migration once `coupons` exists, per the exploration finding), `discount_amount numeric(12,2) null`, `total_amount numeric(12,2) not null`, `cancellation_reason text null`, `cancelled_at timestamptz null`, `cancelled_by uuid null references users(id)`, `created_at`, `updated_at`.

Constraints:
- `orders_total_amount_check CHECK (total_amount >= 0)`, `subtotal_check CHECK (subtotal >= 0)`.
- `orders_order_number_key UNIQUE (order_number)`.
- A **DB-level guard for the coexistence rule** in §5.21.3 ("COD collection discrepancy... this is not an error condition"): no CHECK constraint should try to enforce order_status/payment_status combinations — the spec explicitly allows `DELIVERED` + `PENDING_COLLECTION` and `DELIVERED` + `REJECTED` to coexist as valid states. Do not add a cross-column CHECK that would block these; validation of "was this transition legal" lives entirely in the service-layer transition tables (Section 3), not in the schema.
- Index: `orders_customer_id_idx`, `orders_order_status_idx`, `orders_created_at_idx` (admin list/filter, pagination per 11-security-hardening §11.4).

### `shipments` table

One row per order (1:1), separate from `orders` per §5.21.4's independence requirement: `id uuid pk`, `order_id uuid not null unique references orders(id)`, `shipment_status shipment_status not null default 'NOT_CREATED'`, `courier text null` (data-driven per 04-courier-shipment §4.9 — no enum), `courier_order_id text null` (Parcel/Tracking ID, §4.5), `courier_error text null`, `courier_error_at timestamptz null`, `return_reason text null`, `created_at`, `updated_at`.

### `order_status_history` table (§5.21.11's audit requirement, specialized)

Although the generic `audit_logs` table (spec 03) can hold every transition as a generic `entity_type='order'` row, §5.21.11 explicitly calls out that the record must include "related payment, order, or shipment event" — i.e., which of the three status fields changed. A dedicated, queryable history table is added alongside (not instead of) the generic audit log, since Admin/Manager order-detail UI (05-admin-operations §5.2 "View complete order history") needs a fast, order-scoped, typed timeline rather than parsing generic `jsonb` audit rows:

```sql
CREATE TABLE order_status_history (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  order_id        uuid        NOT NULL,
  status_field    text        NOT NULL CHECK (status_field IN ('order_status','payment_status','shipment_status')),
  previous_status text        NULL,
  new_status      text        NOT NULL,
  reason          text        NULL,
  actor_user_id   uuid        NULL REFERENCES users(id),
  actor_type      actor_type  NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_status_history_pkey PRIMARY KEY (id),
  CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE INDEX order_status_history_order_id_idx ON order_status_history (order_id, created_at DESC);
```

Every transition writes to **both** `order_status_history` (typed, order-scoped) and the generic `audit_logs` (cross-entity audit view, spec 03's `GET /api/admin/audit-logs`) inside the same transaction — same pattern already used for other dual-write audit needs in the codebase (reuse `audit.repository.append`, don't duplicate its logic).

---

## 2. TypeScript Enum Mirrors — `backend/src/types/orderEnums.ts`

New dedicated module (following the `role.ts`/`geography.ts` precedent — a new enum doesn't have to go into the shared `enums.ts`):

```ts
export const ORDER_STATUSES = ['PENDING_CONFIRMATION', 'COD_VERIFICATION_PENDING', 'CONFIRMED', 'PROCESSING', 'DELIVERED', 'CANCELLED', 'RETURNED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export function isOrderStatus(value: unknown): value is OrderStatus { ... }

export const PAYMENT_METHODS = ['BKASH', 'COD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING_VERIFICATION', 'PAID_VERIFIED', 'REJECTED', 'PENDING_COLLECTION', 'PAID_COLLECTED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const SHIPMENT_STATUSES = ['NOT_CREATED', 'CREATING', 'CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CREATION_FAILED', 'DELIVERY_FAILED', 'RETURNED'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
```

Add all four `[tsName, tsArray, pgTypeName]` tuples to the `MIRRORS` array in `backend/tests/shared/enums.parity.test.ts`, or the parity test fails per its "no unmirrored Postgres enum" assertion.

---

## 3. Transition Tables — `backend/src/services/orderStateMachine.ts`

The heart of the spec: a **pure, side-effect-free module** exhaustively encoding every table in §5.21.1/§5.21.2/§5.21.3/§5.21.7/§5.21.8/§5.21.9, so the exact allowed-transition sets are readable in one place and unit-testable without a database.

```ts
type Transition<S extends string> = { from: S; to: S; permission: PermissionKey; trigger: 'ADMIN' | 'SYSTEM' };

// §5.21.1 + §5.21.3 combined per payment_method (COD substitutes
// COD_VERIFICATION_PENDING for PENDING_CONFIRMATION as the initial/first state).
export const ORDER_STATUS_TRANSITIONS: Record<PaymentMethod, Transition<OrderStatus>[]> = {
  BKASH: [
    { from: 'PENDING_CONFIRMATION', to: 'CONFIRMED', permission: 'order.confirm', trigger: 'ADMIN' },
    { from: 'PENDING_CONFIRMATION', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
    { from: 'CONFIRMED', to: 'PROCESSING', permission: 'order.confirm', trigger: 'ADMIN' },
    { from: 'CONFIRMED', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
    { from: 'PROCESSING', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
    { from: 'PROCESSING', to: 'RETURNED', permission: 'order.cancel', trigger: 'SYSTEM' }, // system-primary, admin fallback — see below
    { from: 'PROCESSING', to: 'DELIVERED', permission: 'shipment.track', trigger: 'SYSTEM' },
  ],
  COD: [
    { from: 'COD_VERIFICATION_PENDING', to: 'CONFIRMED', permission: 'order.cod.confirm', trigger: 'ADMIN' },
    { from: 'COD_VERIFICATION_PENDING', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
    { from: 'CONFIRMED', to: 'PROCESSING', permission: 'order.confirm', trigger: 'ADMIN' },
    { from: 'CONFIRMED', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
    { from: 'PROCESSING', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
    { from: 'PROCESSING', to: 'RETURNED', permission: 'order.cancel', trigger: 'SYSTEM' },
    { from: 'PROCESSING', to: 'DELIVERED', permission: 'shipment.track', trigger: 'SYSTEM' },
  ],
};

// §5.21.2 — payment status is independent of order status; no `permission`
// coupling to order transitions.
export const PAYMENT_STATUS_TRANSITIONS: Record<PaymentMethod, Transition<PaymentStatus>[]> = {
  BKASH: [
    { from: 'PENDING_VERIFICATION', to: 'PAID_VERIFIED', permission: 'payment.verify', trigger: 'ADMIN' },
    { from: 'PENDING_VERIFICATION', to: 'REJECTED', permission: 'payment.reject', trigger: 'ADMIN' },
    { from: 'REJECTED', to: 'PENDING_VERIFICATION', permission: 'payment.review', trigger: 'ADMIN' }, // customer resubmission, admin/system-recorded
  ],
  COD: [
    { from: 'PENDING_COLLECTION', to: 'PAID_COLLECTED', permission: 'payment.verify', trigger: 'ADMIN' },
    // §5.21.3 resolution path: DELIVERED order + PENDING_COLLECTION payment -> REJECTED (manual write-off)
    { from: 'PENDING_COLLECTION', to: 'REJECTED', permission: 'payment.reject', trigger: 'ADMIN' },
  ],
};

// §5.21.4/§5.21.5/§5.21.6/§5.21.8 shipment lifecycle — one flat list, no
// payment-method branching (shipment lifecycle is identical for bKash/COD).
export const SHIPMENT_STATUS_TRANSITIONS: Transition<ShipmentStatus>[] = [
  { from: 'NOT_CREATED', to: 'CREATING', permission: 'shipment.create', trigger: 'ADMIN' },
  { from: 'CREATING', to: 'CREATED', permission: 'shipment.create', trigger: 'SYSTEM' },
  { from: 'CREATING', to: 'CREATION_FAILED', permission: 'shipment.create', trigger: 'SYSTEM' },
  { from: 'CREATION_FAILED', to: 'CREATING', permission: 'shipment.retry', trigger: 'ADMIN' }, // retry or change-courier, same target state
  { from: 'CREATED', to: 'SHIPPED', permission: 'shipment.create', trigger: 'ADMIN' },
  { from: 'SHIPPED', to: 'IN_TRANSIT', permission: 'shipment.track', trigger: 'SYSTEM' },
  { from: 'IN_TRANSIT', to: 'OUT_FOR_DELIVERY', permission: 'shipment.track', trigger: 'SYSTEM' },
  { from: 'OUT_FOR_DELIVERY', to: 'DELIVERED', permission: 'shipment.track', trigger: 'SYSTEM' },
  { from: 'OUT_FOR_DELIVERY', to: 'DELIVERY_FAILED', permission: 'shipment.track', trigger: 'SYSTEM' },
  { from: 'DELIVERY_FAILED', to: 'IN_TRANSIT', permission: 'shipment.retry', trigger: 'ADMIN' },
  { from: 'DELIVERY_FAILED', to: 'RETURNED', permission: 'shipment.track', trigger: 'SYSTEM' },
];

export function isValidOrderTransition(method: PaymentMethod, from: OrderStatus, to: OrderStatus): Transition<OrderStatus> | undefined { ... }
export function isValidPaymentTransition(method: PaymentMethod, from: PaymentStatus, to: PaymentStatus): Transition<PaymentStatus> | undefined { ... }
export function isValidShipmentTransition(from: ShipmentStatus, to: ShipmentStatus): Transition<ShipmentStatus> | undefined { ... }

export function initialOrderStatus(method: PaymentMethod): OrderStatus { return method === 'COD' ? 'COD_VERIFICATION_PENDING' : 'PENDING_CONFIRMATION'; }
export function initialPaymentStatus(method: PaymentMethod): PaymentStatus { return method === 'COD' ? 'PENDING_COLLECTION' : 'PENDING_VERIFICATION'; }
```

**Note on `PROCESSING → RETURNED`/`DELIVERED` (§5.21.9):** these two order transitions are documented as system-triggered (via the shipment cascade in Section 4 below) with Admin/Manager able to trigger `RETURNED` manually "as a fallback for a documented return outcome not reflected by courier sync." The service layer (Section 5) exposes both paths, but both still go through `isValidOrderTransition` — the `trigger` field is metadata for the audit record (`actorType`), not a separate code path that bypasses transition validation.

An invalid transition anywhere returns `undefined`; the calling service throws a `TransitionError` (409/422 — see Section 6) rather than allowing an unlisted `from → to` pair. This directly implements §5.21.10's requirement that the backend reject `PENDING_CONFIRMATION → PROCESSING`, `PENDING_CONFIRMATION → DELIVERED`, `DELIVERED → CANCELLED`, etc. simply because no such tuple exists in the tables above — no separate blocklist needed.

---

## 4. Atomic Cascade Rules (§5.21.4, §5.21.6)

Two cascades must be atomic (same transaction, same commit-or-rollback):

1. **Shipment `OUT_FOR_DELIVERY → DELIVERED`** ⟹ **Order `PROCESSING → DELIVERED`** (§5.21.4).
2. **Shipment `DELIVERY_FAILED → RETURNED`** ⟹ **Order `PROCESSING → RETURNED`** (§5.21.6).

These live in `backend/src/services/shipmentStatus.service.ts`: `updateShipmentStatus(orderId, newShipmentStatus, actor)` calls `withTransaction` and, inside the same `client`:
1. Validates the shipment transition via `isValidShipmentTransition`.
2. Updates the `shipments` row.
3. Writes `order_status_history` (`status_field: 'shipment_status'`) + `audit_logs` entry.
4. If `newShipmentStatus` is `DELIVERED` or `RETURNED`, also validates and applies the corresponding order-status cascade (`PROCESSING → DELIVERED`/`RETURNED`) via the same order-status update function (Section 5), passing the transaction client through — never opening a second transaction. If the order is not currently `PROCESSING` when the cascade fires (a logically-impossible state per the spec, but defensively checked), the whole transaction rolls back rather than leaving shipment `DELIVERED` with order stuck at an earlier state.

This satisfies §5.21.6's explicit requirement: "the system can never be left with the shipment already RETURNED while the order still shows PROCESSING."

---

## 5. Repository / Service / Controller / Routes Layers

Mirror the catalogue module's four-file layering exactly (`repositories/*.repository.ts` → `services/*.service.ts` → `controllers/*.controller.ts` → `routes/admin/*.routes.ts`, mounted in `routes/admin/index.ts`).

### `backend/src/repositories/orders.repository.ts`
Raw SQL only, every write function takes an explicit `pg.PoolClient` (like `inventory.repository.ts`, never its own transaction) plus read functions using `run(db, ...)` (like `audit.repository.ts`) for standalone reads: `createOrder`, `getOrderById` (with `FOR UPDATE` variant for transition-time row locking — required so two concurrent transition requests on the same order can't race), `updateOrderStatus`, `updatePaymentStatus`, `listOrders` (paginated, filterable by `order_status`/`payment_method`/date range per 05-admin-operations §5.2 and 11-security-hardening §11.4's mandatory-pagination rule).

### `backend/src/repositories/shipments.repository.ts`
`createShipmentRow` (called once at order creation, status `NOT_CREATED`), `getShipmentByOrderId` (`FOR UPDATE` variant), `updateShipmentStatus`.

### `backend/src/services/orderStatus.service.ts`
`confirmOrder(orderId, actor)`, `cancelOrder(orderId, actor, reason)`, `startProcessing(orderId, actor)`, each: `withTransaction` → lock the order row (`FOR UPDATE`) → `isValidOrderTransition` → on `CONFIRMED` transition, call `inventory.repository.conditionalDecrement` per order line item (reusing the existing primitive — reject with an oversell error, per 05-admin-operations §5.1's atomic check-and-decrement rule, if any line item lacks stock) → on transition into `CANCELLED`/`RETURNED` **from any state at/after `CONFIRMED`**, call `inventory.repository.unconditionalIncrement` per line item (the uniform stock-restoration rule) → write `order_status_history` + `audit_logs` (same transaction) → commit.

### `backend/src/services/paymentStatus.service.ts`
`verifyPayment(orderId, actor)`, `rejectPayment(orderId, actor, reason)`, `resubmitPayment(orderId, newTransactionId/screenshot)` — validates via `isValidPaymentTransition`, writes history+audit, same transaction pattern. Enforces §5.21.2's requirement to store rejection reason/timestamp/rejecting user and keep the previous rejected submission available (a `payment_submissions` history sub-table, or reuse `order_status_history` with `status_field: 'payment_status'` plus a `payment_submission_id` FK if screenshot/Transaction-ID storage is in scope — flagged as a design decision to confirm against the payment-screenshot upload mechanism, likely built alongside Section 3's bKash flow, not duplicated here).

### `backend/src/services/shipmentStatus.service.ts`
As described in Section 4 — includes the atomic cascade logic.

### Controllers — `backend/src/controllers/orders.controller.ts`, `shipments.controller.ts`
Thin: parse validated body/params, call the service, map result/errors to HTTP responses. One controller function per endpoint (matching `products.controller.ts`'s one-function-per-route style), no branching business logic in the controller layer.

### Routes — `backend/src/routes/admin/orders.routes.ts`

```
GET    /orders                         order.view
GET    /orders/:id                     order.view
POST   /orders/:id/confirm             order.confirm       (branches bKash 'order.confirm' vs COD 'order.cod.confirm' inside the service, since both share one route but different permission per §5.21.9 — OR split into two routes; see open question below)
POST   /orders/:id/cancel              order.cancel
POST   /orders/:id/processing          order.confirm
POST   /orders/:id/payments/verify     payment.verify
POST   /orders/:id/payments/reject     payment.reject
POST   /orders/:id/payments/resubmit   payment.review
GET    /orders/:id/history             order.view
```

`backend/src/routes/admin/shipments.routes.ts`:
```
POST   /shipments/:orderId/create      shipment.create
POST   /shipments/:orderId/retry       shipment.retry
POST   /shipments/:orderId/status      shipment.track      (System/courier-sync path — see Section 7 on auth for this one)
```

Every route uses `validate({ params, body })` with new Zod schemas in `backend/src/validation/orders.validation.ts`, matching `catalogue.validation.ts`'s pattern. `requireAuth('admin')`, the general rate-limit ceiling, and `requirePasswordChanged` continue to be applied once at the `admin/index.ts` router level, consistent with `catalogue.routes.ts`'s stated convention — each route here adds only its `requirePermission(...)` gate.

**Open question to resolve before/at implementation time:** whether bKash's `PENDING_CONFIRMATION → CONFIRMED` and COD's `COD_VERIFICATION_PENDING → CONFIRMED` share one `POST /orders/:id/confirm` endpoint (service picks the permission based on the order's stored `payment_method`) or are two distinct routes/permissions checked at the router level. Recommend one endpoint with the permission check performed inside the service after loading the order (simpler routing, and the transition table already encodes the right permission per method) — flag this choice for a quick confirm during implementation, not a blocking decision for this plan.

---

## 6. Error Handling

New domain error `TransitionError` (extends the existing domain-error base used by `pgErrors.ts`/`toDomainError`) mapped to HTTP 409 Conflict (state-conflict semantics fit better than 422 for "valid request shape, invalid state transition"). An oversell-on-confirm error reuses whatever existing "insufficient stock" error shape 05-admin-operations' inventory service already defines (check `inventory.service.ts` at implementation time rather than inventing a second shape).

---

## 7. System-Triggered Transitions (courier sync)

Per §5.21.9, several shipment transitions (`SHIPPED → IN_TRANSIT`, `IN_TRANSIT → OUT_FOR_DELIVERY`, `OUT_FOR_DELIVERY → DELIVERED`/`DELIVERY_FAILED`, `DELIVERY_FAILED → RETURNED`) are "System / courier status synchronization," not Admin/Manager actions. This plan defines the **service function signature** (`updateShipmentStatus(orderId, newStatus, actor: { type: 'SYSTEM' } | { type: 'USER', userId })`) so it is callable identically from an authenticated Admin/Manager route (manual override/testing) or from a future courier-webhook/polling handler (Section 4 of the spec, out of scope here) — but this plan does not build the webhook/polling handler itself, since that belongs to the courier-integration spec. The `POST /shipments/:orderId/status` route above is the authenticated stand-in Admin/Manager endpoint for manually recording a courier-reported status until the real sync job exists; it must still call the exact same validated `updateShipmentStatus` function so there is only one code path for this logic, matching 04-courier-shipment §4.6's idempotency requirement ("applying the same courier status update twice... must not corrupt the stored status").

---

## 8. Tests — `backend/tests/spec-07-order-state-machine/`

Per `TEST_ORGANIZATION.md`'s documented process:

1. Create `backend/tests/spec-07-order-state-machine/` with files such as:
   - `orderStateMachine.unit.test.ts` — pure unit tests against Section 3's transition tables: every valid transition in §5.21.1/§5.21.2/§5.21.3/§5.21.8 succeeds; every invalid example explicitly listed in §5.21.10 (`PENDING_CONFIRMATION → DELIVERED`, `→ PROCESSING`, `→ SHIPPED`; `COD_VERIFICATION_PENDING → SHIPPED`; `CONFIRMED → DELIVERED`; `PROCESSING → OUT_FOR_DELIVERY`; `DELIVERED → CANCELLED`) is rejected.
   - `orderStatus.api.test.ts` — confirm/cancel/processing endpoints against a real Postgres schema: permission enforcement (Admin/Manager per §5.21.9's table), stock decrement-on-confirm (including the oversell-rejection case), stock restoration-on-cancel from every state at/after `CONFIRMED`.
   - `paymentStatus.api.test.ts` — bKash verify/reject/resubmit cycle; COD collect/reject cycle; §5.21.2's "rejection must not auto-cancel the order" rule; §5.21.3's "DELIVERED + PENDING_COLLECTION" and "DELIVERED + REJECTED" coexistence as valid, non-corrupted states.
   - `shipmentStatus.api.test.ts` — full shipment lifecycle; creation-failure retry/change-courier path; delivery-failure retry/returned path; the concurrent-creation-guard behavior described in 04-courier-shipment §4.11 if in scope (flag if deferred to the courier spec).
   - `atomicCascade.test.ts` — the two atomic cascades (Section 4 above): verify via a deliberately-injected failure (e.g. mock the order-status update to throw mid-transaction) that the shipment status update also rolls back — i.e. prove the "never left with shipment RETURNED while order shows PROCESSING" guarantee holds under failure, not just the happy path.
   - `auditTrail.test.ts` — every transition produces both an `order_status_history` row and an `audit_logs` row with previous/new status, actor, timestamp, reason (where applicable).
2. Add `backend/config/vitest/spec07/vitest.config.ts`, mirroring `spec06`'s shape (explicit `include` list, `root` via `fileURLToPath`, shared `setupFiles`, timeouts).
3. Add `"test:spec07": "vitest run --config config/vitest/spec07/vitest.config.ts"` to `backend/package.json`.
4. Update `backend/tests/TEST_ORGANIZATION.md` with the new section.
5. Add the four new enum mirrors to `backend/tests/shared/enums.parity.test.ts`'s `MIRRORS` array (this is a `shared/` test, not a spec-07 one, since it's cross-cutting).

---

## Verification

1. `npm run test:spec07` — full spec-07 suite green, including the transition-table unit tests covering every §5.21.10 invalid example and every §5.21.1/.2/.3/.8 valid example.
2. `npm run test:shared` (or the enums-parity test directly) — confirms the four new Postgres enums are mirrored and the "no unmirrored enum" assertion still passes.
3. Manual/integration check: place a bKash order → verify payment → confirm → start processing → create shipment → simulate courier sync through to `DELIVERED`, asserting the order-status cascade fires atomically and `order_status_history` shows the full chain; repeat for COD confirming stock decrement only happens once, at `CONFIRMED`.
4. Attempt each §5.21.10 invalid transition via the HTTP endpoints (not just the unit-level table) to confirm the service layer's `TransitionError` reaches the API as a 409, and that a Manager without `order.cancel` assigned gets a 403 from `requirePermission` before transition logic even runs.
5. Run the full backend test suite (`npm test` / all spec configs) to confirm no regression in specs 01–06.
