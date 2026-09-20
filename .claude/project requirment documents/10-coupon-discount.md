# Requirements — Coupon / Discount System

> Part of the requirements set — see [01-overview.md](01-overview.md) for the index. Builds on checkout ([02-customer.md](02-customer.md), [03-payment-order.md](03-payment-order.md)), the order state machine ([07-order-state-machine.md](07-order-state-machine.md)), RBAC ([06-rbac.md](06-rbac.md)), courier/COD amounts ([04-courier-shipment.md](04-courier-shipment.md)), and analytics ([08-analytics-meta.md](08-analytics-meta.md)).

## 8. Coupon / Discount System

### 8.1 Purpose and Scope

The platform supports Admin/Manager-managed coupon codes that customers can apply at checkout for a percentage or fixed-amount discount, subject to validity period, usage limits, and optional eligibility rules. This section defines the authoritative coupon data model, validation rules, discount-calculation order, and integration points with checkout, orders, payments, COD, courier, and analytics.

Coupons work identically for **guest customers** (Section 2.9) and **registered customers** — the same coupon engine, the same validation endpoint, and the same order-total calculation apply to both, per Section 8.20. An account is never required to use a coupon unless that specific coupon is configured with a "Registered Customers Only" eligibility rule (Section 8.11).

This feature does not introduce a new product/category system, a new customer-identity system, or a new authentication mechanism — it reuses the existing catalogue (Section 5.1), customer/guest model (Section 2.9.4), and RBAC (Section 06-rbac.md) as-is.

---

### 8.2 Admin Coupon Management — Navigation

Coupon management is added to the Admin back-office under a new **Marketing / Discounts → Coupons** section, alongside the existing CMS module (Section 5.8), following the existing Admin UI navigation conventions. This does not replace or restructure any existing back-office module.

Authorized Admin/Manager users (per the permissions in Section 8.19) can:

- Create a coupon
- View the coupon list
- View coupon details
- Edit a coupon
- Activate / deactivate a coupon
- Delete/archive a coupon (only where permitted — see Section 8.9)
- Search coupons (by code, name)
- Filter coupons (by status, discount type, validity)
- View coupon usage information

No separate admin authentication system is introduced — coupon management is gated by the existing RBAC system (Section 06-rbac.md), exactly as CMS and other operational modules are.

---

### 8.3 Coupon Fields

When creating or editing a coupon, Admin configures:

**Basic Information**
- `code` — the coupon code (Section 8.4)
- `name` — short display name
- `description` — optional longer description
- `status` — lifecycle state (Section 8.6)

**Discount**
- `discount_type` — `PERCENTAGE` or `FIXED_AMOUNT` (Section 8.4b)
- `discount_value` — the percentage (e.g. `10` for 10%) or the fixed amount in BDT (e.g. `100` for ৳100)
- `maximum_discount_amount` — optional cap, only meaningful for `PERCENTAGE` coupons (Section 8.10)

**Validity**
- `starts_at` — start date/time (Section 8.5)
- `expires_at` — end date/time (Section 8.5)

**Usage Limits**
- `usage_limit` — optional total usage cap (Section 8.8)
- `per_customer_limit` — optional per-customer usage cap (Section 8.8)

**Eligibility (optional, default = no restriction)**
- `minimum_order_amount` — optional minimum eligible subtotal (Section 8.10)
- Product/category eligibility (Section 8.12)
- Customer eligibility (Section 8.13)

**Audit**
- `created_by`, `created_at`, `updated_by`, `updated_at` (Section 8.24)

#### 8.4a Coupon Code Rules

Coupon codes must be:

- **Unique.** No two coupons may share the same normalized code (see next point) while either is not archived/deleted.
- **Case-normalized.** Codes are stored and compared in a single normalized case — uppercase — so `SAVE10` and `save10` always refer to the same coupon. The uniqueness constraint is enforced against the normalized (uppercase) value at the database level (a unique index on the normalized column), not only in application code.
- **Trimmed** of leading/trailing whitespace before normalization, storage, and comparison.
- **Validated server-side** on every create/edit and on every customer-facing application attempt — the frontend performing the same normalization for display purposes does not replace backend validation.

#### 8.4b Discount Types

Two discount types are supported:

| Type | `discount_value` meaning | Example |
| --- | --- | --- |
| `PERCENTAGE` | Percent off the eligible subtotal | `SAVE10` → 10% off |
| `FIXED_AMOUNT` | Fixed BDT amount off the eligible subtotal | `BDT100` → ৳100 off |

The two types are mutually exclusive per coupon — a coupon is either a percentage coupon or a fixed-amount coupon, never both. `maximum_discount_amount` (Section 8.10) only applies to `PERCENTAGE` coupons and must be ignored/rejected at creation time if set on a `FIXED_AMOUNT` coupon.

---

### 8.5 Validity Period

Admin defines `starts_at` and `expires_at` (date + time). Example:

