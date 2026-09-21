# 12 — The Order / Payment / Shipment State Machine Service

## Goal

After this slice there is exactly one mechanism in the codebase by which any order, payment, or shipment status changes: a transition service that validates every requested change against the tables in `07-order-state-machine.md` §5.21, checks the actor's RBAC permission for that specific transition, applies the mandated side effects (stock decrement at `CONFIRMED`, stock restoration on `CANCELLED`/`RETURNED`, the `DELIVERED` and `RETURNED` order cascades) atomically with the status write, and records the full audit trail §5.21.11 requires. No other code may write a status column. This slice builds and tests the engine in isolation; specs 13, 14, and 15 call it rather than reimplementing any part of it.

## Requirement references

`07-order-state-machine.md` is authoritative for everything in this slice. Where any other PRD's narrative diagram disagrees, this file wins (`01-overview.md` §112 note; CLAUDE.md §1).

- §5.21 — the seven order statuses; payment and shipment status maintained separately and never treated as replacements for order status; identical rules for guest and registered orders.
- §5.21.1 — the bKash order transition table (7 rows).
- §5.21.2 — payment rejection creates no new order status; the order stays `PENDING_CONFIRMATION`; payment moves `PENDING_VERIFICATION → REJECTED → PENDING_VERIFICATION → PAID_VERIFIED`; the system stores rejection reason, timestamp, rejecting user, previous submission, and new submission; previous submissions remain in history; rejection must not auto-cancel the order.
- §5.21.3 — the COD order transition table (6 rows); COD needs no payment verification before `CONFIRMED`; the delivered-but-uncollected discrepancy is a **computed UI condition, not a stored field**; manual resolution to `PAID_COLLECTED` or, when collection never happens, to `REJECTED` with `DELIVERED` retained.
- §5.21.4 — the shipment lifecycle; the order status does **not** become `SHIPPED`/`IN_TRANSIT`/`OUT_FOR_DELIVERY`; the order stays `PROCESSING` throughout; shipment `DELIVERED` cascades the order to `DELIVERED`.
- §5.21.5 — shipment creation failure: `CREATING → CREATION_FAILED`, order stays `PROCESSING`, store the courier error/timestamp/courier used, allow retry and courier change, and **never** auto-reject a verified payment or auto-cancel a confirmed order.
- §5.21.6 — delivery failure: `OUT_FOR_DELIVERY → DELIVERY_FAILED`, order stays `PROCESSING`; retry returns to `IN_TRANSIT`; `DELIVERY_FAILED → RETURNED` cascades the order to `RETURNED`; **both cascades are single atomic operations**.
- §5.21.7 — allowed cancellation transitions; `DELIVERED → CANCELLED` is not allowed; no `DELIVERED → RETURNED` in v1; if a shipment is `CREATED` or later, the courier's Cancel Shipment must be called, and a courier that cannot cancel blocks or escalates the cancellation; every cancellation records reason, timestamp, user, previous and current status.
- §5.21.8 — the complete transition rules for bKash, COD, and shipment.
- §5.21.9 — the transition-authorization table (actor/trigger per transition).
- §5.21.10 — the backend must reject invalid transitions; the listed invalid examples; a frontend user must not bypass by calling the API directly.
- §5.21.11 — three independent status fields, never overwriting one with another; all status changes recorded with previous status, new status, timestamp, triggering user or system process, reason, and related event.
- `05-admin-operations.md` §5.1 — stock decrements at `CONFIRMED`; the uniform restoration rule for any entry into `CANCELLED`/`RETURNED` from at or after `CONFIRMED`; atomic check-and-decrement with failure and notification on insufficient stock.
- `10-coupon-discount.md` §8.27 — coupon usage is **not** restored on cancellation or return; the asymmetry with stock is deliberate.
- `08-analytics-meta.md` §6.3 — the transition handler that moves an order to `CONFIRMED` is the single place responsible for triggering `Purchase`, exactly once, only on the write that sets `orderStatus = CONFIRMED`; §6.8 — a Meta failure must never block or roll back the underlying action.
- `04-courier-shipment.md` §4.6 — courier status sync must be idempotent: a repeated or out-of-order update must not corrupt state or duplicate history.
- `06-rbac.md` §5.16, §5.18 — the permission keys each transition requires.
- Skills: `backend` §3 (highest priority), `test` §1 (highest priority), `security` §4, `database` §2–3.

