# 11 — Checkout and the Order-Creation Transaction (Guest + Registered, bKash + COD)

## Goal

After this slice a customer can place an order. Guest checkout is the default, unprompted path — a visitor who is not logged in lands directly on the guest fields with no register/login/continue-as-guest choice anywhere. A registered, logged-in customer checks out from their saved profile. Both paths converge on **one** order-creation service that, inside a single database transaction, re-runs checkout validation, re-reads the cart and current catalogue prices, revalidates and recalculates any coupon from scratch, computes the final total server-side, creates or reuses the customer reference, inserts the order and its line items, records coupon usage, and returns an Order Number — idempotently, so a double-click or network retry cannot create a second order. bKash payment submission (Transaction ID + screenshot) and its uniqueness rule are implemented here. No status may advance past creation in this slice; that is spec 12.

## Requirement references

- `02-customer.md` §2 — guest checkout is the **default, unprompted** path; checkout never presents a "Register/Login or Continue as Guest?" choice; registration is reached only from the profile icon.
- `02-customer.md` §2.3 — checkout validation branches by registered vs. guest; the registered path blocks on profile completeness and redirects to Profile naming the missing fields; the guest path returns the specific invalid/missing fields inline; **enforced on the backend as well as the frontend**.
- `02-customer.md` §2.9.1 — the guest checkout flow, steps 1–7.
- `02-customer.md` §2.9.2 — the required guest fields (the same address model as §2.2, never a reduced schema).
- `02-customer.md` §2.9.3 — the **exact backend validation order**, failing fast: required-field presence → BD phone format → address structure → email format (only if supplied) → cart/order content (items available, prices current) → payment-method-specific validation.
- `02-customer.md` §2.9.4 — create or reuse an internal customer reference keyed by phone; **no login credentials created**; guest orders use the same fields, tables, and state machine.
- `03-payment-order.md` §3 — the backend re-runs §2.3's validation before creating an order; **order creation is a single database transaction** covering validation, cart/price re-check, coupon revalidation and recalculation, and the order insert; a failure rolls back with no order created.
- `03-payment-order.md` §3.1 — bKash: the checkout page shows the merchant number and instructions for the server-computed discounted total; the customer submits a Transaction ID and/or screenshot; **order placement and payment submission are idempotent via a client-generated idempotency key**; the **Transaction ID must be unique across all orders**; initial statuses `Payment: Pending Verification`, `Order: Pending Confirmation`.
- `03-payment-order.md` §3.2 — COD: confirmation message; initial `Order Status: COD Verification Pending`, `Payment Status: Pending Collection`.
- `03-payment-order.md` §3.9 — the order stores subtotal, optional coupon discount, shipping, and final total as separate amount fields.
- `07-order-state-machine.md` §5.21 — bKash orders start `PENDING_CONFIRMATION`; COD orders start `COD_VERIFICATION_PENDING`; payment status starts `PENDING_VERIFICATION` (bKash) or `PENDING_COLLECTION` (COD); shipment status starts `NOT_CREATED`; the three statuses are independent fields; §5.21.11 — all status changes are recorded with previous/new/timestamp/actor/reason.
- `07-order-state-machine.md` §5.21.11 — coupon fields add no status and no transition; **coupon usage recording happens at order creation, independent of and prior to any status transition**.
- `10-coupon-discount.md` §8.15b — mandatory revalidation from scratch at placement; failure means the order fails with the specific message, never a silent no-discount or different-amount order; §8.15c — the stored total composition; §8.16a/b — bKash and COD amounts are the discounted final total; §8.23 — the order snapshots `coupon_id`, `coupon_code`, `discount_type`, `discount_amount`, `eligible_subtotal`, never recalculated later; §8.25/§8.26 — usage recorded atomically in the same transaction at creation.
- `05-admin-operations.md` §5.1 — **stock is not decremented at placement**; it decrements at `CONFIRMED` (spec 12).
- `04-courier-shipment.md` §4.15 — the internal store Order Number is **not** the courier tracking identifier and must not be treated as interchangeable.
- `06-rbac.md` §5.19 — guest checkout is unauthenticated and gated by request-level validation, not RBAC.
- `08-analytics-meta.md` §6.2–6.3 — `InitiateCheckout` and `AddPaymentInfo` fire during checkout; **`Purchase` must not fire at order submission** (spec 12/18 own it).
- `11-security-hardening.md` §11.4 (upload limits), §11.6 (validation, upload type checking), §11.8 (amounts always recalculated server-side; never trust a client total).
- Skills: `backend` §3, §6, `security` §3, §5, `database` §2–3, `test` §1, §3, `frontend` §2, §5, `design` (Checkout steps 1–3b, Order Confirmation).

## Depends on

- **01** — API conventions, validation, errors.
- **02** — `customers` (phone-unique, shared address model), `normalizeBdPhone`, `withTransaction`, `audit_logs`.
- **04** — `validateUpload`, `createUploadLimit`, `publicCeiling`, `authenticatedCeiling`.
- **05** — catalogue and prices (read-only here; no decrement).
- **06** — the private `payment-proofs` bucket and the permission-checked signed-URL read pattern.
- **08** — customer sessions and `evaluateProfileCompleteness()`.
- **09** — `resolveCartForPricing()`, cart status/`converted_order_id`.
- **10** — `validateCoupon()` and `recordCouponUsage()`.
- **21** — `computeShipping()` and the zone/rate table (see `computeShipping()` below). Soft dependency: if 21 is not yet built, a flat configurable amount behind the same signature unblocks this slice.

## Scope

**In scope**