```text
Coupon: SUMMER20
Discount: 20%
Valid From: 2026-10-01 00:00
Valid Until: 2026-10-15 23:59
```

Validity is evaluated using **server-side time only** (the Express backend's clock, sourced from the same time authority already used for OTP expiry in Section 2.5). The customer's browser clock is never trusted for validity decisions. A coupon automatically becomes unusable once server time passes `expires_at`, without any manual Admin action required — this is a computed condition evaluated at validation time (Section 8.6), not a background job that flips a stored status.

---

### 8.6 Coupon Status / Lifecycle

A coupon has a stored `status` field with these values:

```text
DRAFT
ACTIVE
DISABLED
```

- `DRAFT` — created but not yet activated; never usable by customers.
- `ACTIVE` — activated by Admin/Manager; usable by customers subject to all other conditions below.
- `DISABLED` — deactivated by Admin/Manager; never usable by customers, regardless of validity period or usage remaining.

`EXPIRED` is **not** a stored status value — it is a computed condition (`status === ACTIVE AND now() > expires_at`), evaluated at validation time and shown as a derived label in the Admin coupon list/detail UI (Section 8.29–8.30). Storing `EXPIRED` as a separate persisted status would require a background job to flip it and risks drifting out of sync with server time; deriving it keeps validity evaluation single-sourced from `starts_at`/`expires_at`/`status` at the moment of use, consistent with the "no trusted client clock, no scheduled status flips" principle already used for payment-rejection timeframes (Section 3.4) and risk-check caching (Section 09-fraud-risk-check.md 7.6).

A coupon is usable by a customer only when **all** of the following hold at validation time. The checks are evaluated **in this exact order, stopping at the first failure**; if multiple conditions would fail simultaneously (e.g. a coupon that is both expired and below its minimum order amount), the backend returns the message for whichever check appears first in this list, not an arbitrary or non-deterministic choice:

1. `status === ACTIVE AND is_archived === false` (Section 8.9 — an archived coupon is treated as not usable regardless of its `status` value)
2. `now() >= starts_at AND now() <= expires_at` (server time)
3. Total usage count `< usage_limit` (if `usage_limit` is set)
4. This customer's usage count for this coupon `< per_customer_limit` (if `per_customer_limit` is set)
5. Customer eligibility rule is satisfied (Section 8.13)
6. Product/category eligibility rule is satisfied, if configured (Section 8.12)
7. Eligible subtotal `>= minimum_order_amount` (if set) (Section 8.10)

If any condition fails, the coupon is rejected with the specific customer-facing message defined in Section 8.22 — never a generic failure for a condition the system can name specifically, except where Section 8.22 itself specifies a deliberately generic message for security reasons (e.g. "coupon not found" must not distinguish nonexistent from case-mismatched). An archived or `DISABLED` coupon (condition 1) and a nonexistent coupon code both return the same "Invalid coupon code" message (Section 8.22), so this ordering never leaks which specific condition-1 sub-case applied.

---

### 8.7 (reserved — see 8.6 for lifecycle; numbering continues at 8.8 to track the change-request's own section numbers)

### 8.8 Usage Limits

**Total usage limit** (`usage_limit`): once the coupon's total successful-use count (Section 8.26) reaches `usage_limit`, the coupon becomes unusable for all customers, even if otherwise valid.

**Per-customer usage limit** (`per_customer_limit`): once a specific customer's use count for that coupon reaches `per_customer_limit`, the coupon becomes unusable for that customer specifically (other customers are unaffected).

Customer identity for per-customer limits:

- **Registered customer:** the customer's account/customer ID (Section 2.1).
- **Guest customer:** the guest's internal customer reference (Section 2.9.4), keyed by phone number, exactly as already used for the customer-risk-check cache key (Section 09-fraud-risk-check.md 7.6). A guest who checks out multiple times with the **same phone number** is recognized as the same customer for coupon usage purposes; the system does not require an account to enforce this. This does not by itself prevent a guest from using a different phone number to obtain another use — see Section 8.28 (abuse prevention) for the accepted scope of what this system prevents versus what remains an accepted business risk in v1.

Both limits are enforced **server-side**, transaction-safely (Section 8.25), at order-creation time (Section 8.15), not only at the "Apply Coupon" preview step.

---

### 8.9 Delete / Archive

A coupon that has **never been used** (usage count `= 0`) may be permanently deleted by an Admin with the required permission (Section 8.19).

A coupon that **has been used at least once** cannot be deleted, because historical orders reference it (Section 8.23) and deleting it would break that historical record. Instead, it can only be **archived** (an additional boolean/status distinct from `DRAFT`/`ACTIVE`/`DISABLED`, e.g. `is_archived`), which removes it from the active coupon list/search results by default while preserving the row for historical order references. Archiving a coupon also implies it can no longer be activated or applied — an archived coupon behaves as `DISABLED` for validation purposes (Section 8.6) regardless of its `status` field value.

---

### 8.10 Minimum Order Amount and Maximum Discount

**Minimum order amount** (`minimum_order_amount`, optional): the coupon cannot be applied unless the customer's **eligible merchandise subtotal** (Section 8.14 — current product prices, before discount, excluding shipping) meets or exceeds this amount.

```text
Coupon: SAVE20 — 20% OFF — Minimum Order: ৳2,000
Cart eligible subtotal: ৳1,500
→ Coupon cannot be applied. Minimum order amount is ৳2,000.
```

If no minimum is configured, this check is skipped.

**Maximum discount amount** (`maximum_discount_amount`, optional, `PERCENTAGE` coupons only, Section 8.4b): caps the absolute discount a percentage coupon can produce.

```text
Discount: 20% — Maximum Discount: ৳500
Eligible subtotal: ৳4,000 → Calculated discount: ৳800 → Applied discount: ৳500 (capped)
```

If no maximum is configured, the percentage discount applies in full according to Section 8.14's calculation.

---

### 8.11 (see 8.13 — Customer Eligibility)

### 8.12 Product / Category Eligibility

The coupon data model supports an optional eligibility scope:

```text
ALL_PRODUCTS           (default)
SPECIFIC_PRODUCTS      (references existing product IDs, Section 5.1)
SPECIFIC_CATEGORIES    (references existing category IDs, Section 5.1)
```

This reuses the existing product/category tables (Section 5.1) via a join table (e.g. `coupon_products`, `coupon_categories`) — no duplicate product/category system is introduced.

**v1 scope decision:** Product/category-restricted coupons are part of the data model (so the schema does not need to change later) but are **optional to implement in the first release**. If not implemented in v1, every coupon behaves as `ALL_PRODUCTS` and the eligibility scope fields are simply unused; this must be documented in the coupon's Admin UI (e.g. the restriction fields are hidden or marked "coming soon") rather than exposing a control that silently does nothing. Coupon validation logic must not assume this feature exists prematurely — implementations that don't build it in v1 simply skip step 6 of Section 8.6's validation list.

When product/category restriction **is** implemented, the "eligible merchandise subtotal" (Section 8.14) used for the minimum-order check and discount calculation is limited to only the cart line items that match the restriction — not the full cart subtotal.

---

### 8.13 Customer Eligibility

The coupon data model supports an optional customer-eligibility scope:

```text
ALL_CUSTOMERS               (default)
REGISTERED_CUSTOMERS_ONLY
SPECIFIC_CUSTOMER           (references one existing customer/account ID)
```

**Default behavior:** unless the Admin explicitly configures a restriction, a coupon is usable by both guest and registered customers (`ALL_CUSTOMERS`). Coupons are never account-only by default.

If a coupon is configured `REGISTERED_CUSTOMERS_ONLY` and a guest attempts to apply it, the checkout must reject the coupon with the specific message defined in Section 8.22 ("available only to registered customers") rather than a generic invalid-coupon message, so the guest understands they can either log in/register or choose a different coupon — this does not force account creation to complete checkout itself (Section 8.20), only to use that specific coupon.

`SPECIFIC_CUSTOMER` is part of the data model for completeness (e.g. a customer-service-issued one-off coupon) but, like product/category restriction, may be treated as optional/future scope for the first implementation if not immediately required.

---

### 8.14 Discount Calculation Order

The backend recalculates the entire pricing chain from current data on every apply/validate and again at order creation (Section 8.15) — never trusting a frontend-submitted subtotal, discount, or total (Section 8.16):

```text
Cart Items
      ↓
Current Valid Product Prices  (looked up fresh from the catalogue, Section 5.1 — never trusted from the client)
      ↓
Eligible Items  (all items, unless product/category restriction narrows this — Section 8.12)
      ↓
Eligible Merchandise Subtotal  (sum of eligible item prices × quantity, before discount, excluding shipping)
      ↓
Coupon Validation  (Section 8.6)
      ↓
Discount Calculation  (Section 8.14a/8.14b)
      ↓
Discounted Merchandise Subtotal
      ↓
+ Shipping Charge  (not discounted by the coupon, per 8.14c)
      ↓
Final Order Total
```

#### 8.14a Percentage Discount

```text
discount = round(eligible_subtotal × discount_value / 100)
if maximum_discount_amount is set:
    discount = min(discount, maximum_discount_amount)
```

Example: subtotal ৳2,500, 20% off → discount ৳500. With a ৳300 cap configured, applied discount is ৳300.

#### 8.14b Fixed-Amount Discount

```text
discount = min(discount_value, eligible_subtotal)
```

The discount must never reduce the eligible merchandise subtotal below zero. Example: subtotal ৳200, coupon ৳500 OFF → applied discount ৳200 (capped at subtotal), discounted subtotal ৳0.

#### 8.14c Shipping Is Not Discounted (Default Rule)

Unless a future, explicitly separate business rule states otherwise, the coupon discount applies only to the eligible merchandise subtotal and never reduces the shipping charge. Shipping is added **after** the discount is applied:

```text
Product Subtotal: ৳3,000
Coupon: 10% OFF → Discount: ৳300
Discounted Subtotal: ৳2,700
Shipping: ৳100
Final Total: ৳2,800
```

This is a deliberate, documented v1 rule — it does not change shipping-fee calculation logic defined elsewhere in this document set (there is none to change; shipping fee computation is unaffected by this feature).

---

### 8.15 Checkout Integration and Order Creation

#### 8.15a Apply Coupon (Preview)

The checkout page (guest and registered, Sections 2.9 and 2.6) includes a coupon entry field:

```text
Discount / Coupon
[ Enter coupon code            ]  [ Apply ]
```

On **Apply**, the frontend sends the coupon code plus the current cart contents (product/variant IDs and quantities — not client-computed prices or totals) to a validation endpoint (`POST /api/coupons/validate`, Section 8.18). The backend performs the full validation and calculation chain (Sections 8.6, 8.14) using current server-side data and returns a preview result (Section 8.18a).

This preview is informational only — it must not create a coupon-usage record (Section 8.26) and must not be treated as authoritative by the order-creation step.

The customer can:
- See whether the coupon is valid and the resulting discount.
- Remove an applied coupon (returns cart/checkout to its pre-coupon state; the backend recalculates the total with no discount).
- Apply a different coupon, which **replaces** the currently-applied one (Section 8.17) rather than stacking.

#### 8.15b Order Placement — Mandatory Revalidation

When the customer places the order, the backend **must revalidate the coupon from scratch** — it does not reuse or trust the result of the earlier "Apply Coupon" preview call, since cart contents, prices, or the coupon's own validity/usage may have changed in the interim:

```text
Customer Clicks Place Order
        ↓
Backend Reloads Cart
        ↓
Recalculates Current Product Prices
        ↓
Re-validates Coupon (Section 8.6) Against Current Server Time / Usage / Eligibility
        ↓
Recalculates Discount (Section 8.14)
        ↓
Adds Shipping
        ↓
Computes Final Order Total
        ↓
Creates Order (existing flow, Sections 2.3/3)
```

If the coupon has become invalid between preview and placement (expired, deactivated, usage limit reached by a concurrent order, minimum order no longer met because the cart changed), order creation must fail with the specific validation message (Section 8.22) rather than silently placing the order without the discount or silently applying a different amount.

This does not change the existing pre-order validation branch by registered-vs-guest customer (Section 2.3, Section 3) — coupon revalidation is an additional step in the same order-creation transaction, not a replacement for it.

#### 8.15c Order Total Composition

The order record stores subtotal, discount, shipping, and final total as separate fields (extending the existing order total fields, Section 3.9/5.21.11 — no existing field is removed or repurposed):

```text
Subtotal:           ৳3,000
Coupon Discount:   -৳600
Shipping:            ৳100
--------------------------
Final Total:        ৳2,500
```

The final total is always computed server-side; this is the amount used for bKash payment (Section 8.16a) and COD collection (Section 8.16b).

---

### 8.16 Price and Discount Security

The backend never trusts a frontend-submitted subtotal, discount amount, or final total. This extends the existing principle already established for checkout validation (Section 2.3) and product pricing (Section 5.1) to the coupon feature specifically:

- The frontend may display a live preview computed from the `/api/coupons/validate` response, but that preview is never itself submitted back as the source of truth for order creation.
- Order creation always recomputes prices, eligible subtotal, discount, and total from current database state (Section 8.15b) — a modified/replayed browser request cannot change the discount or total actually charged.

#### 8.16a bKash Payment Amount

The amount the checkout page instructs the customer to send via bKash Send Money (Section 3.1) is the server-computed final order total **after** the coupon discount (Section 8.15c). No change to the existing manual bKash verification process (Section 3.1, 5.3) is required — the Admin/Manager verification step already compares the submitted transaction against "the order amount," which now unambiguously means the discounted final total.

#### 8.16b COD Amount

The COD amount displayed to the customer, collected by the courier, and sent to the courier at shipment creation (Section 4.4, Section 8.21) is likewise the server-computed final total after the coupon discount. Section 4.2/4.4's "Order amount" / "COD amount" fields are populated from this discounted final total, not the pre-discount subtotal.

---

### 8.17 Multiple Coupons

**v1 rule: only one coupon may be applied to an order at a time.** Coupons do not stack.

If a customer applies a second coupon while one is already applied, the second replaces the first (the checkout UI may confirm this, e.g. "Replace SAVE20 with WELCOME10?"); the backend revalidates the new coupon in full (Section 8.6) before accepting the replacement — it does not simply swap the code without re-running validation.

---

### 8.18 API Endpoints

Consistent with the existing REST API architecture (Section 01-overview.md 1.1) and the existing separation of Admin vs. customer-facing endpoints (e.g. Section 4.16, 09-fraud-risk-check.md 7.3):

**Admin (authenticated, RBAC-gated per Section 8.19):**

```text
POST   /api/admin/coupons
GET    /api/admin/coupons
GET    /api/admin/coupons/:id
PATCH  /api/admin/coupons/:id
DELETE /api/admin/coupons/:id       (only permitted per Section 8.9)
```

**Customer-facing (public; usable by guest and registered customers alike, per Section 8.20):**

```text
POST /api/coupons/validate
```

Admin coupon-management endpoints must never be reachable by a customer session or an unauthenticated request — enforced by the same backend authorization flow already used for other protected admin endpoints (Section 5.15). The customer-facing validate endpoint requires no authentication (a guest has no session) but must still apply the rate-limiting and safe-error-message rules already established for other public lookup endpoints (Section 2.9.7, 4.16) — see Section 8.28.

#### 8.18a Validate Response Shape

A successful validation response provides enough detail for the checkout UI, without being treated as authoritative for order creation (Section 8.16):

```text
valid: true
coupon_code: "SAVE20"
discount_type: "percentage"
discount_amount: 600
eligible_subtotal: 2400
message: "Coupon applied successfully. You saved ৳600."
```

An unsuccessful validation response returns `valid: false` and one of the messages defined in Section 8.22, never internal validation details (e.g. it does not reveal the exact stored `usage_limit` value beyond what the customer-facing message already implies).

---

### 8.19 RBAC

Coupon management uses the existing Admin/Manager role hierarchy (06-rbac.md) — no new role is introduced. The Section 5.18 permission matrix in **06-rbac.md is the single authoritative table** for these permission rows (Section 5.16's mapping rule); this section does not restate the matrix values, only the permission-key mapping and the rationale for the defaults, to avoid two independently-editable copies of the same data drifting apart:

| Administrative Action | Permission Key | 5.18 Matrix Row |
| --- | --- | --- |
| Coupon View | `coupon.view` | Coupon View |
| Coupon Create | `coupon.create` | Coupon Create |
| Coupon Update | `coupon.update` | Coupon Update |
| Coupon Activate/Deactivate | `coupon.status` | Coupon Activate/Deactivate |
| Coupon Delete/Archive | `coupon.delete` | Coupon Delete/Archive |
| Coupon Usage View | `coupon.usage.view` | Coupon Usage View |

See 06-rbac.md Section 5.18 for the current Admin/Manager value in each row. Coupons are treated as a marketing/pricing-configuration capability — closer in risk profile to CMS Management (`Assigned` for Manager) than to routine order operations (`Yes` for Manager). Accordingly, creating, editing, and enabling/disabling coupons default to `Assigned` for Manager, consistent with how CMS Management is already gated; a Manager not explicitly granted these permissions cannot manage coupons, while `coupon.view` and `coupon.usage.view` default to `Yes` for Manager (like other read/reporting permissions such as Order View and Shipment View) since visibility into active promotions and their usage is routine operational information.

All existing RBAC rules continue to apply unchanged: Manager cannot grant itself these permissions, Admin cannot grant a Manager a permission Admin does not itself possess (Section 5.15 rule 6), and every permission-changing action is authorized and audit-logged (Section 5.15 rules 9–10). No Staff role or new role tier is introduced by this feature (Section 5.10, 5.19 remain unchanged).

---

### 8.20 Guest vs. Registered Checkout — Identical Engine

The same coupon validation and discount-calculation engine (Sections 8.6, 8.14–8.16) is used for both guest checkout (Section 2.9) and registered-customer checkout (Section 2.6) — there is no separate guest coupon logic.

```text
                    ADMIN
                      ↓
                Create Coupon → Configure Discount → Set Validity → Activate
                      ↓
          ┌───────────┴───────────┐
          ↓                       ↓
       GUEST                  REGISTERED
          ↓                       ↓
       Checkout                Checkout
          ↓                       ↓
       Coupon Code             Coupon Code
          ↓                       ↓
   POST /api/coupons/validate (same endpoint, same logic)
          ↓                       ↓
       Discount               Discount
          └───────────┬───────────┘
                      ↓
               Final Order Total (Section 8.15c)
                      ↓
                bKash / COD (Section 8.16a/8.16b)
                      ↓
                 Place Order (Section 8.15b)
                      ↓
             Existing Order Flow (Sections 3, 5.21)
                      ↓
               Courier Shipment (Section 8.21)
```

The only difference between the two paths is the customer-identity input to the per-customer usage check (Section 8.8: account ID vs. phone-number-keyed guest reference) and, where configured, the `REGISTERED_CUSTOMERS_ONLY` eligibility check (Section 8.13) — both are branches inside the same validation function, not separate implementations.

A guest is never required to create an account to use a normal (non-restricted) coupon. This does not change the existing guest checkout flow (Section 2.9) beyond adding the coupon entry step.

---

### 8.21 Courier Impact

Courier shipment creation (Section 4.2, 4.4) continues to send the order's amount fields exactly as already specified — no new field is introduced. The existing "Order amount" and "COD amount" values sent to the courier are now sourced from the coupon-discounted final total (Section 8.16b) rather than a pre-discount subtotal, in exactly the same place in the existing flow where those fields were already populated from the order record. No change to the courier service abstraction (Section 4.9), courier adapters, or the courier API integration itself is required.

---

### 8.22 Customer-Facing Validation Messages

| Condition | Message |
| --- | --- |
| Success | `Coupon applied successfully. You saved ৳{amount}.` |
| Coupon does not exist / bad code | `Invalid coupon code.` |
| Not yet started | `This coupon is not active yet.` |
| Expired | `This coupon has expired.` |
| Disabled/archived | `Invalid coupon code.` (same as nonexistent — Section 8.28: do not reveal that a code once existed) |
| Total usage limit reached | `This coupon has reached its usage limit.` |
| Per-customer usage limit reached | `You have already used this coupon.` |
| Minimum order not met | `This coupon requires a minimum order of ৳{minimum_order_amount}.` |
| Product/category not eligible | `This coupon is not valid for the products in your cart.` |
| Registered-customers-only, guest attempting | `This coupon is available only to registered customers.` |

Messages must not expose internal validation logic beyond what is listed here (e.g. never reveal the exact remaining usage count, the coupon's internal ID, or why a `DISABLED` coupon was disabled).

---

### 8.23 Order Record — Historical Discount Data

To keep historical order totals accurate regardless of later coupon changes (Section 8.9, 8.6), the order record retains, at the time the order is created (Section 8.15b):

```text
coupon_id            (reference to the coupon used, may become archived/disabled later)
coupon_code          (denormalized snapshot of the code at time of use)
discount_type        (snapshot: PERCENTAGE or FIXED_AMOUNT)
discount_amount      (the actual BDT amount applied to this order)
eligible_subtotal    (snapshot of the subtotal the discount was calculated against)
```

An order's stored `discount_amount` and `eligible_subtotal` are never recalculated using the coupon's current configuration after the order is created — even if the coupon is later disabled, expired, edited, or archived, the historical order continues to show exactly the discount that was actually applied at checkout. This extends the existing principle that already governs order totals (Section 5.21.11's audit trail: previous status, new status, timestamp are permanent records, not recomputed).

This does not add new order-status values or change the order state machine (Section 5.21) — discount fields are additional order attributes alongside the existing subtotal/shipping/total fields (Section 3.9), not new statuses.

---

### 8.24 Database Model

#### 8.24a `coupons` table

```text
id
code                        (unique, normalized uppercase, trimmed — Section 8.4a)
name
description
discount_type               (PERCENTAGE | FIXED_AMOUNT)
discount_value
minimum_order_amount        (nullable)
maximum_discount_amount     (nullable; PERCENTAGE only)
starts_at
expires_at
usage_limit                 (nullable = unlimited)
usage_count                 (denormalized counter, kept consistent via the transaction-safe update in Section 8.25; the coupon_usages table, 8.24b, remains the source of truth)
per_customer_limit          (nullable = unlimited)
customer_eligibility        (ALL_CUSTOMERS | REGISTERED_CUSTOMERS_ONLY | SPECIFIC_CUSTOMER)
eligible_customer_id        (nullable; used only when customer_eligibility = SPECIFIC_CUSTOMER)
product_eligibility         (ALL_PRODUCTS | SPECIFIC_PRODUCTS | SPECIFIC_CATEGORIES — Section 8.12, optional for v1)
status                      (DRAFT | ACTIVE | DISABLED — Section 8.6)
is_archived                 (boolean, default false — Section 8.9)
created_by
created_at
updated_by
updated_at
```

A unique index on the normalized `code` column enforces Section 8.4a at the database level. `EXPIRED` is intentionally not a value of `status` (Section 8.6).

#### 8.24b `coupon_usages` table

Rather than relying only on the `usage_count` integer, a usage record is kept per redemption for auditability and accurate per-customer limit enforcement:

```text
id
coupon_id
order_id
customer_id           (NOT NULL — every order has an internal customer reference, whether a registered account or a guest reference per Section 2.9.4; there is no order with no customer_id at all)
discount_amount       (the amount actually applied to that order)
used_at
```

Per-customer usage limit (Section 8.8) is enforced by counting rows in this table for `(coupon_id, customer_id)`, not by a separate per-customer counter column — this avoids a second denormalized counter to keep in sync.

#### 8.24c `coupon_products` / `coupon_categories` (optional, only if Section 8.12 is implemented)

```text
coupon_id, product_id      -- coupon_products
coupon_id, category_id     -- coupon_categories
```

These reference the existing product/category tables (Section 5.1) by ID; no product/category data is duplicated.

---

### 8.25 Coupon Usage Must Be Transaction-Safe

Because two customers may attempt to use the last remaining redemption of a limited coupon concurrently, incrementing `usage_count` and inserting the `coupon_usages` row (Section 8.24) must happen atomically with an enforced ceiling, consistent with the atomic check-and-decrement pattern already required for stock at order confirmation (Section 5.1):

```sql
UPDATE coupons
SET usage_count = usage_count + 1
WHERE id = $1 AND (usage_limit IS NULL OR usage_count < usage_limit)
```

If this conditional update affects zero rows, the coupon has reached its usage limit as of this instant and the order-creation transaction must fail with the "usage limit reached" message (Section 8.22) — it must not proceed to create the order with a discount that can no longer be honored. This check, the per-customer count check, and the `coupon_usages` insert happen inside the same database transaction as order creation (Section 8.15b), so a failure at any step rolls back the whole attempt rather than leaving an order created without a corresponding usage record, or a usage record without an order.

---

### 8.26 Usage Timing — When a Coupon Is "Used"

A coupon usage (the `coupon_usages` row and the `usage_count` increment, Section 8.24–8.25) is recorded when the order is **successfully created** (Section 8.15b), at the same point the order row itself is inserted — not when the customer clicks "Apply Coupon" (Section 8.15a, preview only) and not gated behind a later status transition such as `CONFIRMED`.

This differs from the Purchase-analytics-event timing rule (Section 08-analytics-meta.md 6.3, which fires on `CONFIRMED`) and from the stock-decrement timing rule (Section 5.1, which also happens at `CONFIRMED`) — those two are deliberately deferred to avoid counting abandoned/rejected orders. Coupon usage is recorded earlier, at order creation, because:

- Order creation already requires the coupon to have passed full validation (Section 8.15b) at that exact moment, so a usage recorded here is never a usage against an invalid coupon.
- Deferring usage recording to `CONFIRMED` would let the same coupon be validated as "not yet at its limit" by multiple concurrent unconfirmed orders, oversubscribing a limited coupon in a way the atomic check in Section 8.25 is specifically designed to prevent.

Applying a coupon at the preview step (Section 8.15a) without completing checkout never consumes a usage — only a created order does. Admin/Manager coupon-usage inventory reservation beyond this rule is out of scope for v1; if a future business need requires holding a reservation before order creation, that must be defined as a separate, explicit mechanism.

---

### 8.27 Payment Failure and Cancellation/Return Interaction

**bKash payment rejection (Section 3.4, 5.21.2):** A coupon usage recorded at order creation (Section 8.26) is **not** reversed when a submitted bKash payment is later rejected and the customer resubmits (Section 5.21.2) — the order (and its coupon usage) already exists; resubmitting payment information is a new payment attempt against the *same* order, not a new order and not a new coupon usage. The order's `discount_amount`/`coupon_id` (Section 8.23) remain unchanged through payment rejection/resubmission cycles.

**Order cancellation (Section 5.21.7) or return (Section 5.21.6):** Consistent with the accepted v1 rule for stock (Section 5.1's restoration rule is the one exception already defined for stock specifically), **coupon usage is not automatically restored** when an order is cancelled or returned. The coupon's `usage_count` and the customer's `coupon_usages` row remain as recorded at order creation. If the business wants to release a coupon use back to a customer after a cancellation, that requires a specific Admin-initiated coupon-management action (e.g. a manual usage-record deletion with audit trail) — no such automatic mechanism is included in v1. This is an explicit, documented business rule, not an oversight (per the change request's requirement not to leave this behavior undefined).

This asymmetry (stock is restored on cancel/return per Section 5.1, coupon usage is not) is intentional: stock is a physical inventory fact that must reconcile with reality, while a coupon usage is a marketing-budget consumption event tied to the customer's redemption action, which already occurred regardless of the order's ultimate fulfillment outcome.

---

### 8.28 Abuse Prevention

Consistent with the security principles already established for guest order lookup (Section 2.9.7), Track Order (Section 4.16), and OTP requests (Section 2.5), the coupon system:

- Validates everything server-side (Section 8.16) — no coupon decision is ever made client-side only.
- Enforces unique, normalized coupon codes (Section 8.4a) at the database level.
- Enforces total and per-customer usage limits transaction-safely (Section 8.8, 8.25).
- Enforces expiration using server time only (Section 8.5).
- Enforces minimum-order and eligibility rules server-side (Section 8.6, 8.10, 8.12, 8.13).
- Revalidates at order creation, not just at preview (Section 8.15b).
- Rate-limits the `POST /api/coupons/validate` endpoint per source IP and, where a customer/guest identity is available, per customer, reusing the same rate-limiting approach as Section 2.5/2.9.7/4.16, to prevent brute-forcing valid coupon codes.
- Returns the same generic "Invalid coupon code" message for both a nonexistent code and a disabled/archived one (Section 8.22), so the endpoint cannot be used to enumerate which codes once existed.

**Accepted residual risk (v1):** a guest who checks out with a different phone number each time can obtain multiple uses of a `per_customer_limit: 1` coupon, since guest identity is keyed by phone number (Section 8.8) and there is no mandatory identity verification for guest checkout (Section 2.9) beyond what already exists. This is the same accepted trade-off already implicit in guest checkout generally (Section 2.9) and is not a gap introduced by this feature; hardening guest identity verification further is out of scope here and would need to be addressed, if ever required, as a change to guest checkout itself (Section 2.9), not to the coupon system.

Coupon information (e.g. active codes) is never treated as protected by obscurity — hiding it in frontend JavaScript is not a substitute for the server-side checks above.

---

### 8.29 Admin Coupon List

The Admin coupon list displays, consistent with existing Admin UI conventions (e.g. the Order Management list, Section 5.2):

```text
Coupon Code | Discount | Status (incl. derived Expired) | Start Date | End Date | Usage (used/limit) | Customer Eligibility | Created By | Created Date
```

Example:

| Code | Discount | Status | Valid Until | Usage |
| --- | ---: | --- | --- | ---: |
| SAVE20 | 20% | Active | 2026-10-15 | 34 / 100 |
| BD300 | ৳300 | Expired | 2026-09-01 | 100 / 100 |

"Expired" here is the derived label from Section 8.6, not a stored value. Supports search (by code/name) and filter (by status, discount type) per Section 8.2.

---

### 8.30 Admin Coupon Details

The coupon detail view shows every field in Section 8.3/8.24a, plus:

- Current usage count vs. `usage_limit`
- Aggregate per-customer usage summary (e.g. count of distinct customers who have used it), without exposing full customer personal details beyond what Section 5.7's existing customer-view permissions already allow — no new customer-data exposure is introduced by the coupon feature.
- Audit fields: created by/at, last updated by/at (Section 8.24, 06-rbac.md audit conventions).

---

### 8.31 Analytics Impact

Per the existing Meta Pixel/CAPI requirements (08-analytics-meta.md), the `InitiateCheckout`, `AddPaymentInfo`, and `Purchase` events continue to use the order's actual value:

- `InitiateCheckout`/`AddPaymentInfo` fired during checkout (Section 6.2) should reflect the current server-computed total at the time of firing, including any applied coupon discount, consistent with the existing rule that these values come from the order/cart record rather than a client-computed figure (Section 6.5).
- `Purchase` continues to fire only when the order transitions to `CONFIRMED` (Section 6.3 — this rule is unchanged by this feature) and must use the order's final, coupon-discounted total (Section 8.15c) as its `value`, not the pre-discount subtotal.

No new event type is introduced for coupon application; "a coupon was applied" is reflected purely through the discounted `value` already flowing through the existing events, keeping the event schema and timing exactly as defined in 08-analytics-meta.md.

---

### 8.32 Acceptance Criteria

**Admin**
- [ ] Admin/Manager (per RBAC, Section 8.19) can create, edit, activate, deactivate, and (where permitted) delete/archive coupons.
- [ ] Percentage and fixed-amount discount types are both supported and mutually exclusive per coupon.
- [ ] Start/end date-time, optional minimum order amount, optional maximum discount, total usage limit, and per-customer usage limit are all configurable.
- [ ] Coupon usage and details are viewable in the Admin panel.

**Customer**
- [ ] Guest and registered customers can both apply a coupon at checkout via the same engine.
- [ ] Customers can remove an applied coupon and see the recalculated total.
- [ ] Invalid, expired, disabled, usage-exhausted, and eligibility-mismatched coupons are rejected with the specific messages in Section 8.22.

**Security**
- [ ] All coupon validation and discount calculation is server-side; the frontend cannot manipulate the discount or total (Section 8.16).
- [ ] Coupon usage recording is transaction-safe (Section 8.25) and cannot be bypassed to exceed usage limits.
- [ ] Order creation revalidates the coupon from scratch (Section 8.15b).

**Orders / Payments / Courier**
- [ ] The order stores the applied coupon reference, discount type, discount amount, and eligible subtotal (Section 8.23), immutable after creation.
- [ ] bKash payment amount and COD amount both reflect the discounted final total (Section 8.16a/8.16b).
- [ ] The order state machine (Section 5.21) is unchanged by this feature.

**Analytics**
- [ ] `Purchase` value reflects the discounted final total; event timing is unchanged (Section 8.31).

---

### 8.33 Explicitly Unchanged

This feature does not modify: the technology stack (01-overview.md), the order/payment/shipment state machine enum or transitions (07-order-state-machine.md), the courier service abstraction or adapters (Section 4.9), bKash/COD verification mechanics (Section 3), guest checkout's required fields (Section 2.9.2), the RBAC role hierarchy (Admin/Manager, Section 5.10–5.11), the customer-risk-check feature (09-fraud-risk-check.md), or the Meta Pixel/CAPI event schema and firing rules beyond the `value` field (08-analytics-meta.md).