## Depends on

- **01** — errors (`InvalidTransitionError` → 409), validation.
- **02** — `audit_logs`, `withTransaction`.
- **03** — `requirePermission`, actor resolution.
- **05** — `decrementStock()` / `restoreStock()`.
- **10** — nothing is called; §8.27's rule is honoured by *not* touching coupons.
- **11** — `orders`, `payments`, `payment_submissions`, `shipments`, `order_status_history`, and the initial statuses.

## Scope

**In scope**

- The three transition tables as data (order, payment, shipment), each entry carrying its allowed actors, required permission, and preconditions.
- `transitionOrderStatus()`, `transitionPaymentStatus()`, `transitionShipmentStatus()` — the only writers of those columns.
- Side effects: stock decrement at `CONFIRMED`, uniform stock restoration, the `DELIVERED` and `RETURNED` cascades, the `Purchase` trigger hook.
- The computed COD collection-discrepancy flag.
- Idempotent application of repeated or stale shipment updates.
- History and audit writes for every transition.
- A database-level guard preventing status writes outside the service.

**Out of scope / deferred**

- The admin endpoints that invoke transitions (verify, reject, confirm, cancel) — spec **13**.
- Courier API calls, including Cancel Shipment — spec **14**. This slice defines the `CourierCancellationPort` interface the cancellation rule depends on and fails closed when no implementation is registered.
- Courier status-sync ingestion — spec **15**, which calls `transitionShipmentStatus()` with `actorType: 'SYSTEM'`.
- Sending the `Purchase` event — spec **18**; this slice emits the domain event.
- Any frontend. This slice has none.

## Database changes

Migration file: `backend/migrations/0012_transition_guards.sql`

No new tables. Three additions that make "one mechanism" structurally true rather than a convention:

### Status-write guard

A trigger on `orders` rejecting any `UPDATE` that changes `order_status`, `payment_status`, or `shipment_status` unless the transaction has set a session-local marker the transition service sets:

