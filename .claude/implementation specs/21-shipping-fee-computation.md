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

### Contract additions (decided — resolve the frontend gaps)

**One pricing function.** `priceCheckout(cart, coupon, address, now)` in `services/checkoutPricing.ts` runs `resolveCartForPricing → coupon engine → computeShipping` in the order fixed above. Both `POST /api/checkout/validate` and spec 11's `createOrder()` call it, so the preview and the placed order cannot disagree.

```ts
// POST /api/checkout/validate — public, publicCeiling, .strict(). Advisory; createOrder() always recomputes.
type CheckoutValidateRequest = { couponCode?: string;
                                 delivery?: { district: string; areaUnitType: 'UPAZILA' | 'THANA' } };  // omitted for a registered customer: the profile address is used
type CheckoutPricing = { currency: 'BDT'; subtotal: number; discountAmount: number; shippingAmount: number; totalAmount: number;
                         appliedCoupon: { code: string; discountAmount: number } | null;
                         couponMessage: string | null;                                // the §8.22 message when the code is rejected
                         shipping: { zoneName: string; freeShippingApplied: boolean; freeShippingRemaining: number | null } };
```

- **Metropolitan rule**: `isMetropolitan = (areaUnitType === 'THANA')` — the Upazila/Thana discriminator is the one that separates city from rural (§2.2); Union/Ward is not used. It is derived on the backend from the stored or submitted address, never sent as a boolean. `GET /api/shipping/quote` takes `areaUnitType` instead of `isMetropolitan`, and is coupon-unaware (pre-discount) and advisory only; the storefront uses `checkout/validate`.
- `GET /api/checkout/config` returns payment methods and the merchant bKash number only; the flat shipping amount it described is removed.
- **Zones admin contract** (all `system.configure`, audited):

```ts
type ZoneView = { id: string; code: string; name: string; isDefault: boolean; sortOrder: number;
                  districts: Array<{ district: string; metroOnly: boolean }>;
                  currentRate: { id: string; strategy: 'FLAT'|'FREE'|'FREE_OVER_THRESHOLD'; flatAmount: number;
                                 freeOverAmount: number | null; effectiveFrom: string } };
// GET  /api/admin/shipping/zones                    → ZoneView[]
// POST /api/admin/shipping/zones                    { code, name, sortOrder?, districts[] }        (.strict())
// PATCH /api/admin/shipping/zones/:id               { name?, sortOrder?, districts? }              districts = the FULL replacement list
// POST /api/admin/shipping/zones/:id/make-default   swaps is_default in one transaction (the partial unique index stays valid)
// POST /api/admin/shipping/zones/:id/rates          { strategy, flatAmount?, freeOverAmount? }     flatAmount required unless FREE (stored as 0)
// GET  /api/admin/shipping/zones/:id/rates          paginated rate history
// GET  /api/admin/shipping/unmatched-districts      paginated { district, occurrences, firstSeenAt, lastSeenAt }
```

- **Unmatched districts**: a new table `shipping_unmatched_districts (district_text PK, occurrences, first_seen_at, last_seen_at)` is upserted whenever resolution falls to the default zone (alongside the existing `shipping.zone_unmatched` log). The list endpoint excludes any text that now has a mapping, so adding the mapping clears it with no dismiss action. Zones, districts and rates are never hard-deleted by an endpoint; removing a mapping is done by replacing the district list.

## Frontend work

- **Cart page** — shipping shown as "Calculated at checkout" until an address/district is known. Never guessed client-side.
- **Checkout** — the quote refreshes when the district or metro discriminator changes, displayed as its own line in the §8.15c breakdown: `Subtotal / Discount / Shipping / Total`.
- **Free-shipping hint** — when `freeShippingRemaining` is non-null, show "Add ৳X more for free delivery". Purely informational.
- **Admin → Settings → Shipping** — zone list, district assignment, rate editor with an explicit "this changes what customers are charged from now on" confirmation.

Per CLAUDE.md §8: plain tabular layout, no decorative treatment.

---

### Frontend build detail

