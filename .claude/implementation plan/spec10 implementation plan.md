# Implementation Plan — Spec 10: Coupon / Discount Engine and Admin Coupon Management

Source requirement: `.claude/project requirment documents/10-coupon-discount.md` §8
Source implementation spec: `.claude/implementation specs/10-coupon-engine-and-admin-management.md`
Related PRDs: `06-rbac.md` §5.18 (permission matrix), `03-payment-order.md` (order-creation transaction), `09-fraud-risk-check.md` §7.6 (phone-keyed guest identity precedent), `11-security-hardening.md` §11.3/§11.4/§11.6
Status: **Planned — not yet implemented.**

---

## Context

The user asked for an implementation plan for "spec 10" (the Coupon/Discount requirement, `10-coupon-discount.md`). A full, detailed implementation spec already exists at `.claude/implementation specs/10-coupon-engine-and-admin-management.md` — this plan does not duplicate it, it translates it into a buildable slice grounded in what actually exists in this codebase today, following the same format as the other files in this folder (e.g. `spec8 implementation plan.md`).

A codebase audit found:

- **No checkout / order-creation flow exists yet.** `grep -rn "createOrder("` across `backend/src` and `backend/tests` finds exactly one hit: the repository function definition itself (`backend/src/repositories/orders.repository.ts:61`). It is never called. This means "spec 11" (`11-checkout-and-order-creation-transaction.md`) has not been built — only its downstream primitives exist (`lib/transaction.ts`'s `withTransaction`, `repositories/db.ts`'s `run(db, fn)` helper, and `orders.repository.ts::createOrder` itself).
- **The `orders` table already anticipates coupons.** `backend/migrations/0006_orders.sql` (lines 63–76) already has nullable `coupon_id uuid` and `discount_amount numeric` columns, with a comment stating: *"coupon_id FK is nullable (coupons table does not exist yet; add the constraint in Spec 10's migration once coupons are created)."* `orders.repository.ts::createOrder`'s current INSERT hardcodes `coupon_id` to `NULL` and its `data` param has no `coupon_id` field at all — this needs to change, but only as part of the spec-11 wiring, not this slice.
- **`lib/transaction.ts`'s own doc comment names this spec directly**: "order creation, stock decrement, coupon usage, and the shipment/order cascade all require genuine transactions (03-payment-order §3, 05-admin-operations §5.1, **10-coupon-discount §8.25**, 07-order-state-machine §5.21.6)." This confirms the coupon-usage-recording function must be a transaction-joining repository function (`client: pg.PoolClient`, never opening its own transaction), following the exact pattern already used by `inventory.repository.ts::conditionalDecrement` (atomic conditional `UPDATE ... RETURNING`, never read-then-write).
- **RBAC is already fully wired for coupons.** All six permission keys (`coupon.view`, `coupon.create`, `coupon.update`, `coupon.status`, `coupon.delete`, `coupon.usage.view`) are already defined in `backend/src/types/permissions.ts` and seeded via the RBAC migration (`backend/migrations/0002_identity_address_audit.sql`) — nothing to add on the RBAC side, this slice only consumes the existing keys via `requirePermission(key)`.
- **The rate limiter is already reserved.** `backend/src/config/rateLimits.ts` already defines a `couponValidate` entry (`keyStrategy: 'identifier+ip'`, `identifierSource: 'actorId'`) — this slice mounts `rateLimit('couponValidate')`, it does not define a new limiter.
- **Guest/registered identity is already unified.** `backend/src/repositories/customers.repository.ts` holds one `customers` row per phone number (`account_type: 'GUEST' | 'REGISTERED'`), with `upsertByPhoneNumber()` doing a single `INSERT ... ON CONFLICT (phone_number) DO UPDATE` so repeat guest checkouts converge on one `customer_id`. This is the FK every per-customer coupon usage check relies on.
- What **does not** exist and is out of scope here: a cart/checkout page, the order-creation controller, and any actual call site that charges a customer using a coupon-discounted total. Those are spec 11's job.

Per the existing spec-10 implementation-spec doc's own scoping decision (§"Out of scope / deferred"), and consistent with how `spec8 implementation plan.md` handled the same kind of forward dependency (deferring `Purchase`/checkout-linked events until spec 11/12 land): **this plan builds the entire coupon engine, its data model, and its admin/customer-facing endpoints now, and defines — but does not call — the transaction-joining usage-recording function that spec 11 must invoke.** This avoids two failure modes: building dead code that assumes an order-creation transaction that doesn't exist yet, and silently deferring the coupon feature entirely until spec 11 is done (which would block Marketing from creating and testing coupons in the admin panel today).