```sql
CREATE FUNCTION assert_status_write_allowed() RETURNS trigger AS $$
BEGIN
  IF (NEW.order_status, NEW.payment_status, NEW.shipment_status)
     IS DISTINCT FROM (OLD.order_status, OLD.payment_status, OLD.shipment_status)
     AND current_setting('app.transition_ctx', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'status columns may only be written by the transition service';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

This directly implements the `database` skill §3's "don't rely on application code discipline alone to prevent a direct status write bypassing the transition validation" and the `security` skill §4's "a direct field write to order/payment/shipment status bypassing validation is both an architecture and a security violation." A future developer who writes `UPDATE orders SET order_status = …` outside the service gets an immediate, loud failure.

### `shipment_sync_events` — idempotency for courier updates (§4.6)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `shipment_id` | `uuid` | NOT NULL | FK → `shipments(id)` ON DELETE CASCADE |
| `provider_event_id` | `text` | NULL | The courier's own event identifier, when it supplies one |
| `normalized_status` | `shipment_status` | NOT NULL | After adapter normalization (§4.9) |
| `event_occurred_at` | `timestamptz` | NULL | The courier's timestamp |
| `applied` | `boolean` | NOT NULL | False when skipped as duplicate or stale |
| `skip_reason` | `text` | NULL | `DUPLICATE` \| `STALE` \| `INVALID_TRANSITION` |
| `payload_digest` | `text` | NOT NULL | SHA-256 of the normalized payload |
| `received_at` | `timestamptz` | NOT NULL | `now()` |

- `UNIQUE (shipment_id, provider_event_id)` partial `WHERE provider_event_id IS NOT NULL`.
- `UNIQUE (shipment_id, payload_digest)` — the fallback duplicate guard when the courier supplies no event id.

### `shipments` additions (§5.21.5)

`status_sequence integer NOT NULL DEFAULT 0`, `last_error text`, `last_error_at timestamptz`, `last_error_courier text`.

`status_sequence` is the monotonic ordinal of the shipment lifecycle (`NOT_CREATED 0 → CREATING 1 → CREATED 2 → SHIPPED 3 → IN_TRANSIT 4 → OUT_FOR_DELIVERY 5 → DELIVERED 6`), used to detect and discard out-of-order courier updates (§4.6). Failure states carry the sequence of the state they failed from.

## Backend work

### The transition tables as data

`services/stateMachine/transitions.ts` — three exported constant tables. Each entry is a direct transcription of §5.21's tables; nothing is inferred or extended.

**Order transitions.** The union of §5.21.1 (bKash) and §5.21.3 (COD), each tagged with the payment method it applies to, so the engine enforces method-specific paths rather than a merged superset:

| From | To | Methods | Permission | Precondition |
| --- | --- | --- | --- | --- |
| `PENDING_CONFIRMATION` | `CONFIRMED` | BKASH | `order.confirm` | `payment_status = 'PAID_VERIFIED'` (§5.21.1, §3.10 rule 1) |
| `COD_VERIFICATION_PENDING` | `CONFIRMED` | COD | `order.confirm` | none (§5.21.3: COD needs no payment verification) |
| `CONFIRMED` | `PROCESSING` | both | `order.update` | — |
| `PROCESSING` | `DELIVERED` | both | *system only* | shipment is `DELIVERED` |
| `PROCESSING` | `RETURNED` | both | *system*, or `order.update` manually | shipment `RETURNED`, or a documented manual return |
| `PENDING_CONFIRMATION` | `CANCELLED` | BKASH | `order.cancel` | — |
| `COD_VERIFICATION_PENDING` | `CANCELLED` | COD | `order.cancel` | — |
| `CONFIRMED` | `CANCELLED` | both | `order.cancel` | courier cancellation rule (§5.21.7) |
| `PROCESSING` | `CANCELLED` | both | `order.cancel` | courier cancellation rule (§5.21.7) |

Every pair not in this table is invalid. §5.21.10's named examples — `PENDING_CONFIRMATION → DELIVERED`, `PENDING_CONFIRMATION → PROCESSING`, `CONFIRMED → DELIVERED`, `DELIVERED → CANCELLED` — are absent by construction rather than blocked by special cases. `PENDING_CONFIRMATION → SHIPPED` and `PROCESSING → OUT_FOR_DELIVERY` are impossible because those values are not in the order-status enum at all (spec 11).

Note that §5.21.1's table gives bKash `CONFIRMED → CANCELLED` and `PROCESSING → CANCELLED`, and §5.21.3's COD table gives `PROCESSING → CANCELLED` but omits `CONFIRMED → CANCELLED`; §5.21.7 then states `CONFIRMED → CANCELLED` generally, and §5.21.8's COD diagram shows it. The table above follows §5.21.7/§5.21.8 and allows it for COD — see Open questions 1.

**Payment transitions** (§5.21.2, §5.21.3):

| From | To | Methods | Permission | Notes |
| --- | --- | --- | --- | --- |
| `PENDING_VERIFICATION` | `PAID_VERIFIED` | BKASH | `payment.verify` | |
| `PENDING_VERIFICATION` | `REJECTED` | BKASH | `payment.reject` | Requires a reason (§5.21.2) |
| `REJECTED` | `PENDING_VERIFICATION` | BKASH | *customer* | On resubmission (spec 11) |
| `PENDING_COLLECTION` | `PAID_COLLECTED` | COD | `order.update` or system | Courier sync or manual (§4.4) |
| `PENDING_COLLECTION` | `REJECTED` | COD | `order.update` | Manual close-out of a failed collection (§5.21.3) |

**Shipment transitions** (§5.21.4, §5.21.5, §5.21.6, §5.21.8):

| From | To | Actor | Permission |
| --- | --- | --- | --- |
| `NOT_CREATED` | `CREATING` | Admin/Manager | `shipment.create` |
| `CREATING` | `CREATED` | system | — |
| `CREATING` | `CREATION_FAILED` | system | — |
| `CREATION_FAILED` | `CREATING` | Admin/Manager | `shipment.retry` or `shipment.courier.change` |
| `CREATED` | `SHIPPED` | Admin/Manager | `shipment.create` (parcel handover) |
| `SHIPPED` | `IN_TRANSIT` | system | — |
| `IN_TRANSIT` | `OUT_FOR_DELIVERY` | system | — |
| `OUT_FOR_DELIVERY` | `DELIVERED` | system | — |
| `OUT_FOR_DELIVERY` | `DELIVERY_FAILED` | system | — |
| `DELIVERY_FAILED` | `IN_TRANSIT` | Admin/Manager or courier update | `shipment.retry` |
| `DELIVERY_FAILED` | `RETURNED` | system | — |

### The transition engine

```ts
type TransitionContext = {
  actor: { userId: string; permissions: PermissionKey[] } | null;  // null = SYSTEM
  actorType: 'USER' | 'SYSTEM' | 'CUSTOMER';
  reason?: string;
  relatedEvent?: Record<string, unknown>;
  requestId?: string;
};

