# 21 — Shipping Fee Computation

## Goal

After this slice the platform has exactly one authority for "what does delivery cost for this order": `computeShipping()`. It is the only function that may produce the `shipping_amount` written to an order, and it is configured through an admin-managed zone/rate table rather than a hard-coded constant.

This spec exists because **no PRD file defines shipping-fee computation**. `10-coupon-discount.md` §8.14c adds "+ Shipping Charge" to the total chain and states outright that "there is none to change; shipping fee computation is unaffected by this feature"; `04-courier-shipment.md` §4.2 sends an order amount to couriers without saying how delivery cost is derived. Every worked example in the PRDs uses a flat ৳100.

Because the number affects **every order total, the bKash amount the customer is told to send (§8.16a), and the COD amount the courier collects (§8.16b)**, it cannot stay an unowned constant. This spec pins the mechanism and the data model; the *rates* remain a business input the client sets without a code change.

**This spec adds no requirement to the PRD set.** It implements the one piece the PRDs assume exists. Where a future PRD defines a shipping rule, that PRD wins (CLAUDE.md §1) and this spec's table is the place it lands.

---

## Requirement references

- `10-coupon-discount.md` §8.14c — shipping is **never** discounted by a coupon and is added **after** the discount; shipping is not part of `eligible_subtotal`.
- `10-coupon-discount.md` §8.10 — `minimum_order_amount` tests the merchandise subtotal **excluding shipping**; adding shipping must never help a coupon qualify.
- `10-coupon-discount.md` §8.15c — the stored total composition `total = subtotal - discount + shipping`.
- `10-coupon-discount.md` §8.16a/§8.16b — the bKash amount and the COD amount are the **discounted final total**, which includes shipping.
- `03-payment-order.md` §3.9 — the order stores subtotal, discount, shipping, and total as separate amount fields.
- `02-customer.md` §2.2, §2.9.2 — the address model (Division, District, Upazila/Thana, Union/Ward + discriminators) that zone resolution reads.
- `04-courier-shipment.md` §4.2 — the order amount passed to the courier.
- `05-admin-operations.md` §5.1, `06-rbac.md` §5.16, §5.18 — admin management of the rate table is an administrative action under `system.configure`.
- `11-security-hardening.md` §11.4 — server-side computation only; the client never supplies a shipping amount.

---

## Depends on

- **01** — config loading, error taxonomy, migration runner.
- **02** — the address columns (`division`, `district`) zone resolution reads; `audit_logs`.
- **03** — `requirePermission()` for the admin endpoints.
- **09** — `resolveCartForPricing()` supplies the merchandise subtotal this function may read.

**Consumed by 11** (the order-creation transaction) and, through the stored `orders.shipping_amount`, by 12, 13, 14 and 20. Build this **before 11**, or build 11's `computeShipping()` as the stub it already describes and replace it here.

---

## Scope

**In scope**

- A `shipping_zones` + `shipping_rates` schema, seeded with a working default.
- `computeShipping(input): ShippingQuote` — pure, server-side, deterministic.
- Free-shipping threshold support (the one promotional lever merchants ask for first).
- Admin CRUD for zones and rates, audited, behind `system.configure`.
- Exposure of the quote to checkout via the existing `GET /api/checkout/config` and the cart/checkout pricing response.

**Out of scope**