The bullets above stay as the behavioural summary. This section pins how shipping is displayed and administered, using only the endpoints and types in **Backend work** above (`GET /api/shipping/quote`, `ShippingQuote`, `GET /api/checkout/config`, the admin zone/rate endpoints). The frontend **displays** a quote the backend computed; it never calculates, estimates or hardcodes a shipping amount. Needs the backend does not cover are listed under **Backend gaps**.

#### Pages and access

| Surface | Route | Who | Failure / 403 |
| --- | --- | --- | --- |
| Cart shipping line | `/cart` (`app/cart/CartView.tsx`) | Public | Not applicable (no shipping request is made here). |
| Checkout shipping line and hint | `/checkout` (`components/checkout/CheckoutWizard.tsx`) | Public (guest or registered) | Quote failure: see States; checkout is never blocked by a failed quote — the backend recomputes at order creation. `429` → the shipping line shows "Could not update delivery charge. Try again." |
| Shipping settings | `/admin/settings/shipping` (new, `app/admin/(shell)/settings/shipping/page.tsx`) | `system.configure` | Full-page "You do not have access to shipping settings." for a `403` on load; a `403` on a write shows an inline `role="alert"` and leaves the screen unchanged. A nav entry "Shipping" with `requires: 'system.configure'` is added to `lib/admin/nav.ts` (hidden for a default Manager — UX only). |

`401` on the admin page is handled by the shell's redirect to `/admin/login`.

#### Components

| Component | File | Props | Reuses |
| --- | --- | --- | --- |
| `ShippingSummaryLine` | `components/checkout/ShippingSummaryLine.tsx` (new) | `quote: ShippingQuote \| null`, `phase: 'idle' \| 'loading' \| 'ready' \| 'error'` | `formatMoney` (`lib/account.ts`) |
| `FreeShippingHint` | `components/checkout/FreeShippingHint.tsx` (new) | `remaining: number \| null` | `formatMoney` |
| `useShippingQuote` | `lib/useShippingQuote.ts` (new hook) | `district: string`, `isMetropolitan: boolean \| null` | `apiGet` (`lib/apiClient.ts`) |
| Checkout summary | inside `CheckoutWizard.tsx` (exists) | — | the two components above, `CouponField` |
| Cart summary | `app/cart/CartView.tsx` (exists) | — | — |
| `ShippingZoneList` | `components/admin/shipping/ShippingZoneList.tsx` (new) | `zones`, `onEdit`, `onAddRate` | `StatusBadge`, `Button` |
| `ShippingZoneForm` | `components/admin/shipping/ShippingZoneForm.tsx` (new) | `zone?: ZoneView`, `onSaved()` | `FormField`, `ToggleField`, `Button` |
| `ShippingRateForm` | `components/admin/shipping/ShippingRateForm.tsx` (new) | `zone: ZoneView`, `onSaved()` | `FormField`, `SelectField`, `Button` |
| `RateChangeConfirm` | `components/admin/shipping/RateChangeConfirm.tsx` (new) | `current`, `next`, `onConfirm()`, `onCancel()` | `Button` |

`ShippingQuote`, `ZoneView` (zone columns: `id`, `code`, `name`, `isDefault`, `sortOrder`; districts as `{ district, metroOnly }`; current rate as `{ strategy, flatAmount, freeOverAmount, effectiveFrom }`) are hand-maintained mirrors in `lib/publicTypes.ts` / `lib/admin/types.ts`. `ZoneView`'s projection is assumed from the tables (gap 2).

#### Data: endpoint → fields shown

| Screen | Endpoint | Fields |
| --- | --- | --- |
| Checkout shipping line | `GET /api/shipping/quote?district=&isMetropolitan=` (current cart is identified by the existing cart cookie, `credentials: 'include'`) | `zoneName`, `amount`, `freeShippingApplied`, `freeShippingRemaining` (`zoneCode` is internal and **not displayed**) |
| Checkout payment options | `GET /api/checkout/config` | per spec 11 (payment methods, merchant bKash number, flat amount); **the shipping figure comes from the quote, not from here** (gap 1) |
| Cart merchandise subtotal | `GET /api/cart` (spec 09) | `merchandiseSubtotal` |
| Confirmation (spec 11) | `POST /api/orders` response | `subtotal`, `discountAmount`, `shippingAmount`, `totalAmount`, and `bkash.amountToSend` / `cod.amountDue` — the authoritative figures |
| Admin zones | `GET /api/admin/shipping/zones` | zones with their current rate (above) |
| Create / update zone | `POST` / `PATCH /api/admin/shipping/zones` | zone `name`, `code` (create only), district mappings `{ district, metroOnly }` |
| New rate | `POST /api/admin/shipping/zones/:id/rates` | `strategy`, `flatAmount`, `freeOverAmount` |