---

## What this slice builds now

1. `coupons`, `coupon_usages`, `coupon_products`, `coupon_categories` schema (migration `0009_coupons.sql`, next unused number after `0008_customer_risk_checks.sql`).
2. The single coupon validation-and-calculation engine (`services/coupon/validateCoupon.ts`) implementing §8.6's seven ordered checks and §8.14's discount chain — the one function both the public preview endpoint and (later) spec 11's order creation will call.
3. `POST /api/coupons/validate` — public, rate-limited, preview-only, writes nothing.
4. Full admin CRUD: create, list, detail, update, activate/deactivate, delete/archive, usage view — all RBAC-gated per the existing permission keys.
5. `recordCouponUsage()` — the §8.25 atomic usage-reservation function, built and unit-tested against a manually-opened transaction in this slice's own tests, but **not called from anywhere in production code yet** — its call site is spec 11's order-creation transaction.
6. Admin coupon frontend (`/admin/marketing/coupons` — list, create/edit, detail).
7. The checkout coupon-entry UI component, built here but not yet mounted on a real checkout page (there isn't one) — it is exported ready for spec 11 to import.

## What this slice explicitly defers (and why)

| Deferred item | Blocked by | Action needed later |
| --- | --- | --- |
| Calling `recordCouponUsage()` in production | No order-creation transaction exists (spec 11) | Spec 11 imports and calls it inside its own `withTransaction` block, per §8.25/§8.26 |
| `orders.repository.ts::createOrder` accepting/persisting a real `coupon_id` | Same — the function signature and INSERT currently hardcode `coupon_id` to `NULL` | Spec 11 extends the signature and INSERT when it wires coupon revalidation into order placement |
| `coupon_usages.order_id` foreign key to `orders(id)` | `orders` table exists already, but the *transactional* linkage (inserting a usage row alongside a real order row) has no caller yet | The FK constraint itself is added now (the `orders` table already exists); only the write path is deferred |
| Applying the discount to a real charged total (bKash amount, COD amount) | No checkout page or payment step exists | Spec 11 §8.15c/§8.16a/§8.16b |
| Mounting the coupon-entry component on an actual checkout page | No checkout page exists | Spec 11 imports the component built here |
| Product/category eligibility **enforcement** | §8.12 explicitly permits deferring this while requiring the schema now | Schema and join tables (`coupon_products`/`coupon_categories`) are built in this slice; v1 behavior is always `ALL_PRODUCTS`, step 6 is always skipped, and the admin UI hides the restriction controls |
| `SPECIFIC_CUSTOMER` eligibility enforcement | §8.13 permits deferring | Column and value are modeled; admin form marks it "coming soon" |
| Coupon analytics/reporting (§5.9) | Belongs to spec 20 | Deferred entirely |

Each deferred item's data shape (columns, function signature, response shape) is fixed now so nothing here needs redesigning later — only the call site changes when spec 11 lands.

---

## 1. Database migration — `backend/migrations/0009_coupons.sql`

Confirm the next unused migration number at implementation time (currently `0008_customer_risk_checks.sql` is the latest on disk; `geography_and_courier_mapping.sql` is an unnumbered legacy exception — do not follow that pattern). No explicit `BEGIN`/`COMMIT` in the file — the runner (`backend/scripts/migrate.ts`) wraps every file automatically.

### Enums

```sql
CREATE TYPE discount_type AS ENUM ('PERCENTAGE','FIXED_AMOUNT');
CREATE TYPE coupon_status AS ENUM ('DRAFT','ACTIVE','DISABLED');
CREATE TYPE customer_eligibility AS ENUM ('ALL_CUSTOMERS','REGISTERED_CUSTOMERS_ONLY','SPECIFIC_CUSTOMER');
CREATE TYPE product_eligibility AS ENUM ('ALL_PRODUCTS','SPECIFIC_PRODUCTS','SPECIFIC_CATEGORIES');
```

`EXPIRED` is deliberately **not** a value of `coupon_status` (§8.6) — it is always a computed field, never stored, so there is no background job to drift out of sync with server time.

### `coupons` table (§8.24a)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `code` | `text` | NOT NULL | — | Stored already trimmed + uppercased (§8.4a) |
| `name` | `text` | NOT NULL | — | |
| `description` | `text` | NULL | — | |
| `discount_type` | `discount_type` | NOT NULL | — | §8.4b |
| `discount_value` | `numeric(12,2)` | NOT NULL | — | Percent or BDT amount |
| `minimum_order_amount` | `numeric(12,2)` | NULL | — | §8.10 |
| `maximum_discount_amount` | `numeric(12,2)` | NULL | — | §8.10, PERCENTAGE only |
| `starts_at` | `timestamptz` | NOT NULL | — | §8.5 |
| `expires_at` | `timestamptz` | NOT NULL | — | §8.5 |
| `usage_limit` | `integer` | NULL | — | NULL = unlimited |
| `usage_count` | `integer` | NOT NULL | `0` | Denormalized counter; `coupon_usages` is the source of truth |
| `per_customer_limit` | `integer` | NULL | — | NULL = unlimited |
| `customer_eligibility` | `customer_eligibility` | NOT NULL | `'ALL_CUSTOMERS'` | §8.13 default |
| `eligible_customer_id` | `uuid` | NULL | — | FK → `customers(id)`, only for `SPECIFIC_CUSTOMER` |
| `product_eligibility` | `product_eligibility` | NOT NULL | `'ALL_PRODUCTS'` | §8.12 |
| `status` | `coupon_status` | NOT NULL | `'DRAFT'` | §8.6 |
| `is_archived` | `boolean` | NOT NULL | `false` | §8.9 |
| `created_by` / `updated_by` | `uuid` | NULL | — | FK → `users(id)` |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

Constraints:

- `CREATE UNIQUE INDEX coupons_code_unique ON coupons (upper(btrim(code)));` — enforces §8.4a's normalized uniqueness at the database level, so the constraint holds even if an application path forgets to normalize.
- `CHECK (expires_at > starts_at)`.
- `CHECK (discount_value > 0)`.
- `CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 100)`.
- `CHECK (maximum_discount_amount IS NULL OR discount_type = 'PERCENTAGE')` — makes §8.4b's rule structurally impossible to violate, not just application-validated.
- `CHECK (usage_count >= 0)`, `CHECK (usage_limit IS NULL OR usage_limit > 0)`, `CHECK (per_customer_limit IS NULL OR per_customer_limit > 0)`.
- `CHECK (customer_eligibility <> 'SPECIFIC_CUSTOMER' OR eligible_customer_id IS NOT NULL)`.
- `CREATE INDEX ON coupons (status, is_archived, expires_at);`

### `coupon_usages` table (§8.24b)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `coupon_id` | `uuid` | NOT NULL | FK → `coupons(id)` ON DELETE RESTRICT |
| `order_id` | `uuid` | NOT NULL | FK → `orders(id)` — safe to add now since `orders` already exists |
| `customer_id` | `uuid` | NOT NULL | FK → `customers(id)` |
| `discount_amount` | `numeric(12,2)` | NOT NULL | The amount actually applied |
| `used_at` | `timestamptz` | NOT NULL | `now()` |

- `UNIQUE (order_id)` — §8.17 permits one coupon per order; this also structurally prevents a retried order-creation attempt from double-recording.
- `CREATE INDEX ON coupon_usages (coupon_id, customer_id);` — backs the per-customer count, computed by counting rows here (§8.24b), not a second denormalized counter.
- `ON DELETE RESTRICT` on `coupon_id` — reinforces §8.9 even against a direct database operation.

### `coupon_products` / `coupon_categories` (§8.24c)

```sql
CREATE TABLE coupon_products (
  coupon_id  uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  PRIMARY KEY (coupon_id, product_id)
);
CREATE TABLE coupon_categories (
  coupon_id   uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id),
  PRIMARY KEY (coupon_id, category_id)
);
```

Created now, left unused in v1, per §8.12's explicit instruction not to omit the schema just because enforcement is deferred.

### `orders` table — add the deferred FK

```sql
ALTER TABLE orders ADD CONSTRAINT orders_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons(id);
```

This is the constraint `0006_orders.sql`'s own comment says spec 10 owes it. It does not require `orders.repository.ts::createOrder` to change — the column already exists and is currently always inserted as `NULL`, which remains valid until spec 11 starts populating it.

---

## 2. The validation engine — `backend/src/services/coupon/validateCoupon.ts`

One function. Both the preview endpoint (this slice) and spec 11's order-creation revalidation (later) call it — §8.20 requires guest and registered customers to share one engine, not two implementations.

```ts
type CouponValidationInput = {
  code: string;
  lines: Array<{ variantId: string; productId: string; categoryId: string;
                 quantity: number; unitPrice: number; lineTotal: number }>;
  customer: { customerId: string | null; isRegistered: boolean } | null;
  now: Date; // server clock only — §8.5
};

type CouponValidationResult =
  | { valid: true; couponId: string; code: string; discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
      discountValue: number; eligibleSubtotal: number; discountAmount: number; message: string }
  | { valid: false; message: string };
```

Evaluation order — exactly §8.6's seven checks, stopping at the first failure:

| # | Condition | Failure message (§8.22) |
| --- | --- | --- |
| 0 | Code found after trim + uppercase | `Invalid coupon code.` |
| 1 | `status = ACTIVE` and `is_archived = false` | `Invalid coupon code.` (identical to "not found" — §8.28 non-enumeration) |
| 2a | `now >= starts_at` | `This coupon is not active yet.` |
| 2b | `now <= expires_at` | `This coupon has expired.` |
| 3 | `usage_count < usage_limit` (if set) | `This coupon has reached its usage limit.` |
| 4 | per-customer count `< per_customer_limit` (if set) | `You have already used this coupon.` |
| 5 | customer eligibility satisfied | `This coupon is available only to registered customers.` |
| 6 | product/category eligibility | *skipped in v1* (§8.12) |
| 7 | eligible subtotal `>= minimum_order_amount` (if set) | `This coupon requires a minimum order of ৳{minimum_order_amount}.` |

Notes:

- Steps 0 and 1 return the identical message — a `DRAFT`, `DISABLED`, archived, or nonexistent code are all indistinguishable to the caller (§8.22, §8.28).
- The per-customer count (step 4) is `SELECT count(*) FROM coupon_usages WHERE coupon_id = $1 AND customer_id = $2` — this works identically for guests because a guest already has a `customers` row keyed by phone (§8.8). At preview time, if the guest hasn't supplied a phone yet, this step is skipped and deferred to order-creation time, where a customer reference always exists (this is the same rule the existing implementation-spec doc's Open Question #3 already resolves this way).
- `now` is always `new Date()` read on the Express process — no client-supplied timestamp ever reaches this function.

### The calculation chain (§8.14) — runs only after validation passes

```text
eligibleLines      = all lines (v1: ALL_PRODUCTS — §8.12)
eligibleSubtotal   = Σ lineTotal over eligible lines
PERCENTAGE:  discount = round(eligibleSubtotal × discount_value / 100)
             if maximum_discount_amount: discount = min(discount, maximum_discount_amount)
FIXED_AMOUNT: discount = min(discount_value, eligibleSubtotal)
discountedSubtotal = eligibleSubtotal − discount   (never below zero — §8.14b)
```

- All arithmetic in decimal (`numeric`), never floating point.
- `round` is half-up to 2 decimal places (matches the `numeric(12,2)` columns) — this is a deliberate choice so the same function produces byte-identical results at preview and at (future) order-creation revalidation; a difference of even one poisha would make spec 11's revalidation reject a legitimate order.
- Shipping is never an input here — it's added afterward by whichever caller composes the final total (§8.14c). This function returns only `eligibleSubtotal` and `discountAmount`.

---

## 3. `POST /api/coupons/validate` (§8.15a, §8.18)

Public, unauthenticated (a guest has no session), `rateLimit('couponValidate')` (already registered in `config/rateLimits.ts` — reused, not duplicated).

```ts
type ValidateCouponRequest = {
  code: string;
  lines: Array<{ variantId: string; quantity: number }>; // ids + quantities only — never prices/totals (§8.16)
};

type ValidateCouponResponse =
  | { valid: true; couponCode: string; discountType: 'percentage' | 'fixed_amount';
      discountAmount: number; eligibleSubtotal: number; message: string }
  | { valid: false; message: string };
```

- Request schema is Zod `.strict()` — a submitted `discountAmount`, `subtotal`, or `total` field is a `400 VALIDATION_ERROR`, not silently ignored (§8.16).
- The handler looks up current prices for the submitted variant IDs fresh from the catalogue (never trusts a client-submitted price), then calls `validateCoupon()`.
- Creates **no** `coupon_usages` row and increments nothing (§8.15a) — this is the defining property of a preview.
- Returns `200 { valid: false, message }` for a rejected coupon — a rejected coupon is not treated as an HTTP error, keeping §8.22's message table the single channel for customer-facing text.
- Never reveals remaining usage counts, the coupon's internal id, or why a disabled coupon was disabled.

Because there is no cart/session infrastructure yet (spec 09's cart persistence is a separate, potentially concurrent effort), this endpoint accepts the cart lines directly in the request body rather than reading a server-side cart — if spec 09 lands first, this call site should be revisited to read from the server-side cart, per the existing implementation-spec's stricter interpretation ("even less from the client — only the code").

---

## 4. `recordCouponUsage()` — §8.25, built but not yet called in production

`backend/src/repositories/coupon.repository.ts`, following `inventory.repository.ts`'s pattern exactly: takes an explicit `client: pg.PoolClient`, never opens its own transaction, so it can only ever run inside a caller-managed `withTransaction` block.

```ts
export async function recordCouponUsage(
  client: pg.PoolClient,
  input: { couponId: string; orderId: string; customerId: string; discountAmount: number; perCustomerLimit: number | null },
): Promise<{ ok: true } | { ok: false; reason: 'USAGE_LIMIT_REACHED' | 'PER_CUSTOMER_LIMIT_REACHED' }>;
```

Implementation, exactly per §8.25:

```sql
UPDATE coupons
   SET usage_count = usage_count + 1
 WHERE id = $1 AND (usage_limit IS NULL OR usage_count < usage_limit)
```

- Zero rows affected → the coupon hit its limit as of this instant → return `ok: false, reason: 'USAGE_LIMIT_REACHED'`. The caller (spec 11's order-creation service) must then roll back the whole order-creation attempt.
- The per-customer check re-counts `coupon_usages` inside the same transaction before inserting, so two concurrent orders from the same customer cannot both pass a `per_customer_limit: 1` coupon.
- The `coupon_usages` insert happens in the same transaction as the counter update — atomicity between the two, and between both and the order row itself, is guaranteed entirely by this function never being callable outside a transaction.

**This slice does not call this function from any route or controller.** It is fully implemented and covered by this slice's own tests (opening a transaction manually inside the test, calling the function, and asserting on commit/rollback behavior), so spec 11 has a proven, ready-to-import function the day checkout is built.

---

## 5. Admin routes (§8.18, §8.19)

All under `requireAuth('admin')`. Following the observed convention on `orders.routes.ts` (`validate` → `requirePermission` → optional `rateLimit` → controller):

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/api/admin/coupons` | `coupon.view` |
| `POST` | `/api/admin/coupons` | `coupon.create` |
| `GET` | `/api/admin/coupons/:id` | `coupon.view` |
| `PATCH` | `/api/admin/coupons/:id` | `coupon.update` |
| `POST` | `/api/admin/coupons/:id/status` | `coupon.status` |
| `DELETE` | `/api/admin/coupons/:id` | `coupon.delete` |
| `GET` | `/api/admin/coupons/:id/usages` | `coupon.usage.view` |

All six permission keys already exist in `types/permissions.ts` — no new keys, no new migration seed row needed. Activate/deactivate is a separate route (not folded into `PATCH`) because §5.18 gives it its own permission row (`Coupon Activate/Deactivate` = `coupon.status`) — collapsing it into `PATCH` would let a Manager with only `coupon.update` silently gain the ability to flip a coupon live.

### Admin service rules

- **Create/update** — normalize the code (trim + uppercase) before validation and storage; reject `maximum_discount_amount` on a `FIXED_AMOUNT` coupon; reject `expires_at <= starts_at`; reject a percentage value above 100; stamp `created_by`/`updated_by`; write an `audit_logs` row with previous/new values on every change (§5.15 rule 10).
- **Delete vs. archive (§8.9)** — `DELETE /:id` checks `coupon_usages` for that coupon inside a transaction: zero usages → hard delete (audited); one or more → refuse the delete and instead set `is_archived = true`, returning `200 { archived: true }` (not an error).
- **Derived display status (§8.6, §8.29)** — list/detail responses include a computed `displayStatus` alongside the stored `status`:

  ```ts
  displayStatus = is_archived ? 'ARCHIVED'
                : status !== 'ACTIVE' ? status              // DRAFT | DISABLED
                : now < starts_at ? 'SCHEDULED'
                : now > expires_at ? 'EXPIRED'
                : 'ACTIVE';
  ```

  `EXPIRED`/`SCHEDULED` never touch the stored `status` column.
- **Detail view (§8.30)** — every field, `usage_count` vs `usage_limit`, a count of distinct customers who used the coupon (aggregate only — no individual customer identities beyond what existing customer-view permissions already expose), and audit fields.

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Duplicate normalized code | 409 | `COUPON_CODE_EXISTS` |
| `maximum_discount_amount` on a fixed-amount coupon | 400 | `VALIDATION_ERROR` |
| `expires_at <= starts_at`, percentage > 100, non-positive value | 400 | `VALIDATION_ERROR` |
| Delete attempted on a used coupon | 200 | `{ archived: true }` |
| Coupon not found | 404 | `NOT_FOUND` |
| Validate: any rejection | 200 | `{ valid: false, message }` |
| Validate: rate limit exceeded | 429 | `RATE_LIMITED` |

---

## 6. Frontend work

### Admin — `/admin/marketing/coupons`

No CMS admin module exists yet to mirror (spec 17 is unbuilt), so the closest existing pattern to follow is the Orders admin module (`frontend/src/app/admin/(shell)/orders/`) for list/detail shape, and the Managers module (`.../managers/`, `.../managers/new/`, `.../managers/[id]/`) for the three-page create/edit/detail shape, since coupons need full CRUD unlike orders.

- Add a **Marketing / Discounts** group to `frontend/src/lib/admin/nav.ts`, with a `Coupons` entry gated by `requires: 'coupon.view'`.
- **List page** (`app/admin/(shell)/coupons/page.tsx`): Code | Discount | Status (incl. derived Expired/Scheduled/Archived) | Start | End | Usage (used/limit) | Customer Eligibility | Created By | Created Date — client-fetched via `apiList()` from `@/lib/apiClient`, same pattern as `orders/page.tsx`. Search by code/name, filter by status and discount type.
- **Create/edit page** (`app/admin/(shell)/coupons/new/page.tsx`, `app/admin/(shell)/coupons/[id]/page.tsx`): code, name, description, discount type (radio — selecting `FIXED_AMOUNT` hides/clears the maximum-discount field), value, minimum order amount, maximum discount, starts/expires date-time, usage limit, per-customer limit, customer eligibility. Product/category restriction fields are **hidden** in this slice per §8.12.
- **Detail view**: all fields, usage vs. limit, distinct-customer count, audit trail.
- All mutating controls check the actor's permissions client-side for UX only and handle a backend 403 gracefully — the backend `requirePermission` check is the real gate.

### Checkout coupon-entry component (built here, not yet mounted)

Built as a standalone component (e.g. `frontend/src/components/checkout/CouponField.tsx`) with no page to render it on yet:

```text
Discount / Coupon
[ Enter coupon code            ]  [ Apply ]
```

- Calls `POST /api/coupons/validate` on Apply.
- Success → shows the exact message and amount from the response; never recomputes locally.
- Failure → shows the returned §8.22 message verbatim.
- Applying a second code replaces the first with a confirmation prompt, re-validating fully.
- Holds only the coupon **code string** in its own state — the discount shown always comes from the last backend response.
- 44px input and Apply button height, explicit loading/error/success states, no horizontal scroll at 375px.

This component is exported and documented so spec 11 imports it directly into the real checkout page rather than rebuilding it.

---

## 7. Security requirements

- Every coupon decision is server-side (§8.16, §8.28) — the client never sends a discount, subtotal, or total; a `.strict()` Zod schema turns any such field into a 400.
- Preview is never authoritative — it writes nothing (§8.15a); (future) order creation revalidates from scratch (§8.15b, spec 11).
- Usage limits are transaction-safe — a single conditional `UPDATE`, never read-then-write (§8.25).
- Non-enumeration — nonexistent, `DRAFT`, `DISABLED`, and archived codes are byte-identical responses (§8.22, §8.28).
- Rate limiting via the existing `couponValidate` limiter, keyed per IP and per actor identity.
- Server time only — no client-supplied timestamp is ever accepted.
- RBAC — six distinct permission checks; activate/deactivate is separately gated from update.
- Database-level code uniqueness on the normalized value — a race between two concurrent creates cannot produce duplicate codes.
- `maximum_discount_amount` on a `FIXED_AMOUNT` coupon is structurally impossible via a `CHECK` constraint, not merely application-validated.
- Every create/update/status-change/delete/archive appends an `audit_logs` row with actor and previous/new values.
- Coupon codes are never protected by obscurity — hiding them in frontend code is not a substitute for the server-side checks above.

---

## 8. Tests — `backend/tests/spec-10-coupon/`

Confirm the exact folder-naming convention against what's on disk at implementation time (the codebase audit found the test-directory numbering does not always match the `.claude/implementation specs/NN-*.md` filename numbering 1:1 — e.g. fraud/risk-check is `spec-09-fraud-risk` on disk). Add `backend/config/vitest/spec10/vitest.config.ts` mirroring `spec09`'s shape and a `"test:spec10"` script in `backend/package.json`.

1. **Percentage calculation** (§8.14a) — the documented ৳2,500 → ৳500 case, the ৳300-cap case, and a rounding case (e.g. 7.5% of ৳1,333).
2. **Fixed-amount calculation** (§8.14b) — including the discount-exceeds-subtotal clamp to zero.
3. **Shipping is never an input** (§8.14c) — the engine's output is identical regardless of what the caller later adds as shipping.
4. **Minimum order boundary** (§8.10) — exactly at the minimum passes; one taka below fails with the exact message.
5. **Maximum discount cap boundary** (§8.10) — at and just above the cap.
6. **Validation order** (§8.6) — a coupon failing multiple conditions returns the earliest one's message (expired+min-order, disabled+expired, usage-limit+min-order).
7. **Lifecycle rejection** (§8.6) — `DRAFT`, `DISABLED`, archived, expired, and not-yet-started each produce the correct §8.22 message.
8. **Non-enumeration** (§8.22, §8.28) — nonexistent, disabled, and archived produce byte-identical responses.
9. **Customer eligibility** (§8.13) — `ALL_CUSTOMERS` works for a guest; `REGISTERED_CUSTOMERS_ONLY` rejects a guest with the specific message and accepts a registered customer.
10. **Total usage limit** (§8.8) — blocks the next attempt once reached.
11. **Per-customer usage limit** (§8.8) — enforced by `customer_id` for both registered and phone-keyed guest identity; a different guest phone is unaffected (the accepted residual risk per §8.28).
12. **Usage-limit concurrency** (§8.25) — two near-simultaneous `recordCouponUsage()` calls against a coupon with one use left; exactly one succeeds, the counter never exceeds the limit, exactly one usage row exists. Highest-value test in this slice.
13. **Per-customer concurrency** — two concurrent calls for one customer against `per_customer_limit: 1`; exactly one succeeds.
14. **Preview writes nothing** (§8.15a) — after a valid preview call, `usage_count` and `coupon_usages` are unchanged.
15. **Client-supplied economics rejected** (§8.16) — a validate request carrying a discount or subtotal field is a 400.
16. **Server time only** (§8.5) — a client-supplied timestamp field is rejected/ignored; expiry is evaluated against the server clock only.
17. **Code normalization** (§8.4a) — `save20`, ` SAVE20 `, and `Save20` resolve to the same coupon; the database rejects a duplicate under any casing.
18. **Fixed-amount coupons cannot carry a maximum** (§8.4b) — rejected at the API and by the `CHECK` constraint.
19. **Delete vs. archive** (§8.9) — unused deletes; used archives; an archived coupon fails validation regardless of `status`.
20. **Permission matrix rows** (§5.18, §8.19) — one test per coupon permission key, with the `Assigned` rows tested both ungranted and granted.
21. **Audit rows** written on create/update/status-change/delete.
22. **Rate limiting** — under the limit succeeds; over it returns 429.

`recordCouponUsage()`'s tests (12–13) open their own `withTransaction` in the test itself, since no production caller exists yet to exercise it through an HTTP request.

---

## 9. Acceptance criteria for this slice

1. `POST /api/admin/coupons` with `code: " save20 "` stores `SAVE20`; creating `save20` afterward returns `409 COUPON_CODE_EXISTS`.
2. A direct SQL insert of a second row with code `Save20` is rejected by the unique index on `upper(btrim(code))`.
3. Creating a `FIXED_AMOUNT` coupon with `maximum_discount_amount` set returns 400; a direct SQL insert of the same combination is rejected by the `CHECK`.
4. `\d coupons` shows a `coupon_status` enum with exactly `DRAFT`, `ACTIVE`, `DISABLED` — no `EXPIRED`.
5. An `ACTIVE` coupon whose `expires_at` has passed shows `displayStatus: 'EXPIRED'` in the admin list while `status` remains `ACTIVE`.
6. `POST /api/coupons/validate` with a nonexistent code, a `DRAFT` coupon, a `DISABLED` coupon, and an archived coupon all return byte-identical `{"valid":false,"message":"Invalid coupon code."}`.
7. A coupon before `starts_at` returns `This coupon is not active yet.`; after `expires_at` returns `This coupon has expired.`
8. A coupon both expired and below its minimum order returns the expired message (step 2 precedes step 7).
9. A coupon at its `usage_limit` returns `This coupon has reached its usage limit.`
10. A `REGISTERED_CUSTOMERS_ONLY` coupon applied by a guest returns the specific registered-only message, not the generic one.
11. 20% off a ৳2,500 eligible subtotal yields ৳500; with a ৳300 cap it yields ৳300.
12. A ৳500 fixed-amount coupon on a ৳200 subtotal yields a ৳200 discount, never negative.
13. `recordCouponUsage` on a coupon with `usage_limit = 1` and `usage_count = 1` returns `ok: false, reason: 'USAGE_LIMIT_REACHED'` and leaves `usage_count` at 1.
14. Two concurrent `recordCouponUsage` calls for the last redemption: exactly one succeeds, `usage_count` ends at `usage_limit`, and exactly one `coupon_usages` row exists.
15. `DELETE` on an unused coupon removes it; `DELETE` on a used coupon returns `{archived:true}` and leaves the row; a direct SQL delete of a used coupon is rejected by `ON DELETE RESTRICT`.
16. A Manager without `coupon.create` gets 403 on create and 200 on list; granting `coupon.create` flips only create.
17. A Manager with `coupon.update` but not `coupon.status` gets 403 on the status route and 200 on `PATCH`.
18. The admin coupon form shows no product/category restriction control.
19. Exceeding the coupon-validate rate limit returns 429.
20. At 375px width, the coupon field and Apply button are 44px tall with no horizontal scroll.
21. `grep -rn "recordCouponUsage(" backend/src` shows zero call sites outside its own repository file and tests — confirming this slice does not prematurely wire itself into a nonexistent checkout flow.

---

## 10. Follow-up work (not part of this slice — tracked for spec 11)

- Extend `orders.repository.ts::createOrder`'s signature and INSERT to accept and persist a real `coupon_id`.
- Call `recordCouponUsage()` inside spec 11's order-creation `withTransaction` block, immediately after the coupon is revalidated from scratch (§8.15b) and before the order row insert.
- Populate `coupon_usages.order_id` with the newly created order's id in the same transaction.
- Compose the final charged total (`discountedSubtotal + shipping`) for the bKash instruction amount and the COD amount (§8.16a/§8.16b).
- Mount the `CouponField` component built here on the real checkout page.
- Revisit `POST /api/coupons/validate`'s request shape if spec 09's server-side cart lands first — the endpoint could then read cart lines server-side instead of accepting them in the request body, which is a strictly stricter interpretation of §8.15a/§8.16.
- Wire the `Purchase` Meta event (spec 18) to use the order's final coupon-discounted total once both the `Purchase` subscriber (blocked on spec 12) and real coupon-discounted orders (blocked on spec 11) exist.

---

## Verification

1. Run the migration runner; confirm `0009_coupons.sql` applies cleanly against a disposable schema, `\d coupons` shows the expected columns/constraints/enum, and `orders_coupon_id_fkey` now exists on `orders`.
2. `npm run test:spec10` in `backend/` passes all test files listed above, including the two concurrency tests.
3. Manually create a coupon in the admin UI, list it, see the derived Expired/Scheduled label update correctly across its validity window, and confirm a Manager without `coupon.create` cannot reach the create form.
4. `POST /api/coupons/validate` against a running dev server: a valid code returns the exact §8.18a shape; an invalid one returns the exact §8.22 message; a request carrying a `discountAmount` field is rejected with 400.
5. `grep -rn "recordCouponUsage(" backend/src` — confirm zero call sites outside `repositories/coupon.repository.ts` and its own test file, proving this slice did not silently start depending on a checkout flow that doesn't exist.