- **Courier-quoted live rates.** §4.2 sends an amount *to* the courier; no PRD has the platform pulling a price *from* one at checkout. The adapter interface is left untouched (§8.33's "explicitly unchanged" discipline).
- **Weight/dimension-based pricing.** No PRD models product weight. Adding it later means one new `strategy` value and a weight column on products, with no migration of existing rows (Open questions 4) — but v1 does not compute on it.
- **Discounting shipping.** §8.14c forbids it in v1. Free-shipping thresholds are a *shipping rule*, not a coupon effect — see the note under `FREE_OVER_THRESHOLD`.

---

## Database changes

### `shipping_zones`

| Column | Type | Constraints | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | PK | `gen_random_uuid()` | |
| `code` | `text` | NOT NULL, UNIQUE | — | `INSIDE_DHAKA`, `DHAKA_SUBURB`, `OUTSIDE_DHAKA` in the seed |
| `name` | `text` | NOT NULL | — | Display label shown at checkout |
| `is_default` | `boolean` | NOT NULL | `false` | The fallback zone when no rule matches |
| `sort_order` | `integer` | NOT NULL | `0` | Admin display order |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **`CREATE UNIQUE INDEX ON shipping_zones ((is_default)) WHERE is_default`** — exactly one default zone can exist. This is what makes "every address resolves to some zone" a structural guarantee rather than a hope.

### `shipping_zone_districts`

Maps an address to a zone by district — the coarsest unit that is both present in the §2.2 address model and meaningful for Bangladesh courier pricing.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `zone_id` | `uuid` | NOT NULL, FK → `shipping_zones(id)` ON DELETE CASCADE | |
| `district` | `text` | NOT NULL | Matched case-insensitively against `addresses.district` |
| `metro_only` | `boolean` | NOT NULL, default `false` | When true the rule applies only if the address discriminator says metropolitan (Thana/Ward), which is how "Dhaka city" is separated from "Dhaka district" |

- **PK `(district, metro_only)`** — one district cannot map to two zones at the same metro specificity, so resolution can never be ambiguous.
- Index on `zone_id`.

### `shipping_rates`

One active rate row per zone. Kept separate from the zone so a rate change is an insert with history, not a destructive update.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | PK | |
| `zone_id` | `uuid` | NOT NULL, FK → `shipping_zones(id)` | |
| `strategy` | `text` | NOT NULL, `CHECK (strategy IN ('FLAT','FREE','FREE_OVER_THRESHOLD'))` | |
| `flat_amount` | `numeric(12,2)` | NOT NULL, `CHECK (flat_amount >= 0)` | The charge; `0` when `FREE` |
| `free_over_amount` | `numeric(12,2)` | NULL, `CHECK (free_over_amount IS NULL OR free_over_amount >= 0)` | Required iff `strategy = 'FREE_OVER_THRESHOLD'` |
| `effective_from` | `timestamptz` | NOT NULL, default `now()` | |
| `created_by` | `uuid` | NULL, FK → `users(id)` | |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

- **`CHECK ((strategy = 'FREE_OVER_THRESHOLD') = (free_over_amount IS NOT NULL))`** — the threshold is all-or-nothing, mirroring §8.4b's treatment of `maximum_discount_amount`.
- Index on `(zone_id, effective_from DESC)` — backs "the current rate for this zone".
- Rates are **never deleted**; superseding means inserting a newer `effective_from`. This preserves the ability to explain a historical order's shipping amount, the same reasoning §8.23 applies to coupon snapshots.

### Seed

Matching the PRDs' own worked examples (৳100 appears in §8.14c and §8.15c) so the default configuration reproduces the documented numbers:

| Zone | Districts | Strategy | Amount |
| --- | --- | --- | --- |
| `INSIDE_DHAKA` | Dhaka (`metro_only = true`) | `FLAT` | ৳60 |
| `DHAKA_SUBURB` | Dhaka (`metro_only = false`), Gazipur, Narayanganj | `FLAT` | ৳100 |
| `OUTSIDE_DHAKA` | *(default zone — no district rows)* | `FLAT` | ৳120 |

The client changes these in the admin UI. **The seed is a starting point, not a business decision** — it is flagged for client confirmation in "Open questions".

### `orders`

No new column. Spec 11 already defines `shipping_amount` and the structural `CHECK (total_amount = subtotal - discount_amount + shipping_amount)`. This spec only decides what goes in it.

Add one snapshot column for explainability:

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `shipping_zone_code` | `text` | NULL | The zone code used at order time; snapshot, never recalculated (§8.23's pattern) |

---

## Backend work

### `computeShipping()`

```ts
type ShippingInput = {
  address: { division: string; district: string; isMetropolitan: boolean };
  merchandiseSubtotal: number;   // AFTER coupon discount — see the ordering note below
  now: Date;                     // server clock only (§8.5's discipline)
};

type ShippingQuote = {
  zoneCode: string;
  zoneName: string;
  amount: number;                // >= 0, 2dp
  freeShippingApplied: boolean;
  freeShippingRemaining: number | null;  // for the "spend ৳X more" checkout hint
};

function computeShipping(input: ShippingInput): ShippingQuote;
```

**Resolution order** — first match wins, and the last step cannot fail:

1. Look up `shipping_zone_districts` where `lower(district) = lower(address.district)` **and** `metro_only = true`, if `address.isMetropolitan`.
2. Else look up the same district with `metro_only = false`.
3. Else the zone where `is_default` — guaranteed to exist by the partial unique index.

**Step 3 is a safe fallback, but it is never silent.** Until a Division/District reference dataset exists (spec 02, assumption 2), `addresses.district` is free text, so a misspelt or unrecognised district resolves to the default zone and may undercharge the order. Falling through to step 3 therefore **logs a `shipping.zone_unmatched` warning with the unmatched district string and the resolved order id**, and the Admin shipping-zone screen surfaces a list of the distinct unmatched values seen. That turns a silent pricing leak into a visible, fixable data problem: the operator adds the missing spelling as a `shipping_zone_districts` row and the leak closes. Checkout is **never blocked** by an unmatched district — failing a customer's order over a spelling is worse than charging the default rate.

Then take the newest `shipping_rates` row for that zone with `effective_from <= now`, and apply:

- `FLAT` → `amount = flat_amount`
- `FREE` → `amount = 0`
- `FREE_OVER_THRESHOLD` → `amount = merchandiseSubtotal >= free_over_amount ? 0 : flat_amount`

Rounded half-up to 2 decimal places, consistent with the rounding rule fixed in spec 10.

**Which subtotal feeds the threshold.** `merchandiseSubtotal` is the subtotal **after** the coupon discount. This is the conservative reading: it never lets a discount push an order over a free-shipping line the customer did not actually pay for, and it keeps shipping a strict function of money actually spent on merchandise. It does **not** violate §8.14c — the coupon still never *reduces* the shipping charge; the threshold is a shipping-side rule evaluated on a value the discount happens to affect. Flagged in "Open questions" as the one judgement call here.

**Ordering inside the order-creation transaction (spec 11).** Shipping is computed **after** the coupon is revalidated and the discount is final, and **never** before:

```text
subtotal → validate coupon → discount → computeShipping(subtotal - discount) → total
```

This is exactly §8.14c's "shipping is added after the discount is applied" and §8.10's "minimum order amount excludes shipping" — the coupon engine never sees a shipping figure, so shipping can never help a coupon qualify.

### Endpoints

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/shipping/quote` | public | Body-less; takes `district` + `isMetropolitan` + current cart. Rate-limited under the existing `publicCeiling` limiter (spec 04). Advisory only — never trusted at order creation. |
| `GET` | `/api/admin/shipping/zones` | `system.configure` | Zones with their current rate. |
| `POST` / `PATCH` | `/api/admin/shipping/zones` | `system.configure` | Create/update zone + district mappings. |
| `POST` | `/api/admin/shipping/zones/:id/rates` | `system.configure` | Insert a new rate (supersede, never mutate). |

Every admin write records an `audit_logs` entry with before/after values (§5.16, §11.7) — a shipping-rate change moves money and must be attributable.

`GET /api/checkout/config` (spec 11) gains the resolved quote for the customer's current address, so the checkout page never hard-codes or guesses a figure.

---

## Frontend work

- **Cart page** — shipping shown as "Calculated at checkout" until an address/district is known. Never guessed client-side.
- **Checkout** — the quote refreshes when the district or metro discriminator changes, displayed as its own line in the §8.15c breakdown: `Subtotal / Discount / Shipping / Total`.
- **Free-shipping hint** — when `freeShippingRemaining` is non-null, show "Add ৳X more for free delivery". Purely informational.
- **Admin → Settings → Shipping** — zone list, district assignment, rate editor with an explicit "this changes what customers are charged from now on" confirmation.

Per CLAUDE.md §8: plain tabular layout, no decorative treatment.

---

## Security requirements

- **The client never supplies a shipping amount.** The checkout request schema stays `.strict()` (spec 11) and rejects any `shipping`/`shipping_amount`/`total` field outright. The quote endpoint is advisory; `createOrder()` recomputes from the persisted address and ignores anything the client sent (§11.4, §8.16).
- Rate and zone mutation is `system.configure`-gated and audited; a Manager without that grant cannot alter what customers are charged.
- The quote endpoint reveals only zone names and amounts — no customer or order data — and is rate-limited so it cannot be used to enumerate configuration at scale.

---

## Data integrity / idempotency

- `computeShipping()` is **pure and deterministic** for a given (address, subtotal, rate-table state, `now`). Called twice in the same transaction it returns the same number.
- The amount is computed **inside** the order-creation transaction and written in the same statement as the order, so the structural `CHECK (total = subtotal - discount + shipping)` can never fail at runtime.
- `shipping_zone_code` and `shipping_amount` are **snapshots**. A later rate change never alters a historical order — the same immutability §8.23 requires of coupon snapshots.
- Exactly one default zone is structurally enforced, so resolution is total: there is no address for which shipping is undefined.

---

## Acceptance criteria

1. An order placed to a metropolitan Dhaka address is charged the `INSIDE_DHAKA` rate; the same district non-metro gets `DHAKA_SUBURB`.
2. An address in a district with no mapping is charged the default zone's rate — never an error, never zero.
3. `total_amount = subtotal - discount_amount + shipping_amount` holds for every created order (enforced by CHECK).
4. A coupon never reduces `shipping_amount` (§8.14c).
5. `minimum_order_amount` is evaluated on the merchandise subtotal only; an order that qualifies only once shipping is added is **rejected** (§8.10).
6. The bKash amount shown (§8.16a) and the COD amount sent to the courier (§8.16b) both equal `total_amount`, shipping included.
7. A client-supplied `shipping_amount` in the checkout payload is rejected, not silently overridden.
8. `FREE_OVER_THRESHOLD`: an order at exactly the threshold ships free; one taka below pays `flat_amount`.
9. Changing a rate does not alter the `shipping_amount` of any existing order.
10. Every zone/rate mutation writes an audit entry naming the actor and the before/after amounts.
11. A rate change by a Manager lacking `system.configure` returns `403`.

---

## Tests required

1. Zone resolution: metro match, non-metro match, unmapped district → default, case-insensitive district match.
2. Each strategy (`FLAT`, `FREE`, `FREE_OVER_THRESHOLD`) including the exact-threshold boundary.
3. The §8.14c ordering: discount applied before shipping; shipping absent from `eligible_subtotal`.
4. §8.10 interaction: shipping cannot make a coupon qualify.
5. Snapshot immutability: place order → change rate → re-read order → amount unchanged.
6. `.strict()` rejection of a client-supplied shipping/total field.
7. Determinism: two calls in one transaction agree.
8. Concurrency: a rate insert during an in-flight checkout does not produce an order violating the total CHECK.
9. RBAC: `system.configure` required for every admin write.
10. Structural: attempting to create a second default zone fails.

---

## Open questions / assumptions

1. **The seeded rates (৳60 / ৳100 / ৳120) are placeholders.** ৳100 is taken from the PRDs' own worked examples (§8.14c, §8.15c); the inside/outside-Dhaka split reflects standard Bangladesh courier practice. **The client must confirm the real figures before launch.** Changing them is an admin action, not a code change — which is the point of this spec.
2. **Zone granularity is district-level.** The §2.2 address model also carries Upazila/Thana and Union/Ward, so a finer table is possible later; district + metro flag is the coarsest unit that captures the inside/outside-Dhaka distinction that actually drives Bangladesh courier pricing.
3. **The free-shipping threshold is evaluated on the post-discount subtotal.** Documented above; the alternative (pre-discount) is a one-line change if the client prefers it.
4. **No weight-based pricing**, because no PRD models product weight. Adding it means a new `strategy` value and a weight column on products — the schema is shaped to absorb that without migration of existing rows.
5. **Courier-quoted rates are deliberately not used.** §4.2 only sends an amount to the courier. If the client wants live Pathao/Steadfast pricing at checkout, that is a new requirement needing the provider's current rate API (CLAUDE.md §6) and a caching strategy, and it belongs in a PRD first.
6. **Free shipping is a shipping rule, not a coupon type.** A "free delivery" coupon would require §8 to gain a `FREE_SHIPPING` discount type, which §8.4b's mutually-exclusive PERCENTAGE/FIXED_AMOUNT enum does not have. Not invented here.