transitionOrderStatus(tx, orderId, to: OrderStatus, ctx): Promise<Order>;
transitionPaymentStatus(tx, orderId, to: PaymentStatus, ctx): Promise<Order>;
transitionShipmentStatus(tx, orderId, to: ShipmentStatus, ctx): Promise<Order>;
```

Each follows the identical sequence:

1. `SELECT … FOR UPDATE` on the order row — the row lock serializes concurrent transition attempts, so two simultaneous confirmations cannot both pass validation.
2. Look up `(from, to)` in the table for the order's payment method. Missing → `InvalidTransitionError` (409) naming both statuses; **nothing is written** (§5.21.10).
3. Evaluate preconditions (e.g. bKash `CONFIRMED` requires `PAID_VERIFIED`). Failure → `InvalidTransitionError` with the unmet condition.
4. Authorize (§5.21.9): a `USER` actor must hold the entry's permission; a `SYSTEM`-only entry rejects a user actor and vice versa, so a human cannot forge a courier-driven transition and a sync job cannot perform a human-only one.
5. Require a reason where the table demands one (rejection §5.21.2, cancellation §5.21.7).
6. Set `app.transition_ctx = 'on'`, write the **single** status column, clear the marker.
7. Run side effects (below) in the same transaction.
8. Append one `order_status_history` row (previous, new, kind, actor, reason, related event) and one `audit_logs` row (§5.21.11, §5.15 rule 10).

**Only one status column is written per call.** §5.21.11's "must not overwrite one status field with another" is enforced by the function signature — there is no call that writes two kinds at once. The cascades below are implemented as an explicit second call within the same transaction, not as an implicit dual write, so both appear in history.

### Side effects

**Stock decrement at `CONFIRMED` (§5.1).** On any transition into `CONFIRMED`, call `decrementStock()` with the order's line items. On `ok: false`, **abort the transaction** with `409 INSUFFICIENT_STOCK` listing each short variant — §5.1: "the confirmation must fail and the Admin/Manager must be notified instead of confirming an oversold order." The order remains in its prior status.

**Stock restoration (§5.1).** On any transition into `CANCELLED` or `RETURNED`, restore stock **if and only if** the order has ever reached `CONFIRMED`. That is determined by querying `order_status_history` for a prior `CONFIRMED` row — a single uniform rule applied in the transition handler, exactly as §5.1 requires ("not a per-transition special case"). Cancelling from `PENDING_CONFIRMATION` or `COD_VERIFICATION_PENDING` restores nothing, because nothing was taken.

**Coupon usage is never restored** (§8.27). No coupon code runs in any cancellation or return path. This asymmetry with stock is deliberate and documented; a future "symmetry" refactor would be a spec violation, so a test asserts the counter is unchanged.

**The `DELIVERED` cascade (§5.21.4).** When the shipment reaches `DELIVERED` and the order is `PROCESSING`, immediately call `transitionOrderStatus(tx, orderId, 'DELIVERED', { actorType: 'SYSTEM' })` in the same transaction. §5.21.6 requires the shipment update and the order cascade to be "a single atomic operation… so the system can never be left with the shipment already `RETURNED` while the order still shows `PROCESSING`," and applies the same requirement to `DELIVERED`.

**The `RETURNED` cascade (§5.21.6).** Identical, for shipment `RETURNED` → order `RETURNED`, which also triggers stock restoration in the same transaction.

**Payment status is never touched by a shipment cascade.** A COD order reaching `DELIVERED` leaves `payment_status` at `PENDING_COLLECTION` — §5.21.3 is explicit that "the system must not auto-assume payment was collected just because delivery succeeded."

**No cascade in the failure direction (§5.21.5, §3.5, §4.11).** `CREATION_FAILED` and `DELIVERY_FAILED` change **only** the shipment status. They never touch `payment_status` and never move the order to `CANCELLED`. The order stays `PROCESSING`. Courier errors are recorded in `last_error`/`last_error_at`/`last_error_courier` for the admin panel.

**The `Purchase` hook (§6.3).** On the write that sets `order_status = 'CONFIRMED'` — and only there — emit a domain event `{ type: 'order.confirmed', orderId, totalAmount, … }` **after the transaction commits**. Spec 18 subscribes. Two rules from §6.3 and §6.8 shape this:
- Exactly once, only on the write that actually sets `CONFIRMED` — never on a "payment verified" state that has not also set the order status. Since `PAID_VERIFIED` and `CONFIRMED` are separate transitions here, the hook is attached to the order transition alone, so a combined or a two-step admin action both fire it exactly once.
- Emitted post-commit so a Meta failure "must never block, delay, fail, or roll back the underlying customer action."
- Later `CANCELLED`/`RETURNED` transitions emit **no** reversal event (§6.3's explicit v1 scoping decision).

**Courier cancellation on cancel (§5.21.7).** When an order is cancelled and its shipment is `CREATED` or later, the engine calls the injected `CourierCancellationPort`. Success → proceed. Failure (e.g. already out for delivery) → **abort the cancellation** with `409 COURIER_CANCELLATION_FAILED`, because §5.21.7 requires the cancellation to "be blocked or escalated to Admin/Manager rather than silently leaving the shipment active." With no port registered (spec 14 not yet built), the engine fails closed with `501 COURIER_CANCELLATION_UNAVAILABLE` rather than cancelling an order whose courier shipment would remain live.

### Idempotent courier sync (§4.6)

`applyCourierStatusUpdate(orderId, normalizedStatus, providerEventId?, occurredAt?, payload)`:

1. Insert into `shipment_sync_events`; a unique-constraint hit means **duplicate** → record `applied: false, skip_reason: 'DUPLICATE'` and return without touching status.
2. If `sequenceOf(normalizedStatus) <= shipments.status_sequence` and the status is not a failure state → **stale/out-of-order** → `applied: false, skip_reason: 'STALE'`.
3. If the transition is not in the table from the current status → `applied: false, skip_reason: 'INVALID_TRANSITION'`; log for review, do not error the courier's request.
4. Otherwise apply via `transitionShipmentStatus(actorType: 'SYSTEM')` and update `status_sequence`.

§4.6's requirement that "applying the same courier status update twice, or receiving an older status after a newer one, must not corrupt the stored shipment/order status or duplicate status-history entries" is met on all three counts: duplicates are rejected by a unique constraint, stale updates by the sequence check, and history rows are written only when a transition actually applies.

### The computed COD discrepancy flag (§5.21.3)

```ts
hasCodCollectionDiscrepancy(order) =
  order.paymentMethod === 'COD' &&
  order.orderStatus === 'DELIVERED' &&
  order.paymentStatus === 'PENDING_COLLECTION';
