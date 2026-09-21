# 10 — Coupon / Discount Engine and Admin Coupon Management

## Goal

After this slice the coupon system exists end to end except for its consumption at order creation: Admin/Manager users can create, edit, activate, deactivate, and delete or archive coupons under the permission rows; the storefront can validate a code against the live cart through one public endpoint; and the validation-and-calculation engine — the seven ordered checks and the calculation chain — exists as a single function with a single set of customer-facing messages (§5.18, §8.6, §8.14). The transaction-safe usage recording defined here is implemented as a function that **only** spec 11 calls, inside the order-creation transaction, because usage recording is fixed at order creation and nowhere else (§8.25, §8.26).

## Requirement references

- `10-coupon-discount.md` §8.1 — scope; identical engine for guest and registered; no new product, identity, or auth system.
- `10-coupon-discount.md` §8.2 — Marketing / Discounts → Coupons back-office section; the admin capability list; no separate admin auth.
- `10-coupon-discount.md` §8.3 — the configurable field list.
- `10-coupon-discount.md` §8.4a — codes unique, uppercase-normalized, trimmed, uniqueness enforced by a **database-level unique index on the normalized column**, validated server-side on every create/edit and every application attempt.
- `10-coupon-discount.md` §8.4b — `PERCENTAGE` and `FIXED_AMOUNT`, mutually exclusive; `maximum_discount_amount` applies only to `PERCENTAGE` and must be ignored/rejected on a `FIXED_AMOUNT` coupon.
- `10-coupon-discount.md` §8.5 — validity evaluated using **server time only**; expiry is computed at validation time, never a background job.
- `10-coupon-discount.md` §8.6 — stored statuses `DRAFT`/`ACTIVE`/`DISABLED`; `EXPIRED` is **computed, never stored**; the seven validation conditions **in exact order, stopping at the first failure**.
- `10-coupon-discount.md` §8.8 — total and per-customer usage limits; guest identity keyed by the phone-number customer reference; both enforced server-side, transaction-safely, at order-creation time, not only at preview.
- `10-coupon-discount.md` §8.9 — never-used coupons may be deleted; used coupons may only be archived; an archived coupon behaves as `DISABLED` for validation regardless of `status`.
- `10-coupon-discount.md` §8.10 — minimum order amount against the **eligible merchandise subtotal**; maximum discount cap for percentage coupons.
- `10-coupon-discount.md` §8.12 — product/category eligibility in the data model, optional to implement in v1; if not implemented, every coupon behaves as `ALL_PRODUCTS`, step 6 is skipped, and the Admin UI must not expose a control that silently does nothing.
- `10-coupon-discount.md` §8.13 — customer eligibility `ALL_CUSTOMERS` (default) / `REGISTERED_CUSTOMERS_ONLY` / `SPECIFIC_CUSTOMER`; guests are never excluded by default.
- `10-coupon-discount.md` §8.14, §8.14a–c — the calculation chain; percentage and fixed-amount formulas; **shipping is never discounted**.
- `10-coupon-discount.md` §8.15a — Apply Coupon preview: the frontend sends code + cart item IDs and quantities, never prices; the preview creates **no** usage record and is not authoritative.
- `10-coupon-discount.md` §8.16 — the backend never trusts a frontend subtotal, discount, or total.
- `10-coupon-discount.md` §8.17 — one coupon per order; a second replaces the first, with full revalidation.
- `10-coupon-discount.md` §8.18, §8.18a — the admin and public endpoint list; the validate response shape.
- `10-coupon-discount.md` §8.19 — permission keys, with `06-rbac.md` §5.18 as the authoritative source of their Admin/Manager values.
- `10-coupon-discount.md` §8.22 — the exact customer-facing message table.
- `10-coupon-discount.md` §8.24a–c — the `coupons`, `coupon_usages`, and optional join-table schemas.
- `10-coupon-discount.md` §8.25 — the conditional `UPDATE` with an enforced ceiling; zero rows affected means fail the order transaction.
- `10-coupon-discount.md` §8.26 — usage is recorded at successful order creation, not at preview and not at `CONFIRMED`.
- `10-coupon-discount.md` §8.28 — abuse prevention, rate limiting, and the generic-message rule for nonexistent vs. disabled/archived codes.
- `10-coupon-discount.md` §8.29–8.30 — admin list and detail views, including the derived Expired label.
- `06-rbac.md` §5.18 — the six coupon permission rows and their values.
- `11-security-hardening.md` §11.3 (coupon apply limiter), §11.4 (pagination), §11.6 (validation).
- Skills: `security` §5, `backend` §6, `database` §2.3, `test` §3 (the required coupon coverage), `design`, `frontend` §2.

## Depends on