- `orders`, `order_items`, `order_status_history`, `payments`, `payment_submissions`, `shipments` (row created at order time in `NOT_CREATED`), `idempotency_keys` schema.
- Order Number generation.
- The single `createOrder()` transaction: ordered validation, one transaction boundary, coupon revalidation, and usage recording (§2.9.3, §3, §8.15b, §8.25–8.26).
- Idempotency-key handling (§3.1).
- bKash payment submission and resubmission, with the global Transaction ID uniqueness rule.
- Payment screenshot upload into the private bucket.
- Calling `computeShipping()` (spec **21**) at the right point in the transaction — after the discount is final. This slice consumes the quote and stores `shipping_amount`; it does not define the rate rule.
- Checkout pages for guest and registered paths, bKash and COD, plus the order confirmation page.

**Out of scope / deferred**

- **Every status transition after creation** — deferred to spec **12**, which owns the state machine. This slice writes only initial statuses.
- Admin payment verification/rejection and COD confirmation — deferred to spec **13**.
- Stock decrement — §5.1 places it at `CONFIRMED`; spec **12**.
- Shipment creation — spec **14**.
- Guest order lookup and Track Order — spec **15**.
- `Purchase` event — §6.3 fixes it at `CONFIRMED`; specs **12**/**18**. `InitiateCheckout`/`AddPaymentInfo` attach points are marked here and fired in spec **18**.

## Database changes

Migration file: `backend/migrations/0011_orders.sql`

### Enums — verbatim from §5.21, the authoritative source

```sql
CREATE TYPE order_status AS ENUM (
  'PENDING_CONFIRMATION','COD_VERIFICATION_PENDING','CONFIRMED',
  'PROCESSING','DELIVERED','CANCELLED','RETURNED');

CREATE TYPE payment_status AS ENUM (
  'PENDING_VERIFICATION','PAID_VERIFIED','REJECTED',
  'PENDING_COLLECTION','PAID_COLLECTED');

CREATE TYPE shipment_status AS ENUM (
  'NOT_CREATED','CREATING','CREATED','SHIPPED','IN_TRANSIT',
  'OUT_FOR_DELIVERY','DELIVERED','CREATION_FAILED','DELIVERY_FAILED','RETURNED');

CREATE TYPE payment_method AS ENUM ('BKASH','COD');
```

The order-status enum is exactly the seven values in §5.21 — no `SHIPPED`, `IN_TRANSIT`, or `OUT_FOR_DELIVERY`, because those are called shipment states, and "the order status does not change to" them (§5.21.4). `PAID_VERIFIED`/`PAID_COLLECTED` are the SCREAMING_SNAKE_CASE forms of `Paid / Verified` and `Paid / Collected`, following the naming-convention note in §3.8.

### `orders`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `order_number` | `text` | NOT NULL | — | Customer-facing (§4.14.7); **not** a courier ID (§4.15) |
| `customer_id` | `uuid` | NOT NULL | — | FK → `customers(id)` ON DELETE RESTRICT; guest or registered (§2.9.4) |
| `is_guest_order` | `boolean` | NOT NULL | — | Snapshot of the account type at placement, for §5.2's Guest badge |
| `payment_method` | `payment_method` | NOT NULL | — | |
| `order_status` | `order_status` | NOT NULL | — | §5.21 |
| `payment_status` | `payment_status` | NOT NULL | — | §5.21.11 — independent field |
| `shipment_status` | `shipment_status` | NOT NULL | `'NOT_CREATED'` | §5.21.11 — independent field |
| `subtotal` | `numeric(12,2)` | NOT NULL | — | §3.9, §8.15c |
| `discount_amount` | `numeric(12,2)` | NOT NULL | `0` | §8.15c, §8.23 |
| `shipping_amount` | `numeric(12,2)` | NOT NULL | — | §8.14c — never discounted |
| `total_amount` | `numeric(12,2)` | NOT NULL | — | The bKash/COD amount (§8.16a/b) |
| `coupon_id` | `uuid` | NULL | — | FK → `coupons(id)` ON DELETE RESTRICT (§8.23) |
| `coupon_code` | `text` | NULL | — | Denormalized snapshot (§8.23) |
| `coupon_discount_type` | `discount_type` | NULL | — | Snapshot (§8.23) |
| `coupon_eligible_subtotal` | `numeric(12,2)` | NULL | — | Snapshot (§8.23) |
| `contact_name` | `text` | NOT NULL | — | Delivery snapshot (§2.9.2) |
| `contact_phone` | `text` | NOT NULL | — | |
| `contact_email` | `text` | NULL | — | |
| `division` / `district` | `text` | NOT NULL | — | §2.2/§2.9.2 |
| `area_unit_type` | `area_unit_type` | NOT NULL | — | UPAZILA \| THANA discriminator (§2.2) |
| `area_unit_name` | `text` | NOT NULL | — | |
| `ward_unit_type` | `ward_unit_type` | NOT NULL | — | UNION \| WARD discriminator |
| `ward_unit_name` | `text` | NOT NULL | — | |
| `detailed_address` | `text` | NOT NULL | — | |
| `postal_code` | `text` | NULL | — | |
| `delivery_instructions` | `text` | NULL | — | Sent to couriers (§4.2) |
| `placed_at` | `timestamptz` | NOT NULL | `now()` | |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- `UNIQUE (order_number)`.
- **`CHECK (total_amount = subtotal - discount_amount + shipping_amount)`** — §8.15c's composition made structural, so no code path can persist an inconsistent total.
- `CHECK (discount_amount >= 0 AND discount_amount <= subtotal)` — §8.14b's floor at zero.
- `CHECK ((coupon_id IS NULL) = (coupon_code IS NULL))` — the snapshot is all-or-nothing.
- `CHECK` tying method to initial status validity is **not** added, because later transitions legitimately move both; the state machine (spec 12) is the enforcement point.
- Indexes: `(order_status, placed_at DESC)`, `(payment_status)`, `(customer_id, placed_at DESC)`, `(contact_phone)`.

**The address is snapshotted onto the order.** A registered customer may later edit their profile (§2.6); the order must still show, and the courier must still receive, the address the order was actually placed with. This is the same reasoning §8.23 applies to coupon snapshots.

### `order_items`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `order_id` | `uuid` | NOT NULL | FK → `orders(id)` ON DELETE RESTRICT |
| `product_variant_id` | `uuid` | NOT NULL | FK → `product_variants(id)` ON DELETE RESTRICT |
| `product_id` | `uuid` | NOT NULL | FK → `products(id)` ON DELETE RESTRICT |
| `product_name` | `text` | NOT NULL | Snapshot |
| `variant_label` | `text` | NOT NULL | Snapshot, e.g. "Black / M" |
| `sku` | `text` | NULL | Snapshot |
| `unit_price` | `numeric(12,2)` | NOT NULL | Snapshot of the price actually charged |
| `quantity` | `integer` | NOT NULL | `CHECK (quantity > 0)` |
| `line_total` | `numeric(12,2)` | NOT NULL | `CHECK (line_total = unit_price * quantity)` |

`RESTRICT` on the catalogue FKs is what makes spec 05's "a product that has been ordered is deactivated, never deleted" enforceable at the database level.

### `order_status_history` (§5.21.11)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `order_id` | `uuid` | NOT NULL | FK → `orders(id)` ON DELETE CASCADE |
| `status_kind` | `text` | NOT NULL | `ORDER` \| `PAYMENT` \| `SHIPMENT` |
| `previous_status` | `text` | NULL | NULL for the creation row |
| `new_status` | `text` | NOT NULL | |
| `reason` | `text` | NULL | |
| `actor_user_id` | `uuid` | NULL | NULL for system/courier-driven changes |
| `actor_type` | `text` | NOT NULL | `USER` \| `SYSTEM` \| `CUSTOMER` |
| `related_event` | `jsonb` | NULL | §5.21.11 "related payment, order, or shipment event" |
| `created_at` | `timestamptz` | NOT NULL | `now()` |

Append-only. Three rows are written at creation (one per status kind), so the history is complete from the first instant.

### `payments` and `payment_submissions`

One `payments` row per order; one `payment_submissions` row per bKash attempt, because §5.21.2 requires "the previous rejected submission must remain available in the payment history."

`payments`:

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `order_id` | `uuid` | NOT NULL | FK → `orders(id)`; `UNIQUE` |
| `method` | `payment_method` | NOT NULL | |
| `status` | `payment_status` | NOT NULL | Mirrors `orders.payment_status`; the order column is the read path, this one the payment record |
| `amount_due` | `numeric(12,2)` | NOT NULL | = `orders.total_amount` (§8.16a/b) |
| `current_submission_id` | `uuid` | NULL | FK → `payment_submissions(id)` |
| `verified_at` / `verified_by` | — | NULL | Written by spec 13 |

`payment_submissions`:

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `payment_id` | `uuid` | NOT NULL | FK → `payments(id)` ON DELETE CASCADE |
| `transaction_id` | `text` | NULL | bKash Transaction ID |
| `proof_object_id` | `uuid` | NULL | FK → `storage_objects(id)` — the private screenshot |
| `submitted_at` | `timestamptz` | NOT NULL | `now()` |
| `rejected_at` / `rejected_by` / `rejection_reason` | — | NULL | Written by spec 13 (§5.21.2) |

- **`CREATE UNIQUE INDEX ON payment_submissions (upper(btrim(transaction_id))) WHERE transaction_id IS NOT NULL;`** — §3.1's "The submitted bKash Transaction ID must be unique across all orders." Enforced at the database level across every order and every submission, so a reused proof cannot be recorded even under concurrency. §5.3 confirms duplicates are rejected by the backend before reaching the admin panel.
- `CHECK (transaction_id IS NOT NULL OR proof_object_id IS NOT NULL)` — §3.1 allows "Transaction ID **and/or** screenshot," so at least one is required.

### `shipments`

Created at order time in `NOT_CREATED` so §5.21.4's lifecycle starts from a real row. Fully specified in spec 14; this migration creates it with `id`, `order_id` (unique), `status`, `courier_code` (nullable), `courier_order_id` (nullable), and timestamps, per §4.15's field list.

### `idempotency_keys` (§3.1)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `key` | `text` | NOT NULL | PK — the client-generated UUID |
| `scope` | `text` | NOT NULL | `order_create` \| `payment_submit` |
| `request_fingerprint` | `text` | NOT NULL | Hash of the normalized request body |
| `status` | `text` | NOT NULL | `IN_PROGRESS` \| `COMPLETED` |
| `response_body` | `jsonb` | NULL | The original result, replayed on retry |
| `order_id` | `uuid` | NULL | FK → `orders(id)` |
| `created_at` / `completed_at` | `timestamptz` | | |

### Order Number generation

Format `ORD-YYYY-NNNNNN` (§4.14.7's `ORD-2026-001025`). Generated from a Postgres sequence per year, so numbers are unique and allocated without a read-then-write race.

§2.9.7 requires that the Order Number not act as a bearer token or appear alone in a guessable lookup URL returning order details. Spec 15 satisfies that by requiring the phone number on every lookup; this slice's contribution is that the Order Number is never itself an authorization credential — no endpoint accepts it alone.

## Backend work

### Routes

| Method | Path | Auth | Limiter |
| --- | --- | --- | --- |
| `POST` | `/api/checkout/validate` | optional | `publicCeiling` |
| `POST` | `/api/orders` | optional | `publicCeiling` |
| `POST` | `/api/orders/:orderNumber/payment-submission` | optional (order-scoped) | `publicCeiling` |
| `GET` | `/api/checkout/config` | none | `publicCeiling` |

`POST /api/orders` is deliberately **unauthenticated-capable**. A session, if present, selects the registered branch; its absence selects the guest branch. No route rejects a caller for lacking a session (§2, §5.19).

### Types

```ts
type GuestCheckoutFields = {          // §2.9.2 — the same model as §2.2, never reduced
  fullName: string;
  phoneNumber: string;
  email?: string;                     // optional
  division: string;
  district: string;
  areaUnitType: 'UPAZILA' | 'THANA';
  areaUnitName: string;
  wardUnitType: 'UNION' | 'WARD';
  wardUnitName: string;
  detailedAddress: string;
  postalCode?: string;                // optional
};

type CreateOrderRequest = {
  idempotencyKey: string;             // client-generated UUID, once per checkout attempt (§3.1)
  paymentMethod: 'BKASH' | 'COD';
  couponCode?: string;                // a CODE only — never a discount or total (§8.16)
  guest?: GuestCheckoutFields;        // present only when not logged in
  deliveryInstructions?: string;
};
// No subtotal, discount, shipping, or total field exists anywhere in this type.

type CreateOrderResponse = {
  orderNumber: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  shipmentStatus: ShipmentStatus;     // always NOT_CREATED here
  subtotal: number; discountAmount: number; shippingAmount: number; totalAmount: number;
  appliedCoupon: { code: string; discountAmount: number } | null;
  bkash?: { merchantNumber: string; amountToSend: number; instructions: string[] };
  cod?: { message: string; amountDue: number };
};

type PaymentSubmissionRequest = {     // multipart when a screenshot is included
  idempotencyKey: string;
  transactionId?: string;
  // screenshot file field, optional
};
```

### `createOrder()` — one transaction, one order of operations

This is the most load-bearing function in the system. Everything below happens inside **one** `withTransaction` call, per §3's "Order creation is a single database transaction… If any step fails, the transaction rolls back and no order record is created."

**Step 0 — Idempotency (§3.1), before the transaction.**
`INSERT INTO idempotency_keys (key, scope, request_fingerprint, status) VALUES (…, 'IN_PROGRESS') ON CONFLICT (key) DO NOTHING`.
- Insert succeeded → proceed.
- Conflict with `COMPLETED` and a matching fingerprint → return the stored `response_body` unchanged. §3.1: "the backend treats a repeated request carrying the same key as the same attempt and returns the original result rather than creating a new order."
- Conflict with `IN_PROGRESS` → `409 REQUEST_IN_PROGRESS` (an in-flight duplicate, e.g. a double-click).
- Conflict with a **different** fingerprint → `422 IDEMPOTENCY_KEY_REUSED`, since the same key with different content is a client error, not a retry.

**Step 1 — Branch by caller, then validate in §2.9.3's exact order.**

*Registered (session present):* re-run `evaluateProfileCompleteness()` from spec 08. Incomplete → `422 PROFILE_INCOMPLETE` with `missingFields`. §2.3 and §3 both require this to be re-run server-side regardless of what the frontend allowed. The delivery details come from the saved profile, never from the request body — a logged-in customer's request carries no address fields, so a tampered body cannot redirect their own order.

*Guest (no session):* validate `guest` in the exact order §2.9.3 prescribes, failing fast and returning the offending field(s):
1. Required-field presence (every §2.9.2 field except email and postal code).
2. Bangladesh phone format via `normalizeBdPhone`/`isValidBdPhone`.
3. Address structure — both discriminators present and consistent with their names (§2.2).
4. Email format, **only if** an email was supplied.
5. *(cart validation is step 5, below)*
6. *(payment-method validation is step 6, below)*

The ordering matters because §2.9.3 specifies it and because the returned error identifies the first failure; a test asserts a request failing at both step 2 and step 4 reports step 2.

**Step 2 — Resolve the customer reference (§2.9.4).**
- Registered → the session's `customer_id`.
- Guest → `customers.upsertByPhoneNumber(...)`: create a `GUEST` record, or reuse an existing record with that phone. Reusing an existing **`REGISTERED`** record is allowed and correct — §2.9.4 says to reuse the record with the same phone number, and §5.7 treats both types as the same kind of record. **No `users` row, password, or auth identity is created.** The guest's submitted name/address update the record's contact fields only when it is a `GUEST` record; a `REGISTERED` record's stored profile is not overwritten by a guest-path submission (that profile is the customer's own, editable only through §2.6).

**Step 3 — Re-read the cart and current prices (§2.9.3 step 5, §3, §8.14).**
Call spec 09's `resolveCartForPricing()`. Empty cart → `422 CART_EMPTY`. Any line `UNAVAILABLE` or `OUT_OF_STOCK` → `409 ITEMS_UNAVAILABLE` listing the offending lines. Prices come from the catalogue at this instant; the client's earlier view is irrelevant (§8.16).

**Step 4 — Revalidate the coupon from scratch (§8.15b).**
If `couponCode` is present, call spec 10's `validateCoupon()` with the freshly priced lines, the resolved customer, and server time. Failure → **fail the order** with the §8.22 specific message (`422 COUPON_INVALID`). The rule is explicit: "order creation must fail with the specific validation message rather than silently placing the order without the discount or silently applying a different amount" (§8.15b). The preview result is neither consulted nor trusted.

**Step 5 — Compute totals server-side (§8.15c, §8.14c).**
```text
subtotal        = merchandiseSubtotal from step 3
discountAmount  = validateCoupon result, or 0
shippingAmount  = computeShipping(...)      // never discounted (§8.14c)
totalAmount     = subtotal - discountAmount + shippingAmount
```
No value in this computation originates from the request body.

**Step 6 — Payment-method validation (§2.9.3 step 6).**
- `BKASH` → the order is created first and payment information is submitted afterwards (§3.1's sequence: place order, then send money, then submit the Transaction ID). Validation here is limited to the method being enabled and the merchant number being configured.
- `COD` → no payment validation is possible before delivery (§3.2).

**Step 7 — Insert the order.**
`orders` (with statuses per §5.21 — see below), `order_items` (snapshotting name, variant label, SKU, unit price), `payments` (`amount_due = total_amount`, per §8.16a/b), `shipments` (`NOT_CREATED`), and three `order_status_history` rows.

Initial statuses, exactly as §5.21 and §3.1/§3.2 state:

| Method | `order_status` | `payment_status` | `shipment_status` |
| --- | --- | --- | --- |
| bKash | `PENDING_CONFIRMATION` | `PENDING_VERIFICATION` | `NOT_CREATED` |
| COD | `COD_VERIFICATION_PENDING` | `PENDING_COLLECTION` | `NOT_CREATED` |

**Step 8 — Record coupon usage (§8.25, §8.26).**
If a coupon applied, call spec 10's `recordCouponUsage(tx, …)` **inside this same transaction**. A `false` result → abort the whole transaction with the "usage limit reached" message. §8.26 fixes this at order creation, not at `CONFIRMED`; §5.21.11 confirms it is "independent of and prior to any status transition."

**Step 9 — Mark the cart converted.** `carts.status = 'CONVERTED'`, `converted_order_id` set.

**Step 10 — Complete the idempotency record** with the response body and `order_id`, inside the same transaction.

**Explicitly not done here:** no stock decrement (§5.1 places it at `CONFIRMED`), no `Purchase` event (§6.3 fixes it at `CONFIRMED`), no status advance.

If any step fails, the transaction rolls back: no order, no order items, no usage row, no cart conversion, and the idempotency key is released so a corrected retry can proceed.

### bKash payment submission (§3.1)

`POST /api/orders/:orderNumber/payment-submission`, idempotency-keyed, multipart when a screenshot is attached, with the 5 MB upload limit from spec 04.

Order-scoped authorization without a session: the caller must present the order's phone number alongside the Order Number, matching §2.9.5's two-factor pattern — a guest has no session, so this is the only ownership proof available, and §2.9.7's non-enumeration rule applies (a mismatch returns the same generic not-found as an unknown order).

Inside `withTransaction`:
1. Load the order; reject unless `payment_method = 'BKASH'`.
2. Reject unless `payment_status` is `PENDING_VERIFICATION` or `REJECTED` — resubmission after rejection is explicitly allowed (§3.4, §5.21.2) and moves the payment back to `PENDING_VERIFICATION`.
3. Require a `transactionId` and/or a screenshot (§3.1).
4. Normalize and insert the `payment_submissions` row; a duplicate Transaction ID hits the unique index and returns `409 TRANSACTION_ID_ALREADY_USED` (§3.1, §5.3).
5. Upload the screenshot to the **private** `payment-proofs` bucket (spec 06).
6. Set `payments.current_submission_id`; if the previous status was `REJECTED`, write `REJECTED → PENDING_VERIFICATION` to both `payments.status` and `orders.payment_status`, with an `order_status_history` row (§5.21.2). **`order_status` does not change** — §5.21.2: "Payment rejection does not create a new order status… the order remains `PENDING_CONFIRMATION`."

Previous submissions are retained, never overwritten (§5.21.2).

### `computeShipping()`

**Specified in full by spec 21.** No PRD defines shipping-fee computation, so it is given its own slice rather than left as a constant here: spec 21 supplies an admin-managed zone/rate table and the `computeShipping()` contract this transaction calls.

This transaction's obligations are unchanged and are what spec 21 is built around:

- It is called **after** the coupon is revalidated and the discount is final — `computeShipping(subtotal - discount)` — so §8.14c's "shipping is added after the discount is applied" holds and the coupon engine never sees a shipping figure (§8.10: shipping can never help a coupon qualify).
- Its result is written to `orders.shipping_amount` in the same statement as the order, so the structural `CHECK (total_amount = subtotal - discount_amount + shipping_amount)` is satisfied at insert time.
- The client's payload is never a source for it (§8.16, §11.4).

If spec 21 has not been built when this slice starts, implement `computeShipping()` as a single configurable flat amount behind the same signature and replace it there — no caller changes.

### `GET /api/checkout/config`

Returns the enabled payment methods, the merchant bKash number, and the flat shipping amount, so the checkout page never hard-codes them. The merchant bKash number is a public-facing payment instruction, not a secret (the customer must see it to pay).

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Idempotent replay | 200 | original response |
| Concurrent duplicate | 409 | `REQUEST_IN_PROGRESS` |
| Key reused with different content | 422 | `IDEMPOTENCY_KEY_REUSED` |
| Registered profile incomplete | 422 | `PROFILE_INCOMPLETE` + `missingFields` |
| Guest field missing/invalid | 422 | `GUEST_FIELDS_INVALID` + the first failing field |
| Cart empty | 422 | `CART_EMPTY` |
| Item unavailable / out of stock | 409 | `ITEMS_UNAVAILABLE` + lines |
| Coupon invalid at placement | 422 | `COUPON_INVALID` + the §8.22 message |
| Coupon usage limit hit in-transaction | 422 | `COUPON_INVALID` + "This coupon has reached its usage limit." |
| Duplicate Transaction ID | 409 | `TRANSACTION_ID_ALREADY_USED` |
| Payment submission on a COD order | 409 | `NOT_A_BKASH_ORDER` |
| Payment submission when already verified | 409 | `PAYMENT_NOT_SUBMITTABLE` |
| Order/phone mismatch on submission | 404 | `NOT_FOUND` (generic, per §2.9.7) |

## Frontend work

Checkout under `frontend/src/app/(storefront)/checkout/`, following the `design` skill's three-step layout.

**The default path.** A visitor who is not logged in lands **directly** on the guest fields (§2.9.1 step 2). There is no choice screen, no "Continue as Guest" button, no "Login for faster checkout" banner, and no register link anywhere under `/checkout` (§2). A logged-in customer sees their saved details with an edit link to the profile page.

- **Step 1 — Delivery**: for a guest, the §2.9.2 fields with Division/District selects, an Upazila/Thana field paired with its rural/metropolitan selector, a Union/Ward field with the same, detailed address, and optional email and postal code. For a registered customer, the saved address in read-only form; if the profile is incomplete, the page redirects to `/account/profile` with the missing fields highlighted and a return path back to checkout (§2.3's registered branch, exactly).
- **Step 2 — Payment method**: two large radio options (56px tap area) — "bKash Send Money / Send money to our bKash account" and "Cash on Delivery / Pay when you receive the item".
- **Coupon entry**: spec 10's component, mounted here. The displayed discount and total always come from the backend response (§8.16).
- **Step 3a — bKash**: instructions block on `#F9FAFB`, the merchant number in 18px bold monospace on `#DC143C` with white text and a copy action, and **the amount to send shown as the server-computed discounted total** (§8.16a, §3.1). Transaction ID input (monospace, 44px) and an optional screenshot upload (60px, "Tap to upload or take photo").
- **Step 3b — COD**: the §3.2 message on `#D1FAE5` with a `#059669` border — "Our customer-care representative will call to confirm your order" — the order summary, and a terms checkbox.
- **Order confirmation** (§4.14.7): green check, "Order Confirmed", the Order Number in 16px bold monospace, the summary, and guest lookup instructions (§2.9.5–2.9.6). A **Track Order** link appears, with copy that does **not** claim tracking is available yet — the confirmation must not promise tracking before a shipment exists, so the text reads "You can track your shipment once it has been created by the courier."
- **No account prompt on the confirmation page** (§2.9.8: "the storefront never prompts for this on the order confirmation page, the tracking page, or anywhere else in the checkout/post-checkout flow").
- **Idempotency key** generated once per checkout attempt (a UUID created when the customer reaches step 2 and reused for every retry of that attempt), per §3.1.
- Submit is disabled while in flight; a retry reuses the same key rather than generating a new one.
- `InitiateCheckout` and `AddPaymentInfo` attach points marked for spec 18.
- Mobile-first: sticky bottom action buttons, 44px inputs at 16px font, labels above fields, progress indicator "Step N/3", explicit loading/error/success states.

## Security requirements

- **No client-supplied money, ever** (§8.16, §11.8). `CreateOrderRequest` has no subtotal, discount, shipping, or total field, and `.strict()` rejects one. Every amount is computed in step 5 from catalogue prices and the coupon engine.
- **Backend re-validation is mandatory** (§2.3, §3) — profile completeness and guest fields are re-checked server-side "regardless of what the frontend allowed."
- **Coupon revalidation from scratch** (§8.15b) — the preview is never trusted; a stale or tampered discount cannot survive placement.
- **Transaction ID uniqueness is a database constraint** (§3.1), so a replayed proof cannot be attached to a second order even under concurrency.
- **Payment proof lands in the private bucket** (spec 06) and is readable only via a `payment.view`-gated signed URL — this is what makes §2.9.6's and §4.16's prohibitions enforceable.
- **A customer can never set a payment or order status.** No route in this slice accepts a status field; the only statuses written are the fixed initial values. `PAID_VERIFIED` is unreachable from any customer-facing route (`security` skill §3).
- **Guest checkout is unauthenticated by design** (§5.19) and gated by request-level field validation, not by RBAC. It is never "fixed" by adding a login gate.
- **A logged-in customer's order uses their saved address**, not request-body fields, so a tampered body cannot redirect or alter their delivery details.
- **Order Number is not a credential** (§2.9.7) — no endpoint returns order details on the Order Number alone; payment submission requires the phone as well, and a mismatch returns the same generic not-found as an unknown order.
- **Upload restrictions** — content-sniffed MIME, 5 MB cap, private bucket, re-encoded, filename discarded (§11.4, §11.6).
- **Rate limiting** — order creation and payment submission run under the public per-IP ceiling (§11.3).
- Payment-proof identifiers never appear in any customer-facing response.

## Data integrity / idempotency

- **Idempotency key (§3.1)** — a repeated request with the same key returns the original result instead of creating a second order; an in-flight duplicate is rejected. This is the primary duplicate-order defence, and it is independent of rate limiting (spec 04 notes the two solve different problems).
- **One transaction (§3)** — validation, cart re-read, coupon revalidation, order insert, usage recording, and cart conversion succeed or fail together. This guarantee is precisely what lets the §8.25 usage update share the order's transaction "so an order is never left without its corresponding coupon-usage record (or vice versa)."
- **Total composition is a `CHECK` constraint** (§8.15c), so an inconsistent total cannot be stored by any path.
- **Coupon usage is atomic and ceiling-enforced** (§8.25) — the loser of a race rolls back its order entirely rather than over-redeeming.
- **One coupon usage per order** — `UNIQUE (coupon_usages.order_id)`.
- **Transaction ID uniqueness across all orders** — a database unique index on the normalized value (§3.1).
- **No stock is decremented or reserved** (§5.1), so a placed-but-unconfirmed order holds no inventory; spec 12's atomic decrement at `CONFIRMED` handles the real contention, and an insufficient-stock confirmation fails there rather than overselling here.
- **Cart conversion** marks the cart consumed, so a stale checkout page cannot re-order the same cart.
- **Order Number from a sequence** — no read-then-write collision.
- **Snapshots** — item names, prices, address, and coupon details are copied onto the order (§8.23's principle) so later catalogue, profile, or coupon edits cannot rewrite history.
- **Payment submissions are append-only**, preserving the rejected-submission history §5.21.2 requires.

## Acceptance criteria

1. A guest with a cart `POST`s `/api/orders` with `paymentMethod: 'COD'` and valid §2.9.2 fields → 201 with an `ORD-YYYY-NNNNNN` number, `order_status: 'COD_VERIFICATION_PENDING'`, `payment_status: 'PENDING_COLLECTION'`, `shipment_status: 'NOT_CREATED'`.
2. The same request with `paymentMethod: 'BKASH'` → `order_status: 'PENDING_CONFIRMATION'`, `payment_status: 'PENDING_VERIFICATION'`, and a `bkash` block whose `amountToSend` equals `total_amount`.
3. Re-sending the identical request with the same `idempotencyKey` returns the **same** Order Number, and `SELECT count(*) FROM orders` is unchanged.
4. Sending the same key with a different cart returns `422 IDEMPOTENCY_KEY_REUSED`.
5. Two truly concurrent requests with one key produce exactly one order; the loser gets `409 REQUEST_IN_PROGRESS`.
6. `CreateOrderRequest` containing `totalAmount` or `discountAmount` returns 400.
7. Tampering the catalogue price between cart view and placement: the order's `subtotal` reflects the **current** price, not the earlier one.
8. A guest request missing `division` returns 422 naming `division`; one with a malformed phone **and** a malformed email reports the **phone** (§2.9.3's ordered, fail-fast validation).
9. A logged-in customer with an incomplete profile gets `422 PROFILE_INCOMPLETE` with `missingFields`, and no order is created — even when the frontend is bypassed entirely.
10. A logged-in customer's order uses their saved address; address fields in the request body are ignored or rejected.
11. Two guest orders from the same phone number produce **one** `customers` row, and no `users` row exists for it (§2.9.4).
12. A guest order placed with a phone that belongs to a registered customer attaches to that existing customer record and does not overwrite their saved profile.
13. `total_amount = subtotal − discount_amount + shipping_amount` on every created order; a direct SQL insert violating this is rejected by the `CHECK`.
14. With a valid 10% coupon on a ৳3,000 cart and ৳100 shipping: `subtotal 3000`, `discount 300`, `shipping 100`, `total 2800` (§8.14c's worked example), and `coupon_code`/`discount_type`/`eligible_subtotal` are snapshotted.
15. Disabling the coupon between preview and placement makes placement fail with "Invalid coupon code." and creates **no** order — not an order at full price.
16. Expiring the coupon between preview and placement fails with "This coupon has expired."
17. Exhausting the coupon's last redemption concurrently: exactly one order is created, `usage_count` equals `usage_limit`, and the other request fails with the usage-limit message and leaves no order.
18. A created order with a coupon has exactly one `coupon_usages` row (§8.25, §8.26).
19. Forcing a failure at step 8 leaves no order, no items, no usage row, and an unconverted cart.
20. `product_variants.stock_quantity` is unchanged after any order creation (§5.1).
21. No `Purchase` event fires at placement (§6.3) — asserted once spec 18 lands; until then, no such call site exists.
22. Placing an order with an out-of-stock line returns `409 ITEMS_UNAVAILABLE`.
23. Submitting a Transaction ID already used on another order returns `409 TRANSACTION_ID_ALREADY_USED`; a direct SQL insert of the duplicate is rejected by the unique index; casing and surrounding whitespace do not defeat it.
24. Submitting payment with a screenshot stores it in `payment-proofs`; the object is not publicly readable.
25. Resubmitting after a rejection moves `payment_status` from `REJECTED` to `PENDING_VERIFICATION`, leaves `order_status` at `PENDING_CONFIRMATION`, and retains the earlier submission row (§5.21.2).
26. Three `order_status_history` rows exist immediately after creation, one per status kind.
27. `grep -ri "register\|sign in\|log in\|continue as guest" frontend/src/app/\(storefront\)/checkout` returns nothing (§2, §2.9.1).
28. The order confirmation page shows the Order Number and a Track Order link whose copy does not claim tracking is available yet (§4.14.7), and prompts no account creation (§2.9.8).
29. At 375px every checkout step renders with sticky actions, 44px controls, and no horizontal scroll.

## Tests required

Per the `test` skill §1 (state machine — initial states and independence) and §3 (coupon money, with the preview-vs-revalidation test named as "the single highest-value test in this section"). Integration tests against a real database; nothing here may be mocked.

1. **Initial statuses per method** (§5.21, §3.1, §3.2) — bKash and COD each produce the exact documented triple. One test per method.
2. **Status independence at creation** (§5.21.11) — the three fields are set independently, and no field is derived from another.
3. **Creation writes history** (§5.21.11) — three `order_status_history` rows with actor and timestamp.
4. **Idempotency** (§3.1) — replay returns the original order; concurrent duplicates produce one order; key reuse with different content is rejected. Three separate cases, because they are three distinct client behaviours.
5. **Single-transaction atomicity** (§3) — a forced failure at each of steps 3, 4, 7, and 8 leaves **no** order, items, usage row, or cart conversion. One test per injection point, since a partially-committed order is the worst failure in the system.
6. **Guest validation order** (§2.9.3) — a request failing at several steps reports the earliest; one test per adjacent pair of steps.
7. **Registered profile-completeness gate** (§2.3, §3) — enforced server-side with the frontend bypassed entirely.
8. **Guest reference create-or-reuse** (§2.9.4) — two orders from one phone yield one customer row and no `users` row; a phone belonging to a registered customer attaches without overwriting their profile.
9. **Mandatory coupon revalidation** (§8.15b) — the `test` skill's highest-value case: apply at preview, then (a) mutate the cart, (b) disable the coupon, (c) expire it, (d) exhaust its limit, and (e) submit a tampered discount in the body. Every case must recompute or fail; none may create an order at a wrong price.
10. **Coupon usage concurrency at order creation** (§8.25) — two concurrent orders for the last redemption; one order, one usage row, counter at the limit.
11. **Total composition** (§8.15c) — the formula holds, including the `CHECK` at the data layer; shipping never reduced by the discount (§8.14c).
12. **bKash/COD amounts are the discounted total** (§8.16a/b) — `amount_due` and the displayed amount both equal `total_amount`.
13. **Coupon snapshot immutability** (§8.23) — editing or archiving the coupon afterwards does not change the order's stored discount fields.
14. **No client-supplied economics** (§8.16, §11.8) — every money field in the request is rejected.
15. **Prices are re-read at placement** (§2.9.3 step 5, §3) — a price change between cart and placement is reflected.
16. **No stock movement at placement** (§5.1) — stock unchanged; this guards the decrement-at-`CONFIRMED` rule against a "reserve at placement" refactor.
17. **Transaction ID global uniqueness** (§3.1) — rejected across different orders, at the API and at the database, and not defeated by casing or whitespace.
18. **Payment resubmission loop** (§5.21.2) — reject → resubmit → reject → resubmit, asserting `order_status` never changes and every submission is retained. Repeated cycles, per the `test` skill's "not just one round trip."
19. **Payment status cannot be set by a customer** (`security` §3) — no customer-reachable route accepts a status; a crafted request cannot reach `PAID_VERIFIED`.
20. **Address snapshot** — editing the customer's profile after placement does not change the order's stored address.
21. **Address discriminators** (§2.2) — THANA/WARD survive onto the order unchanged.
22. **Order Number is not a credential** (§2.9.7) — payment submission with a correct Order Number but wrong phone returns the same generic not-found as an unknown Order Number.
23. **Cart conversion** — the cart is `CONVERTED` and cannot be re-ordered.

## Open questions / assumptions

1. **Shipping-fee computation — RESOLVED by spec 21.** No PRD defines it: §8.14c adds "+ Shipping Charge" to the chain while noting "there is none to change," and §4.2 sends an amount to couriers without saying how it is derived. Because it affects every order total, including the bKash and COD amounts (§8.16a, §8.16b), it is specified as its own slice — **spec 21, Shipping Fee Computation** — with an admin-managed zone/rate table (district + metropolitan discriminator → rate), a free-shipping threshold option, and `computeShipping()` as the single authority. This transaction calls it; it does not define it. *Remaining client input:* the actual rates, which are configuration, not code (spec 21, Open questions 1).
2. **Payment submission timing.** §3.1 lists "Place the order" then "Send the required payment amount" then "Submit the Transaction ID," while §2.9.3 step 6 refers to payment-method validation *during* checkout, and §2 says the customer may submit "during or after checkout." *Assumption:* the order is created first and payment submission is a separate call, which is the only reading consistent with that numbered sequence and with the order appearing in the admin panel with `Pending Verification`. The checkout UI presents both in one flow so the customer experiences it as one step.
3. **Payment submission ownership for guests.** §3.1 does not say how a guest proves ownership when submitting payment. *Assumption:* Order Number + phone number, reusing the guest lookup verification pattern and its non-enumeration rules (§2.9.5, §2.9.7). A submission link emailed to the customer would be an alternative, but email is optional at checkout (§2.9.2), so it cannot be the primary mechanism.
4. **Order Number format.** §4.14.7 shows `ORD-2026-001025`; §4.1/§5.3 show `ORD-1025`. *Assumption:* the longer, year-qualified form, since it is the more recent and more specific example and avoids collisions across years. This is a cosmetic conflict between illustrative examples, not a behavioural one.
5. **Multiple concurrent open orders per customer.** No PRD restricts it. *Assumption:* allowed — a customer may have several orders awaiting confirmation.
6. **Delivery instructions.** §4.2 lists "Delivery instructions" among courier fields but no PRD says where the customer enters them. *Assumption:* an optional free-text field at checkout, sanitized and length-capped, passed through to the courier adapter.
7. **`REJECTED` as a COD payment status.** §5.21.3 permits `PENDING_COLLECTION → REJECTED` for the delivered-but-uncollected case, which is why `payment_status` is one enum covering both methods rather than two. No method-specific `CHECK` constrains which values a COD order may hold, because spec 12's transition table is the enforcement point.