```

Evaluated at display/query time and exposed on the admin order projection. §5.21.3 states plainly: "This flag is a computed UI condition… it is not a stored field on the order." No column stores it, and no query filter writes it.

`DELIVERED` + `REJECTED` is a valid, permanent terminal combination — "delivered, payment not recovered" (§5.21.3) — and the engine never reverts `DELIVERED` in that case.

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Pair not in the table | 409 | `INVALID_TRANSITION` |
| Precondition unmet (e.g. bKash confirm without `PAID_VERIFIED`) | 409 | `TRANSITION_PRECONDITION_FAILED` |
| Actor lacks the permission | 403 | `FORBIDDEN` |
| User attempting a system-only transition (or vice versa) | 403 | `FORBIDDEN` |
| Missing required reason | 400 | `REASON_REQUIRED` |
| Insufficient stock at `CONFIRMED` | 409 | `INSUFFICIENT_STOCK` + shortfalls |
| Courier cancellation failed | 409 | `COURIER_CANCELLATION_FAILED` |
| No courier port registered | 501 | `COURIER_CANCELLATION_UNAVAILABLE` |
| Direct status write outside the service | 500 | database exception (logged as a defect) |

## Frontend work

None. This slice is a service layer. Specs 13–15 build the UI that drives it.

## Security requirements

- **One mechanism, enforced by the database.** The trigger makes a status write outside the transition service impossible, not merely discouraged (`security` §4, `database` §3). This is the primary defence against a customer-reachable path fabricating a paid or confirmed order.
- **Every transition is permission-checked** against §5.21.9 and §5.18, server-side, on every call (§5.21.10: "A frontend user must not be able to bypass these rules by directly sending an API request").
- **Actor-type separation.** System-only transitions reject user actors; user-only transitions reject system actors. A courier-sync path cannot confirm an order, and an admin cannot forge a delivery report.
- **No customer-reachable route calls any transition except the payment resubmission `REJECTED → PENDING_VERIFICATION`** (spec 11), which cannot reach `PAID_VERIFIED`.
- **No cascade crosses status kinds in the failure direction** (§5.21.5, §3.5, §4.11) — a courier failure cannot be used to reject a verified payment or cancel a confirmed order, which would otherwise be an availability-abuse vector.
- **Reasons are mandatory** on rejection and cancellation, so a destructive action always carries an accountable explanation (§5.21.2, §5.21.7).
- **Full audit** on every transition (§5.21.11) with previous status, new status, timestamp, actor, reason, and related event.
- **Meta events are post-commit and failure-isolated** (§6.8) — analytics can never roll back an order.
- **Guest and registered orders are treated identically** (§5.21's opening) — no branch anywhere in the engine reads `account_type`.

## Data integrity / idempotency

- **Row-level locking** (`SELECT … FOR UPDATE`) serializes concurrent transitions on one order, so two simultaneous confirm attempts cannot both decrement stock.
- **Atomic decrement at `CONFIRMED`** (§5.1) — the conditional update from spec 05 inside this transaction; insufficient stock rolls back the confirmation entirely.
- **Uniform restoration** (§5.1) — one rule, one implementation, driven by whether the order ever reached `CONFIRMED`.
- **Atomic cascades** (§5.21.6) — shipment status and the resulting order status commit together; there is no window in which the shipment is `RETURNED` while the order shows `PROCESSING`.
- **Idempotent courier sync** (§4.6) — duplicates blocked by a unique constraint, stale updates by the monotonic sequence, and no duplicate history rows in either case.
- **No coupon reversal** (§8.27) — cancellation and return leave `usage_count` and `coupon_usages` untouched.
- **Exactly one `Purchase` per order** (§6.3) — attached to the single write that sets `CONFIRMED`; because `CONFIRMED` is reachable only once per order (no transition returns to it), the event cannot fire twice.
- **Append-only history** — every applied transition writes exactly one `order_status_history` row; skipped sync events write to `shipment_sync_events` instead, so the order history stays a clean record of real changes.

## Acceptance criteria

1. Every valid transition in §5.21.1, §5.21.3, §5.21.4, §5.21.5, §5.21.6, and §5.21.7 succeeds through the service and results in the documented status.
2. Every invalid example in §5.21.10 is rejected with `409 INVALID_TRANSITION` and leaves all three statuses unchanged: `PENDING_CONFIRMATION → DELIVERED`, `PENDING_CONFIRMATION → PROCESSING`, `CONFIRMED → DELIVERED`, `DELIVERED → CANCELLED`.
3. `PENDING_CONFIRMATION → SHIPPED` and `PROCESSING → OUT_FOR_DELIVERY` are impossible to request — those values are not in `order_status` (verified by `\dT+ order_status`).
4. A bKash order with `payment_status = 'PENDING_VERIFICATION'` cannot reach `CONFIRMED`; setting it to `PAID_VERIFIED` first allows it (§5.21.1, §3.10 rule 1).
5. A COD order reaches `CONFIRMED` from `COD_VERIFICATION_PENDING` with `payment_status` still `PENDING_COLLECTION` (§5.21.3).
6. Rejecting a payment leaves `order_status` at `PENDING_CONFIRMATION` and does not cancel the order (§5.21.2).
7. Rejection without a reason returns `400 REASON_REQUIRED`; with one, the reason, timestamp, and rejecting user are all stored.
8. A reject → resubmit → reject → resubmit → verify sequence leaves every submission row intact and `order_status` unchanged throughout (§5.21.2).
9. `UPDATE orders SET order_status = 'DELIVERED' WHERE id = …` executed directly in psql raises the trigger exception.
10. Confirming an order decrements stock; confirming when a variant is short returns `409 INSUFFICIENT_STOCK` naming it, leaves the order unconfirmed, and leaves stock unchanged (§5.1).
11. Two concurrent confirmations of orders competing for the last unit: one confirms, one fails with `INSUFFICIENT_STOCK`; stock ends at 0.
12. Cancelling a `CONFIRMED` order restores stock; cancelling from `PENDING_CONFIRMATION` restores nothing (§5.1).
13. `PROCESSING → RETURNED` restores stock (§5.1's uniform rule).
14. Cancelling or returning a coupon-bearing order leaves `coupons.usage_count` and the `coupon_usages` row unchanged (§8.27).
15. Shipment `CREATED → SHIPPED → IN_TRANSIT → OUT_FOR_DELIVERY` leaves `order_status` at `PROCESSING` throughout (§5.21.4).
16. Shipment → `DELIVERED` moves the order to `DELIVERED` in the same transaction; a forced failure in the order write leaves the shipment status unchanged too (§5.21.6's atomicity).
17. Shipment `DELIVERY_FAILED → RETURNED` moves the order to `RETURNED` atomically and restores stock.
18. A COD order at `DELIVERED` still has `payment_status = 'PENDING_COLLECTION'`, and `hasCodCollectionDiscrepancy` is true (§5.21.3).
19. No column on `orders` stores that discrepancy (verified by `\d orders`).
20. Manually setting a COD payment to `REJECTED` after delivery leaves `order_status = 'DELIVERED'` (§5.21.3's terminal combination).
21. `CREATING → CREATION_FAILED` leaves `order_status = 'PROCESSING'` and `payment_status = 'PAID_VERIFIED'` unchanged, and stores the courier error, timestamp, and courier (§5.21.5).
22. `OUT_FOR_DELIVERY → DELIVERY_FAILED` leaves the order at `PROCESSING` (§5.21.6).
23. A Manager without `order.cancel` gets 403 on a cancellation; with it, 200 (§5.21.9).
24. A `USER` actor attempting `PROCESSING → DELIVERED` (system-only) gets 403; the same transition as `SYSTEM` succeeds.
25. Applying the same courier update twice applies once, records the second as `DUPLICATE`, and writes one history row (§4.6).
26. Applying `IN_TRANSIT` after `OUT_FOR_DELIVERY` is skipped as `STALE` and does not regress the status (§4.6).
27. Cancelling an order whose shipment is `CREATED` with no courier port registered returns `501` and does not cancel (§5.21.7).
28. With a port that reports failure, cancellation returns `409 COURIER_CANCELLATION_FAILED` and the order stays as it was (§5.21.7).
29. Every successful transition writes exactly one `order_status_history` row with previous, new, timestamp, actor, and reason (§5.21.11).
30. The `order.confirmed` event fires exactly once per order, only on the `CONFIRMED` write, and is emitted after commit; a subscriber that throws does not roll back the order (§6.3, §6.8).
31. No transition path fires `order.confirmed` on a `PAID_VERIFIED` write alone (§6.3).
32. Guest and registered orders behave identically across every transition (§5.21).

## Tests required

Per the `test` skill §1, which names this "the single most load-bearing piece of business logic in the system" and requires integration tests against the real service and a real database — never mocks. Test against §5.21 only; where a narrative diagram in §3 or §4 disagrees, §5.21 wins.

1. **Every valid transition edge** — one test per row of §5.21.1, §5.21.3, §5.21.4, §5.21.5, §5.21.6, §5.21.7, asserting the resulting status **and** that it was written through the transition mechanism. One test per edge, not one parameterized smoke test, so a failure names the broken edge.
2. **Every explicitly invalid transition** (§5.21.10) — one test each, asserting rejection with a clear error and all three statuses unchanged.
3. **Status independence** (§5.21.11) — change one status and assert the other two are untouched. Run for all three kinds. The `test` skill calls this "the rule most likely to be silently violated by a future refactor."
4. **bKash rejection/resubmission loop** (§5.21.2) — repeated cycles, not one round trip; order status constant; all submissions retained; rejection metadata stored.
5. **Shipment creation failure does not cascade** (§5.21.5, §3.5, §4.11) — assert a verified payment is not rejected and a confirmed order is not cancelled. The `test` skill names this anti-pattern explicitly and asks for a regression test.
6. **Delivery failure / retry / return-to-store** (§5.21.6) — the full path, including the atomic `RETURNED` cascade.
7. **Idempotent courier sync** (§4.6) — the same update twice, and an older status after a newer one; state uncorrupted, history not duplicated.
8. **Stock decrement at `CONFIRMED` and restore on cancel** (§5.1) — both directions, plus cancellation after the shipment exists, plus the insufficient-stock confirmation failure, plus the concurrency case.
9. **Stock restoration is uniform** — restoration happens for `CANCELLED` and `RETURNED` from `CONFIRMED` and from `PROCESSING`, and does **not** happen from pre-`CONFIRMED` states.
10. **Coupon usage is not restored** (§8.27) — cancel and return a coupon order; counter and usage row unchanged.
11. **Audit trail** (§5.21.11, §5.15 rule 10) — every transition test also asserts a history row with previous status, new status, timestamp, and actor.
12. **Transition authorization** (§5.21.9) — a caller without the matching permission is rejected even when the transition is structurally valid; paired with the RBAC tests rather than duplicating permission logic.
13. **Actor-type enforcement** — a user cannot perform a system-only transition, and a system actor cannot perform a user-only one.
14. **Direct write guard** — a raw SQL status update is rejected by the trigger.
15. **`Purchase` fires exactly once on `CONFIRMED`** (§6.3) — not on payment verification, not at placement, not again on a later transition; no reversal event on cancel/return.
16. **Post-commit isolation** (§6.8) — a throwing subscriber does not roll back or delay the transition.
17. **Courier cancellation rule** (§5.21.7) — cancellation blocked when the courier cannot cancel; allowed when it can; fails closed with no port.
18. **COD discrepancy is computed** (§5.21.3) — the flag is true for the `DELIVERED` + `PENDING_COLLECTION` pair, and no column stores it; manual resolution to `PAID_COLLECTED` and to `REJECTED` both work with `DELIVERED` retained.
19. **Guest/registered parity** (§5.21) — a representative transition suite run against both order types produces identical results.

## Open questions / assumptions

1. **COD `CONFIRMED → CANCELLED`.** §5.21.3's COD table omits it while listing `PROCESSING → CANCELLED`; §5.21.7 states `CONFIRMED → CANCELLED` generally ("Where business rules allow cancellation after confirmation"), and §5.21.8's COD diagram shows `CONFIRMED ──→ CANCELLED`. **This is a genuine internal inconsistency within the authoritative file.** *Assumption:* allow it for COD, following §5.21.7 and §5.21.8 over §5.21.3's table, since two of three passages include it and disallowing it would leave a confirmed COD order uncancellable until it reached `PROCESSING`. Flagged for confirmation.
2. **`CONFIRMED → PROCESSING` permission.** §5.21.9 lists the actor as "Admin / Manager" without naming a permission key, and §5.18 has no "Order Processing" row. *Assumption:* `order.update` (Assigned for Manager). Using `order.confirm` would conflate two distinct actions; inventing a key is barred by §5.16.
3. **Who triggers `CONFIRMED → PROCESSING`.** §5.21.1 gives the trigger as "Order preparation begins" without saying whether it is explicit or automatic. *Assumption:* an explicit Admin/Manager action in spec 13, with spec 14's shipment creation also advancing it if still `CONFIRMED` — since §4.3/§4.10 both describe shipment creation as following confirmation and §5.21.4 assumes the order is `PROCESSING` while the shipment moves.
4. **Manual `PROCESSING → RETURNED`.** §5.21.9 says the transition is "primarily system-triggered… Admin/Manager may also trigger it manually for a documented return outcome not reflected by courier sync," without naming a permission. *Assumption:* `order.update` plus a mandatory reason.
5. **Payment resubmission actor.** §5.21.2 describes the customer resubmitting, and §5.18 has no customer-facing permission row. *Assumption:* `actorType: 'CUSTOMER'` for `REJECTED → PENDING_VERIFICATION`, authorized by order ownership (Order Number + phone, spec 11) rather than by RBAC — consistent with §5.19's rule that customer-facing flows are gated by request-level validation.
6. **`status_sequence` for failure states.** §4.6 requires out-of-order detection but defines no ordering. *Assumption:* failure states inherit the sequence of the state they failed from, so a legitimate `DELIVERY_FAILED → IN_TRANSIT` retry is not misread as stale. This is a mechanism choice, not a new requirement.
7. **Session-local trigger marker.** The guard depends on `set_config('app.transition_ctx', 'on', true)` being transaction-scoped. *Assumption:* all transitional writes go through `withTransaction` (spec 02), which holds a single connection for the transaction — the same prerequisite every other atomic rule in the system already depends on.