- **01** — API conventions, validation, errors, pagination.
- **02** — `customers` (the per-customer identity for §8.8), `users` (audit actors), `withTransaction`, `audit_logs`.
- **03** — `requireAuth('admin')`, `requirePermission`, the seeded coupon permission rows.
- **04** — `couponValidate` limiter, `authenticatedCeiling`.
- **05** — `products`, `categories` (referenced by the eligibility join tables).
- **09** — `resolveCartForPricing()`, which supplies the priced lines every calculation here runs on.

## Scope

**In scope**

- `coupons`, `coupon_usages`, `coupon_products`, `coupon_categories` schema.
- The validation engine implementing §8.6's seven ordered checks and §8.22's messages.
- The calculation chain implementing §8.14/§8.14a–c.
- `POST /api/coupons/validate` (public).
- Admin CRUD, activate/deactivate, delete/archive, list with derived status, detail with usage.
- `recordCouponUsage()` — the §8.25 atomic increment plus `coupon_usages` insert, callable **only from within** spec 11's order transaction.
- Admin coupon frontend and the checkout coupon-entry component (rendered by spec 11's checkout page).

**Out of scope / deferred**

- Calling `recordCouponUsage()` — deferred to spec **11**, which owns the order-creation transaction. §8.26 fixes usage at order creation, so the call site must live there.
- Applying the discount to a real order total — deferred to spec **11** (§8.15c).
- Coupon analytics reporting (§5.9 Coupons/Discounts) — deferred to spec **20**.
- Product/category eligibility **enforcement** — the schema and the join tables are built (§8.12 requires the model now), but v1 behaves as `ALL_PRODUCTS` and skips step 6. See Open questions 1.
- `SPECIFIC_CUSTOMER` eligibility enforcement — modelled, not enforced in v1 (§8.13 permits this).

## Database changes

Migration file: `backend/migrations/0010_coupons.sql`

### Enums

```sql
CREATE TYPE discount_type AS ENUM ('PERCENTAGE','FIXED_AMOUNT');
CREATE TYPE coupon_status AS ENUM ('DRAFT','ACTIVE','DISABLED');
CREATE TYPE customer_eligibility AS ENUM ('ALL_CUSTOMERS','REGISTERED_CUSTOMERS_ONLY','SPECIFIC_CUSTOMER');
CREATE TYPE product_eligibility AS ENUM ('ALL_PRODUCTS','SPECIFIC_PRODUCTS','SPECIFIC_CATEGORIES');
```

`coupon_status` has exactly three values. **`EXPIRED` is deliberately absent** — §8.6 states it "is intentionally not a value of `status`", because a stored expiry would need a background job to flip it and could drift from server time.

### `coupons` (§8.24a)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `code` | `text` | NOT NULL | — | Stored already trimmed and uppercased (§8.4a) |
| `name` | `text` | NOT NULL | — | |
| `description` | `text` | NULL | — | |
| `discount_type` | `discount_type` | NOT NULL | — | §8.4b |
| `discount_value` | `numeric(12,2)` | NOT NULL | — | Percent, or BDT amount |
| `minimum_order_amount` | `numeric(12,2)` | NULL | — | §8.10 |
| `maximum_discount_amount` | `numeric(12,2)` | NULL | — | §8.10, PERCENTAGE only |
| `starts_at` | `timestamptz` | NOT NULL | — | §8.5 |
| `expires_at` | `timestamptz` | NOT NULL | — | §8.5 |
| `usage_limit` | `integer` | NULL | — | NULL = unlimited (§8.8) |
| `usage_count` | `integer` | NOT NULL | `0` | Denormalized counter (§8.24a) |
| `per_customer_limit` | `integer` | NULL | — | NULL = unlimited |
| `customer_eligibility` | `customer_eligibility` | NOT NULL | `'ALL_CUSTOMERS'` | §8.13 default |
| `eligible_customer_id` | `uuid` | NULL | — | FK → `customers(id)`; only for `SPECIFIC_CUSTOMER` |
| `product_eligibility` | `product_eligibility` | NOT NULL | `'ALL_PRODUCTS'` | §8.12 |
| `status` | `coupon_status` | NOT NULL | `'DRAFT'` | §8.6 |
| `is_archived` | `boolean` | NOT NULL | `false` | §8.9 |
| `created_by` / `updated_by` | `uuid` | NULL | — | FK → `users(id)` (§8.24 audit) |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

Constraints:

- **`CREATE UNIQUE INDEX coupons_code_unique ON coupons (upper(btrim(code)));`** — §8.4a's "unique index on the normalized column… at the database level, not only in application code." Expressing it on `upper(btrim(code))` means the constraint holds even if an application path ever forgot to normalize.
- `CHECK (expires_at > starts_at)`.
- `CHECK (discount_value > 0)`.
- `CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 100)`.
- **`CHECK (maximum_discount_amount IS NULL OR discount_type = 'PERCENTAGE')`** — §8.4b requires a maximum on a `FIXED_AMOUNT` coupon to be rejected at creation; the database enforces it so no code path can store the contradiction.
- `CHECK (usage_count >= 0)`; `CHECK (usage_limit IS NULL OR usage_limit > 0)`; `CHECK (per_customer_limit IS NULL OR per_customer_limit > 0)`.
- `CHECK (customer_eligibility <> 'SPECIFIC_CUSTOMER' OR eligible_customer_id IS NOT NULL)`.
- Index on `(status, is_archived, expires_at)`.

### `coupon_usages` (§8.24b)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `coupon_id` | `uuid` | NOT NULL | FK → `coupons(id)` ON DELETE RESTRICT |
| `order_id` | `uuid` | NOT NULL | FK added in spec 11 when `orders` exists |
| `customer_id` | `uuid` | NOT NULL | FK → `customers(id)`; **NOT NULL** per §8.24b — every order has a customer reference, guest or registered |
| `discount_amount` | `numeric(12,2)` | NOT NULL | The amount actually applied |
| `used_at` | `timestamptz` | NOT NULL | `now()` |

- `UNIQUE (order_id)` — §8.17 permits one coupon per order, so one usage row per order; this also makes a duplicated order-creation attempt structurally unable to double-record.
- Index on `(coupon_id, customer_id)` — backs the per-customer count, which §8.24b requires be computed by **counting rows here**, not by a second denormalized counter.
- `ON DELETE RESTRICT` on `coupon_id` reinforces §8.9: a coupon with usages cannot be deleted even by a direct database operation.

### `coupon_products` / `coupon_categories` (§8.24c)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `coupon_id` | `uuid` | NOT NULL | FK → `coupons(id)` ON DELETE CASCADE |
| `product_id` / `category_id` | `uuid` | NOT NULL | FK → the existing catalogue tables |

PK on the pair. Created now and left unused in v1 per §8.12's "part of the data model (so the schema does not need to change later) but optional to implement in the first release" and the `database` skill §3's instruction not to omit these columns just because the feature is deferred.

## Backend work

### The validation engine — one function, seven ordered checks

`services/coupon/validateCoupon.ts` is the only implementation. Both the preview endpoint and spec 11's order creation call it; §8.20 requires guest and registered to share one function with internal branches, not two implementations.

```ts
type CouponValidationInput = {
  code: string;
  lines: Array<{ variantId: string; productId: string; categoryId: string;
                 quantity: number; unitPrice: number; lineTotal: number }>;  // from resolveCartForPricing
  customer: { customerId: string | null; isRegistered: boolean } | null;
  now: Date;                       // server time only (§8.5)
};

type CouponValidationResult =
  | { valid: true; couponId: string; code: string; discountType: DiscountType;
      discountValue: number; eligibleSubtotal: number; discountAmount: number; message: string }
  | { valid: false; message: string };   // one of §8.22's exact strings
```

Evaluation order — **exactly §8.6's list, stopping at the first failure**, so that a coupon failing several conditions always returns the message of the earliest one rather than an arbitrary choice:

| # | Condition | Failure message (§8.22) |
| --- | --- | --- |
| 0 | Code found after trim + uppercase | `Invalid coupon code.` |
| 1 | `status = ACTIVE` **and** `is_archived = false` | `Invalid coupon code.` — identical to "not found" (§8.22, §8.28: never reveal a code once existed) |
| 2 | `now >= starts_at` | `This coupon is not active yet.` |
| 2 | `now <= expires_at` | `This coupon has expired.` |
| 3 | `usage_count < usage_limit` (when set) | `This coupon has reached its usage limit.` |
| 4 | per-customer count `< per_customer_limit` (when set) | `You have already used this coupon.` |
| 5 | customer eligibility satisfied | `This coupon is available only to registered customers.` |
| 6 | product/category eligibility | *skipped in v1* (§8.12) |
| 7 | eligible subtotal `>= minimum_order_amount` (when set) | `This coupon requires a minimum order of ৳{minimum_order_amount}.` |

Notes that follow directly from the PRD:

- Steps 0 and 1 return the **same** message, which is why a `DISABLED` or archived coupon is indistinguishable from a nonexistent one (§8.22, §8.28).
- `DRAFT` fails step 1 and therefore also returns `Invalid coupon code.`
- Expiry at step 2 is computed from `now` versus `expires_at` — nothing reads a stored `EXPIRED` value because none exists (§8.5, §8.6).
- The per-customer count at step 4 is `SELECT count(*) FROM coupon_usages WHERE coupon_id = $1 AND customer_id = $2` (§8.24b), covering guests because a guest has a `customers` row keyed by phone (§8.8). At preview time a guest may not yet have supplied a phone number; in that case the check is skipped at preview and enforced at order creation, where the customer reference always exists, per the rule that this is "enforced… at order-creation time, not only at the 'Apply Coupon' preview step."
- Step 5 rejects a guest on a `REGISTERED_CUSTOMERS_ONLY` coupon with its **specific** message, not a generic one, so the customer understands they may log in or pick another coupon (§8.13). This is the one eligibility failure §8.22 deliberately makes specific.
- `now` is always the Express process's clock; no client-supplied timestamp reaches this function (§8.5).

### The calculation chain (§8.14)

Runs only after validation passes:

```text
eligible lines           = all lines (v1: ALL_PRODUCTS — §8.12)
eligibleSubtotal         = Σ lineTotal over eligible lines      (pre-discount, excludes shipping)
PERCENTAGE:  discount    = round(eligibleSubtotal × discount_value / 100)
             if maximum_discount_amount: discount = min(discount, maximum_discount_amount)
FIXED_AMOUNT: discount   = min(discount_value, eligibleSubtotal)
discountedSubtotal       = eligibleSubtotal − discount
finalTotal               = discountedSubtotal + shipping        (shipping never discounted — §8.14c)
```

All arithmetic uses decimal (`numeric`) semantics, never floating point. `round` is half-up to 2 decimals, and the discount is clamped so the discounted subtotal can never go below zero (§8.14b's "must never reduce the eligible merchandise subtotal below zero"). Shipping enters only at the final addition and is **never** an input to the discount — §8.14c makes this a default v1 rule.

This function does not know about shipping; it returns `eligibleSubtotal` and `discountAmount`, and spec 11 adds shipping. Keeping shipping out of the discount function makes §8.14c structurally true rather than conventionally true.

### `POST /api/coupons/validate` (§8.15a, §8.18)

Public, no authentication (a guest has no session — §8.18), `rateLimit('couponValidate')` (§8.28, §11.3).

```ts
type ValidateCouponRequest = {
  code: string;
  // Cart contents come from the server-side cart (spec 09) via the cart cookie/session.
  // No prices, subtotals, or totals are accepted from the client (§8.15a, §8.16).
};

type ValidateCouponResponse =           // §8.18a
  | { valid: true; couponCode: string; discountType: 'percentage' | 'fixed_amount';
      discountAmount: number; eligibleSubtotal: number; message: string }
  | { valid: false; message: string };
```

The handler resolves the cart through spec 09's `resolveCartForPricing()` and calls the engine. §8.15a says the frontend sends "the coupon code plus the current cart contents (product/variant IDs and quantities — not client-computed prices or totals)"; because spec 09 already holds the cart server-side under the cart cookie, this implementation sends even less from the client — only the code — which satisfies the rule more strictly than the minimum.

**The response creates no `coupon_usages` row and increments nothing** (§8.15a: "must not create a coupon-usage record and must not be treated as authoritative by the order-creation step"). Nothing about the preview is persisted or remembered; spec 11 revalidates from scratch (§8.15b).

The response never reveals remaining usage counts, the coupon's internal id, or why a disabled coupon was disabled (§8.22's final note, §8.18a).

### `recordCouponUsage()` — §8.25, called only by spec 11

```ts
// MUST be called inside the caller's order-creation transaction.
recordCouponUsage(tx, input: {
  couponId: string; orderId: string; customerId: string; discountAmount: number;
  perCustomerLimit: number | null;
}): Promise<{ ok: true } | { ok: false; reason: 'USAGE_LIMIT_REACHED' | 'PER_CUSTOMER_LIMIT_REACHED' }>;
```

Implementation, exactly as §8.25 specifies:

```sql
UPDATE coupons
   SET usage_count = usage_count + 1
 WHERE id = $1 AND (usage_limit IS NULL OR usage_count < usage_limit)
```

If this affects **zero rows**, the coupon has hit its limit as of this instant and the function returns `ok: false`; §8.25 requires the order-creation transaction to then fail with the "usage limit reached" message rather than creating an order with a discount that can no longer be honoured.

The per-customer check re-counts `coupon_usages` inside the same transaction before inserting, so two concurrent orders by the same customer cannot both pass a `per_customer_limit: 1`.

The `coupon_usages` insert happens in the same transaction. §8.25's guarantee — "a failure at any step rolls back the whole attempt rather than leaving an order created without a corresponding usage record, or a usage record without an order" — is achieved by this function never opening its own transaction and never being callable outside one.

### Admin routes (§8.18, §8.19)

All with `requireAuth('admin')` + `rateLimit('authenticatedCeiling')`.

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/api/admin/coupons` | `coupon.view` |
| `POST` | `/api/admin/coupons` | `coupon.create` |
| `GET` | `/api/admin/coupons/:id` | `coupon.view` |
| `PATCH` | `/api/admin/coupons/:id` | `coupon.update` |
| `POST` | `/api/admin/coupons/:id/status` | `coupon.status` |
| `DELETE` | `/api/admin/coupons/:id` | `coupon.delete` |
| `GET` | `/api/admin/coupons/:id/usages` | `coupon.usage.view` |

Per §5.18: `coupon.view` and `coupon.usage.view` are `Yes` for Manager; `coupon.create`, `coupon.update`, `coupon.status`, and `coupon.delete` are `Assigned`. §8.19 defers to that table as the single authoritative source, so the implementation reads the tiers from the seeded `permissions` rows rather than hard-coding them.

Activate/deactivate is a distinct route because §5.18 gives it a distinct permission row (`Coupon Activate/Deactivate`) — folding it into `PATCH` would let a Manager with only `coupon.update` change a coupon's live status.

### Admin service rules

**Create/update** — normalize the code (trim, uppercase) before validation and storage (§8.4a); reject `maximum_discount_amount` on a `FIXED_AMOUNT` coupon (§8.4b); reject `expires_at <= starts_at`; reject a percentage above 100; record `created_by`/`updated_by`; audit every change with previous and new values.

**Delete vs. archive (§8.9)** — `DELETE /:id` checks `coupon_usages` for that coupon inside a transaction:
- zero usages → hard delete, audited;
- one or more → **refuse to delete** and instead set `is_archived = true`, returning `{ archived: true }` with an explanatory message, because "historical orders reference it… deleting it would break that historical record."

An archived coupon fails step 1 of validation regardless of `status` (§8.9's "behaves as `DISABLED` for validation purposes"), and is excluded from the default admin list.

**Derived status for the admin UI (§8.6, §8.29)** — the list and detail endpoints return both the stored `status` and a computed `displayStatus`:

```ts
displayStatus = is_archived ? 'ARCHIVED'
              : status !== 'ACTIVE' ? status              // DRAFT | DISABLED
              : now < starts_at ? 'SCHEDULED'
              : now > expires_at ? 'EXPIRED'
              : 'ACTIVE';
```

`EXPIRED` and `SCHEDULED` appear only in this computed field; neither is ever written to `status`.

**Detail view (§8.30)** — every §8.3/§8.24a field, `usage_count` against `usage_limit`, the count of **distinct customers** who used it, and the audit fields. Individual customer identities are not included, since this is limited to an aggregate and the coupon feature introduces no new customer-data exposure.

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Duplicate normalized code | 409 | `COUPON_CODE_EXISTS` |
| `maximum_discount_amount` on a fixed-amount coupon | 400 | `VALIDATION_ERROR` |
| `expires_at <= starts_at`, percentage > 100, non-positive value | 400 | `VALIDATION_ERROR` |
| Delete attempted on a used coupon | 200 | `{ archived: true }` (not an error — the PRD's prescribed fallback) |
| Coupon not found (admin) | 404 | `NOT_FOUND` |
| Validate: any failure | 200 | `{ valid: false, message }` — a rejected coupon is not an HTTP error |
| Validate rate limit | 429 | `RATE_LIMITED` |

Returning `200 { valid: false }` for a rejected coupon keeps §8.22's message table the single channel for customer-facing text and avoids leaking condition detail through status codes.

## Frontend work

### Admin (`/admin/marketing/coupons`) — §8.2, §8.29, §8.30

- Under a **Marketing / Discounts** navigation group (§8.2), visible only when the user holds `coupon.view`.
- **List**: Code | Discount | Status (including the derived Expired/Scheduled/Archived label) | Start | End | Usage (used/limit) | Customer Eligibility | Created By | Created Date, with search by code/name and filters by status and discount type (§8.29). Paginated.
- **Create/edit form**: code, name, description, discount type (radio — selecting `FIXED_AMOUNT` hides and clears the maximum-discount field, matching §8.4b), value, minimum order amount, maximum discount, starts/expires date-time, usage limit, per-customer limit, customer eligibility.
  - **Product/category restriction controls are hidden** in v1, per §8.12's explicit instruction: the fields must be "hidden or marked 'coming soon' rather than exposing a control that silently does nothing."
- **Detail**: all fields, usage vs. limit, distinct-customer count, audit trail.
- Create/edit/status/delete controls render only with the matching permission, and still handle a backend 403 (`frontend` §3).

### Checkout coupon entry (§8.15a) — component built here, mounted by spec 11

```text
Discount / Coupon
[ Enter coupon code            ]  [ Apply ]
```

- On Apply, `POST /api/coupons/validate` with the code only.
- Valid → show `Coupon applied successfully. You saved ৳{amount}.` and the updated summary **from the response**, never recomputed locally (§8.16, `frontend` §2).
- Invalid → show the returned §8.22 message verbatim.
- **Remove** returns the summary to its pre-coupon state by asking the backend for a fresh total, not by subtracting locally (§8.15a).
- Applying a second code **replaces** the first after a confirmation ("Replace SAVE20 with WELCOME10?"), and the replacement is fully revalidated by the backend (§8.17).
- The applied code is held in checkout state only as a **code string**; the discount shown always comes from the last backend response, and spec 11 re-derives everything at placement (§8.15b).
- Input 44px, uppercase-transformed for display only (the backend normalizes authoritatively), Apply button 44px, explicit loading/error/success states.

## Security requirements

- **Every coupon decision is server-side** (§8.16, §8.28) — the client sends a code, never a discount, subtotal, or total. Request schemas are `.strict()` so a submitted `discountAmount` is a 400, not silently ignored.
- **Preview is never authoritative** (§8.15a) — it writes nothing and is not consulted by order creation; spec 11 revalidates from scratch (§8.15b).
- **Usage limits are transaction-safe** (§8.25) — a conditional `UPDATE` with an enforced ceiling, never read-then-write. This is the `database` skill §2.3 item and the `test` skill's named concurrency case.
- **Non-enumeration** (§8.22, §8.28) — nonexistent, `DRAFT`, `DISABLED`, and archived codes all return `Invalid coupon code.`; no response reveals remaining usage, the coupon id, or the reason for a disabled state.
- **Rate limiting** (§8.28, §11.3) — `couponValidate` keyed per IP and, where a customer identity exists, per customer, to block code brute-forcing.
- **Server time only** (§8.5) — no client-supplied timestamp is accepted anywhere in the engine.
- **RBAC** (§8.19, §5.18) — six distinct permission checks; activate/deactivate is separately gated from update.
- **Database-level code uniqueness** on the normalized value (§8.4a), so a race between two creates cannot produce duplicate codes.
- **`maximum_discount_amount` on a fixed-amount coupon is structurally impossible** (`CHECK` constraint), not merely validated.
- **Audit** — create, update, status change, delete, and archive all append `audit_logs` rows with actor and previous/new values (§5.15 rule 10).
- Coupon codes are not secrets and are never protected by obscurity (§8.28's closing note) — the server-side checks are the control.

## Data integrity / idempotency

- **Atomic usage ceiling (§8.25).** The conditional `UPDATE` means two concurrent orders competing for the last redemption cannot both succeed; the loser's transaction rolls back entirely, taking its order with it.
- **Per-customer limit is counted, not cached (§8.24b).** Counting `coupon_usages` rows inside the transaction avoids a second denormalized counter that could drift from `usage_count`.
- **One usage row per order** — `UNIQUE (order_id)` means a retried or duplicated order-creation attempt cannot double-record, complementing spec 11's idempotency key.
- **Usage and order are inseparable (§8.25).** Both happen in one transaction; neither can exist without the other.
- **Usage is recorded once, at order creation (§8.26)** — not at preview, and not deferred to `CONFIRMED`, because deferral would let multiple concurrent unconfirmed orders each see the coupon as under its limit.
- **Usage is never reversed (§8.27)** — payment rejection and resubmission leave `usage_count` and the usage row untouched (the same order, a new payment attempt); cancellation and return do **not** restore a usage. This is deliberate and asymmetric with stock, which *is* restored (§5.1). Spec 12 must not add coupon restoration to its cancellation handler.
- **Used coupons are never deleted** — enforced by the service and again by `ON DELETE RESTRICT`, preserving §8.23's historical accuracy.
- **Archived coupons remain referencable** by historical orders while being invalid for new use.

## Acceptance criteria

1. `POST /api/admin/coupons` with `code: " save20 "` stores `SAVE20`; creating `save20` afterwards returns `409 COUPON_CODE_EXISTS`.
2. A direct SQL insert of a second row with code `Save20` is rejected by the unique index on `upper(btrim(code))`.
3. Creating a `FIXED_AMOUNT` coupon with `maximum_discount_amount` returns 400; a direct SQL insert of the same combination is rejected by the `CHECK`.
4. `\d coupons` shows a `coupon_status` enum with exactly `DRAFT`, `ACTIVE`, `DISABLED` — no `EXPIRED`.
5. An `ACTIVE` coupon whose `expires_at` has passed shows `displayStatus: 'EXPIRED'` in the admin list while `status` remains `ACTIVE`, with no background job involved.
6. `POST /api/coupons/validate` with a nonexistent code, a `DRAFT` coupon, a `DISABLED` coupon, and an archived coupon all return byte-identical `{"valid":false,"message":"Invalid coupon code."}`.
7. A coupon before `starts_at` returns `This coupon is not active yet.`; after `expires_at` returns `This coupon has expired.`
8. A coupon that is **both** expired and below its minimum order returns the **expired** message, because step 2 precedes step 7 (§8.6's ordered evaluation).
9. A coupon at its `usage_limit` returns `This coupon has reached its usage limit.`
10. A `REGISTERED_CUSTOMERS_ONLY` coupon applied by a guest returns `This coupon is available only to registered customers.` — not the generic message.
11. 20% off a ৳2,500 eligible subtotal yields a ৳500 discount; with a ৳300 cap it yields ৳300 (§8.14a's worked example).
12. A ৳500 fixed-amount coupon on a ৳200 subtotal yields a ৳200 discount and a ৳0 discounted subtotal, never negative (§8.14b's worked example).
13. Shipping never changes the discount: the same cart with shipping ৳0 and ৳100 produces an identical `discountAmount` (§8.14c).
14. A successful validate call creates no `coupon_usages` row and leaves `usage_count` unchanged (§8.15a).
15. `POST /api/coupons/validate` carrying `discountAmount` or `subtotal` in the body returns 400.
16. A guest (no session) can validate a normal coupon successfully — no account required (§8.1, §8.20).
17. `recordCouponUsage` on a coupon with `usage_limit = 1` and `usage_count = 1` returns `ok: false, reason: 'USAGE_LIMIT_REACHED'` and leaves `usage_count` at 1.
18. Two concurrent `recordCouponUsage` calls for the last redemption: exactly one succeeds, `usage_count` ends at `usage_limit`, and exactly one `coupon_usages` row exists.
19. `DELETE` on an unused coupon removes it; `DELETE` on a used coupon returns `{archived:true}`, leaves the row, and `ON DELETE RESTRICT` rejects a direct SQL delete.
20. A Manager without `coupon.create` gets 403 on create and 200 on list (`coupon.view` is `Yes`); granting `coupon.create` flips only create.
21. A Manager with `coupon.update` but not `coupon.status` gets 403 on the status route and 200 on `PATCH`.
22. The admin coupon form shows no product/category restriction control (§8.12).
23. Applying a second coupon in checkout replaces the first and triggers a fresh validate call.
24. Exceeding the validate rate limit returns 429.
25. At 375px the coupon field and Apply button are 44px tall with no horizontal scroll.

## Tests required

Per the `test` skill §3, which names the coupon engine as a top-three risk area because it "directly affects money charged to real customers." Integration tests against the real service and a real database; the revalidation tests simulate a malicious client.

1. **Percentage calculation** (§8.14a) — including the documented ৳2,500 → ৳500 and ৳300-cap cases, and a rounding case (e.g. 7.5% of ৳1,333).
2. **Fixed-amount calculation** (§8.14b) — including the discount-exceeds-subtotal clamp to zero.
3. **Shipping is not discounted** (§8.14c) — discount identical regardless of shipping.
4. **Minimum order boundary** (§8.10) — exactly at the minimum passes, one taka below fails with the exact message.
5. **Maximum discount cap boundary** (§8.10) — at and above the cap.
6. **Validation order** (§8.6) — a coupon failing multiple conditions returns the earliest condition's message. One test per adjacent pair (expired+min-order, disabled+expired, usage-limit+min-order), because the PRD calls the ordering out explicitly as "not an arbitrary or non-deterministic choice."
7. **Lifecycle rejection** (§8.6) — `DRAFT`, `DISABLED`, archived, expired, and not-yet-started each rejected with the correct §8.22 message.
8. **Non-enumeration** (§8.22, §8.28) — nonexistent, disabled, and archived produce identical responses.
9. **Customer eligibility** (§8.13) — `ALL_CUSTOMERS` works for a guest; `REGISTERED_CUSTOMERS_ONLY` rejects a guest with the specific message and accepts a registered customer.
10. **Total usage limit** (§8.8) — the limit blocks the next attempt.
11. **Per-customer usage limit** (§8.8) — enforced for a registered customer by `customer_id` and for a guest by the phone-keyed customer reference; a different guest phone is unaffected (the residual risk §8.28 accepts).
12. **Usage-limit concurrency** (§8.25, `test` skill §3's named case) — two near-simultaneous redemptions of a coupon with one use left; exactly one succeeds, the counter never exceeds the limit, and exactly one usage row exists. This is the highest-value test in this slice.
13. **Per-customer concurrency** — two concurrent orders by one customer against `per_customer_limit: 1`; exactly one succeeds.
14. **Preview writes nothing** (§8.15a) — after a valid preview, `usage_count` and `coupon_usages` are unchanged.
15. **Client-supplied economics rejected** (§8.16) — a validate request carrying a discount or subtotal is a 400, not silently ignored.
16. **Server time only** (§8.5) — a client-supplied `now`/timestamp field is rejected, and expiry is evaluated against the server clock.
17. **Code normalization** (§8.4a) — `save20`, ` SAVE20 `, and `Save20` all resolve to the same coupon; the database rejects a duplicate under any casing.
18. **Fixed-amount coupons cannot carry a maximum** (§8.4b) — rejected at the API and by the `CHECK`.
19. **Delete vs. archive** (§8.9) — unused deletes; used archives; an archived coupon fails validation regardless of `status`.
20. **Permission matrix rows** (§5.18, §8.19) — one test per coupon permission, with `Assigned` rows tested both ungranted and granted.
21. **Audit rows** on create/update/status/delete (§5.15 rule 10).
22. **Rate limiting** (§8.28, §11.3) — under the limit succeeds, over it returns 429.

*(The multiple-coupon rule §8.17 and the mandatory-revalidation rule §8.15b are exercised end to end in spec 11, where an order actually exists; the engine-level pieces they rely on are covered above.)*

## Open questions / assumptions

1. **Product/category eligibility in v1.** §8.12 explicitly permits deferring enforcement while requiring the schema. *Assumption:* build `coupon_products`/`coupon_categories` and the `product_eligibility` column, always evaluate as `ALL_PRODUCTS`, skip step 6, and hide the admin controls per that instruction. When implemented later, only `eligible lines` in the calculation chain changes — the minimum-order check and the discount base then narrow to matching lines, as its final paragraph requires.
2. **`SPECIFIC_CUSTOMER` eligibility.** §8.13 calls it "part of the data model for completeness… may be treated as optional/future scope." *Assumption:* stored and creatable, not enforced in v1. **Flagged:** unlike product eligibility, §8.13 does not instruct hiding the control — so the admin form marks it "coming soon" rather than offering a setting that silently does nothing, applying the §8.12 reasoning to the parallel case.
3. **Guest per-customer limit at preview time.** §8.8 keys guest identity to the phone-number customer reference, but at the Apply-Coupon step a guest may not have entered a phone yet. *Assumption:* skip step 4 at preview when no customer reference exists, and enforce it at order creation, which §8.8 names as the authoritative enforcement point. The consequence — a guest may see a valid preview and then be rejected at placement — is exactly what §8.15b requires ("order creation must fail with the specific validation message rather than silently placing the order without the discount").
4. **Rounding — RESOLVED.** §8.14a says `round(...)` without naming a mode. **Rule: half-up, to 2 decimal places, using decimal (`numeric`) arithmetic — never floating point — applied in exactly one function.**

   - **Half-up** is the conventional commercial rounding a Bangladeshi customer and merchant both expect; banker's rounding would surprise both and has no advantage at this volume.
   - **2 decimals** matches `numeric(12,2)`, the type every money column already uses, so the stored value is exactly the computed one with no silent truncation.
   - **One place.** `round()` lives in the single calculation function both the preview (§8.15a) and the placement revalidation (§8.15b) call. This is the property that actually matters: two implementations could differ by a taka, and the revalidation would then reject a legitimate order.
   - **Rounding applies to the discount, not the total.** The discount is rounded once; `total = subtotal - discount + shipping` is then exact, so the structural `CHECK` in spec 11 can never fail on a rounding artefact.

   *Note for the client (no code impact):* BDT has no circulating sub-taka coin, so every PRD example (§8.14a, §8.14c, §8.15c) uses whole taka. 2-decimal storage is kept because a percentage discount genuinely produces fractions (7.5% of ৳1,333 = ৳99.975 → ৳99.98) and discarding them would quietly favour one party on every such order. If the client prefers whole-taka discounts, that is a one-line change to the same function — but it must be their decision, since it changes what customers are charged.
5. **Coupon entry for a guest with no cart.** Not addressed by the PRDs. *Assumption:* validating with an empty cart returns `valid: false` with the minimum-order message when a minimum is set, and otherwise a zero discount; the checkout UI does not offer the field before there is a cart.
6. **`maximum_discount_amount` display.** §8.22's message table has no entry for "capped" — the success message simply states the amount saved. *Assumption:* show the capped amount in the standard success message without extra explanation, since §8.22 says messages must not go beyond what is listed.