#### Cart page

- Lines and `merchandiseSubtotal` are the server cart's (`GET /api/cart`), not a sum of locally stored prices (the current `CartView.tsx` sums `displaySnapshot.unitPrice × quantity` — see below).
- The summary shows **Subtotal** and a **Shipping** row reading **"Calculated at checkout"** until an address/district is known. It never shows a placeholder amount, "৳0", "Free" or an estimate. There is no Total row on the cart other than the subtotal label "Subtotal" (the cart is pre-discount, pre-shipping).
- The checkout button and "Continue shopping" follow the existing cart layout (sticky summary on mobile, 48px).

#### Checkout page

- **Which address**: for a guest, the Step 1 address fields (`AddressFields.tsx`); for a registered customer, the saved profile address. The quote needs `district` and the metropolitan discriminator only (§Resolution order); pricing is requested **only when the district and area type are known**.
- **When it refreshes**: whenever the district or the metropolitan discriminator changes. `useShippingQuote` debounces 300 ms, cancels the previous request with `AbortController`, and ignores any response whose parameters no longer match the current ones (so a slow earlier response can never overwrite a newer one).
- **The Subtotal / Discount / Shipping / Total breakdown** (§8.15c) is a four-line summary on Step 1, Step 2 and Step 3 (sticky at the bottom on mobile): *Subtotal* (server cart `merchandiseSubtotal`), *Discount* (the coupon validate response's `discountAmount`, shown only when a coupon is applied), *Shipping* (`ShippingSummaryLine`), *Total*. **Total is shown only from a backend-supplied figure** (gap 1); until then it reads "Calculated when you place your order" rather than a browser-computed sum. After placement, the confirmation shows `totalAmount` and the bKash/COD amounts straight from the response.
- **`ShippingSummaryLine`**: "Delivery to {zoneName}" and the `amount` (`৳60.00`); when `freeShippingApplied` is true it shows "Free" with the zone name. While no district is known it shows "Calculated once you choose your district".
- **`FreeShippingHint`**: rendered only when `freeShippingRemaining` is non-null; copy exactly "Add ৳X more for free delivery" with `X` formatted from the backend value. Purely informational (a `role="status"` line under the shipping row); it never changes any amount or button state, and it is not a promise — the final charge is whatever the order response says.
- The order request body never contains a shipping, total or subtotal field (spec 11's `.strict()` schema rejects it, acceptance 7); nothing in the quote hook feeds the request.

#### Admin → Settings → Shipping

Layout: a header "Shipping" with an **Add zone** button; a list of zones (one card each, in `sortOrder`): name, a "Default (fallback)" badge on the `isDefault` zone, the assigned districts as `District` or `District (metro only)` chips, and the current rate in words ("Flat ৳60.00", "Free", "Free over ৳2,000.00, otherwise ৳100.00") with "effective {date}". Each card has **Edit zone** and **Change rate**.

- **Zone form**: Name (required), Code (create only, read-only after; uppercase letters/underscores, UX hint only), districts as rows of `{ District text, Metro only toggle }` with an **Add district** row action. The default zone shows no district rows (it has none by design) and a note "Used when no district matches." There is **no delete** control for zones, districts or rates (rates are superseded, never deleted; no delete endpoint exists).
- **Rate form**: Strategy (`Flat` / `Free` / `Free over threshold`); **Charge** (flat amount) shown for `Flat` and `Free over threshold`; **Free over (threshold)** shown only for `Free over threshold`; `Free` hides both. UX validation: numbers ≥ 0, at most 2 decimal places, threshold required for `Free over threshold` and absent otherwise (mirroring the all-or-nothing check). Backend errors map to fields with `ApiClientError.fieldError`.
- **Confirmation**: saving a rate opens `RateChangeConfirm` (in-page `role="dialog"`, focus trapped, Escape closes) showing current → new and the sentence **"This changes what customers are charged from now on. Existing orders are not affected."** The confirm button is "Apply new rate"; submit is disabled until the dialog's confirm is pressed. The same confirmation guards zone/district edits that move a district to a different zone.
- **Unmatched districts**: the screen is required to list districts that fell through to the default zone (§Resolution order), but no endpoint provides them (gap 3) — the section is built behind the data and is omitted until one exists.

#### States

| State | Checkout / cart | Admin settings |
| --- | --- | --- |
| Loading | Shipping row "Calculating…" (`aria-busy`), amount cleared so a stale figure is never shown for a new address; Place Order is **not** blocked | "Loading zones…" |
| Empty | No district yet → "Calculated once you choose your district" | "No shipping zones are configured." with Add zone (the default zone should always exist; if it does not, show a warning that checkout will use the backend fallback) |
| Error | Quote failed → "Delivery charge unavailable right now. It will be calculated when you place your order." (no number), with a Retry link; checkout continues | Alert with message and Retry |
| Success | Zone name + amount (+ hint) | Zone cards; after a save, the list refetches and a live region announces "Rate updated." |
| Disabled | District not chosen; during a quote request the *Next* button stays enabled | Save disabled until dirty/valid; while saving all form buttons disabled |
| Double-click | n/a (read-only requests; repeated identical requests are deduplicated by the hook) | Submit and Confirm are disabled while a request is pending; a second click is ignored (a duplicate `POST …/rates` would insert a second superseding row — harmless to history, but avoided) |

#### Responsive behaviour and accessibility

- 375px first, verified at 320px. The checkout summary is a sticky bottom bar on mobile (Subtotal/Discount/Shipping/Total as four label/value rows), and a side panel from `lg`. Rows are plain tabular `dl` pairs — no decoration (CLAUDE.md §8).
- The shipping line and hint sit in an `aria-live="polite"` region so a change of district announces the new charge; the hint is `role="status"`.
- Admin zone cards stack at 375px and become a two-column grid from `lg`; rate/zone form fields are single-column, ≥ 44px, labels above, 48px buttons; district rows stack the text input over the toggle on mobile.
- Amounts `৳ 60.00`, dates `DD MMM YYYY`; colour is never the only signal.

#### Analytics

None added by this slice. The existing `InitiateCheckout` and `AddPaymentInfo` events (spec 18) must not carry a browser-computed total that includes shipping; see spec 18's frontend detail.

#### What the frontend must NOT do

- Compute, estimate, round, default or cache a shipping amount, total, discount or free-shipping threshold; hardcode ৳60/৳100/৳120, a district-to-zone mapping, or "Dhaka = metropolitan".
- Send `shipping`, `shipping_amount`, `total` or `subtotal` in any request (including the order request) or put them in the URL.
- Show a shipping number before a district is known, or keep showing a previous number while a new quote loads.
- Treat the free-shipping hint as a guarantee, apply the threshold itself, or change any amount/button from it.
- Show the internal zone `code`, or any customer/order data, in the admin quote preview.
- Offer delete for zones, districts or rates, or let a Manager without `system.configure` reach the page (nav hiding is only convenience).
- Treat a failed or slow quote as a reason to block checkout.

#### Existing code to reconcile

- `app/cart/CartView.tsx` sums `displaySnapshot.unitPrice × quantity` from the local cart and shows only Subtotal/Total; the cart is meant to read `GET /api/cart` (spec 09) and show the "Calculated at checkout" shipping row.
- `components/checkout/CheckoutWizard.tsx` has no shipping line, computes `displayTotal = subtotal − discount` itself, and its `OrderResponse` already has `shippingAmount` (shown only after placement). It posts to `/api/customer/orders`; spec 11's endpoint is `POST /api/orders`.
- `components/checkout/AddressFields.tsx` defaults `areaUnitType` to `THANA` and `wardUnitType` to `WARD`; how those map to `isMetropolitan` is not defined (gap 4), so the default must not silently imply "metropolitan".
- `lib/admin/nav.ts` has no Settings entries.

#### Backend gaps (all resolved — see Contract additions and Gap resolutions)

1. **No endpoint returns a server-computed checkout total before an order exists.** `GET /api/checkout/config` has no address input yet is said to "gain the resolved quote" (and is unauthenticated `GET` with no stated parameters), `GET /api/shipping/quote` returns only the shipping quote, `POST /api/coupons/validate` returns only the discount, and `POST /api/checkout/validate` has no defined response. The §8.15c breakdown's **Total** therefore cannot be shown from a backend figure; an endpoint returning `{ subtotal, discountAmount, shippingAmount, totalAmount }` is needed (the likeliest home is `POST /api/checkout/validate`).
2. **Admin response/request shapes are unspecified**: `GET /zones` ("zones with their current rate"), `POST`/`PATCH /zones` (the `PATCH` path has no `:id`, and whether districts are replaced or merged is unstated), and the `POST …/rates` body (notably whether `flatAmount` is sent for `FREE`).
3. **No endpoint lists the unmatched districts** that §Resolution order says the admin screen must surface; nor is there any read of a zone's rate history.
4. **The metropolitan discriminator is under-defined.** The quote takes `isMetropolitan`, defined as "the address discriminator says metropolitan (Thana/Ward)" — which of `areaUnitType` (Upazila/Thana) and `wardUnitType` (Union/Ward), or both, drives it is not stated, so the frontend cannot derive the parameter without guessing. The backend should state the rule (or accept the two discriminators directly).
5. **The quote cannot reflect an applied coupon.** The threshold is evaluated on the **post-discount** subtotal, but the quote endpoint takes only district + metro + the cart; the coupon code is not an input and no server-side "applied coupon" is stored with the cart, so `amount`, `freeShippingApplied` and `freeShippingRemaining` may differ from the placed order when a coupon is used.
6. **No way to change the default zone or remove a district mapping** is defined (no delete, no "make default").

#### Spec-vs-spec conflicts (decisions in Gap resolutions)

- Spec 21 says shipping is "Calculated at checkout" on the cart, while `GET /api/shipping/quote` could serve the cart if a district were known; the cart keeps the spec's wording and makes no quote request.
- Spec 11 describes `GET /api/checkout/config` as returning "the flat shipping amount"; spec 21 replaces that with the zone quote. The frontend follows spec 21 (the quote endpoint) and ignores a flat amount from the config response.

#### Gap resolutions and frontend consequences

| Gap | Decision |
| --- | --- |
| 1 | `CheckoutPricing` returned by `POST /api/checkout/validate`. `useShippingQuote` is replaced by `useCheckoutPricing`, which calls it (debounced 300 ms, abortable) on district/area-type/coupon changes. The Subtotal / Discount / Shipping / Total rows render the four backend figures; "Calculated when you place your order" is no longer used. The Pixel `value` (spec 18) is `totalAmount`. |
| 2 | Zone/rate shapes and the make-default, history and replace-districts routes defined above; `ShippingZoneForm` sends the full district list on PATCH. |
| 3 | The "Unmatched districts" panel is built, reading `GET …/unmatched-districts`, each row offering "Add to a zone". |
| 4 | The frontend sends `areaUnitType` (`THANA`/`UPAZILA`) as already held by `AddressFields`; it never sends or computes `isMetropolitan`. |
| 5 | `checkout/validate` is coupon-aware, so `shippingAmount`, `freeShippingApplied` and `freeShippingRemaining` match the placed order. |
| 6 | "Make default" is available on non-default zones (confirm dialog); district removal is done by editing the list. |

**Conflicts decided.** (a) The cart keeps "Calculated at checkout" and issues no pricing request. (b) The shipping figure comes from `CheckoutPricing`, not from `GET /api/checkout/config`.

Dependency note for spec 11: its `POST /api/checkout/validate` response is now `CheckoutPricing`, and its `createOrder()` calls `priceCheckout()`.

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
