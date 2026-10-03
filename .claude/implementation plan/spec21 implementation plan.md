# Spec 21 — Shipping Fee Computation: Implementation Plan

## Context
Shipping is currently hard-coded: `DEFAULT_SHIPPING_AMOUNT = 0` in `backend/src/services/checkout.service.ts:88-93` (used at line 487). Spec 21 (`.claude/implementation specs/21-shipping-fee-computation.md`) makes `computeShipping()` the single authority, backed by an admin-managed zone/rate table. Nothing from spec 21 exists yet (verified: no tables, routes, services, tests). Latest migration is `0017_reporting.sql`.

## Reality gaps vs the spec (decisions needed in the plan)
1. **Spec 09 (server cart) is unbuilt** → no `resolveCartForPricing`. Cart is localStorage; checkout posts `{productId, variantId, quantity}` lines. **Decision:** `priceCheckout()` takes line inputs and reuses/extracts `loadLiveLines` from `checkout.service.ts:123`.
2. **Routes differ:** real checkout is `POST /api/customer/orders`; `POST /api/orders`, `/api/checkout/validate`, `/api/checkout/config` don't exist. **Decision:** keep `/api/customer/orders` (no rename — avoids breaking working frontend); add `POST /api/checkout/validate` (public, `publicCeiling`, `.strict()`) and `GET /api/shipping/quote`. Skip `/api/checkout/config` changes (it doesn't exist; payment config is out of scope).
3. **The total CHECK does not exist** (only `shipping_amount >= 0`, `total_amount >= 0`). Migration must add `CHECK (total_amount = subtotal - COALESCE(discount_amount,0) + shipping_amount)` as `NOT VALID` then `VALIDATE` (discount_amount is nullable; verify historical rows).
4. `computeShipping` reads tables, so it takes a `PoolClient` (runs inside the createOrder transaction) — "pure" = deterministic given DB state + `now`.
5. `AddressFields` defaults `areaUnitType='THANA'`; pricing must fire only once district is non-empty.

## Backend
**Migration `backend/migrations/0018_shipping.sql`** (forward-only, no BEGIN/COMMIT, IF NOT EXISTS):
- `shipping_zones`, `shipping_zone_districts` (PK `(district, metro_only)`, store/compare `lower(district)`), `shipping_rates` (text+CHECK strategy, all-or-nothing threshold CHECK, index `(zone_id, effective_from DESC)`), `shipping_unmatched_districts`.
- Partial unique index on `is_default`; seed 3 zones/rates (৳60/100/120, flagged placeholders).
- `orders.shipping_zone_code text NULL` + the total CHECK.

**New files** (follow coupons layout):
- `repositories/shipping.repository.ts` — zone/district/rate reads+writes, unmatched upsert, current-rate lookup (`effective_from <= now`, newest).
- `services/shipping/computeShipping.ts` — resolution (metro → non-metro → default), strategies, half-up 2dp rounding (reuse spec-10 rounding helper), `freeShippingRemaining`; unmatched → `logger.warn('shipping.zone_unmatched')` + upsert.
- `services/checkoutPricing.ts` — `priceCheckout(lines, coupon, address, now, client?)`: lines → `validateCoupon` (`services/coupon/validateCoupon.ts`) → `computeShipping(subtotal − discount)` → total. `isMetropolitan = areaUnitType === 'THANA'` derived server-side.
- `services/shipping/shippingAdmin.service.ts` — zones CRUD, make-default (single txn), rate insert, history, unmatched list; every write calls `auditRepository.append` in the same transaction with before/after.
- `validation/shipping.validation.ts` (`.strict()`), `controllers/*`, `routes/public/shipping.routes.ts` (`GET /api/shipping/quote`, `POST /api/checkout/validate`), `routes/admin/shipping.routes.ts` mounted via `routes/admin/index.ts` with `requirePermission('system.configure')`; register in `routes/index.ts`.

**Modify:**
- `checkout.service.ts` — delete `DEFAULT_SHIPPING_AMOUNT`; call `priceCheckout`/`computeShipping` inside the transaction after coupon revalidation; pass `shipping_zone_code`.
- `orders.repository.ts` — add `shipping_zone_code` param to insert (currently 25 positional params).
- Order views/reports: no change (read stored `shipping_amount`).

## Frontend
- `lib/useCheckoutPricing.ts` (debounce 300 ms, AbortController, stale-response guard) calling `POST /api/checkout/validate`; keep view-model logic in a pure `lib/` function for node-only vitest.
- `components/checkout/ShippingSummaryLine.tsx`, `FreeShippingHint.tsx`; update `CheckoutWizard.tsx` (remove browser-computed `displayTotal` at line 88; four-row Subtotal/Discount/Shipping/Total from backend figures; never block Place Order on quote failure).
- `CartView.tsx` — add "Calculated at checkout" shipping row; no pricing request. (Server-cart rewrite deferred to spec 09.)
- Admin: `app/admin/(shell)/settings/shipping/page.tsx`, `components/admin/shipping/{ShippingZoneList,ShippingZoneForm,ShippingRateForm,RateChangeConfirm}.tsx`, unmatched-districts panel; nav entry in `lib/admin/nav.ts` (`system.configure`). Template: `settings/couriers/page.tsx` + `CourierConfigRow.tsx`. Types in `lib/admin/types.ts` / `lib/publicTypes.ts`. Use `formatMoney(n,{decimals:2})`.

## Tests (per CLAUDE.md §10)
- New `backend/tests/spec-21-shipping/` (computeShipping unit, admin API/RBAC, checkout shipping API, schema/default-zone, snapshot immutability, concurrency, `.strict()` rejection, §8.10/§8.14c ordering); `backend/config/vitest/spec21/vitest.config.ts` (model on spec20, explicit `include`); `test:spec21` in `backend/package.json`; update `tests/TEST_ORGANIZATION.md`.
- Update existing tests asserting `totalAmount` with shipping 0: `spec-11-checkout/checkout.api.test.ts`, `spec-15-tracking/*`, `spec-16-risk-check/helpers/riskFixture.ts`, spec-10 mentions.
- Frontend: `frontend/tests/shipping*.test.ts` for pure view-model logic.

## Build order
1. Migration 0018 + repository + `computeShipping` + unit tests
2. `priceCheckout` + wire into `createOrder` + fix affected existing tests
3. Public endpoints (`quote`, `checkout/validate`)
4. Admin endpoints + audit + RBAC tests
5. Frontend checkout/cart
6. Admin shipping UI
7. Docs (TEST_ORGANIZATION.md), memory note

## Verification
- `npm run migrate` on a scratch schema; `npm run test:spec21`, then `test:spec11`, `test:spec10`, `test:spec20`, full backend suite; frontend `vitest` + `tsc`/lint.
- Run the app: place guest order with Dhaka+THANA (৳60), Dhaka+UPAZILA (৳100), unknown district (৳120 + unmatched row), threshold boundary; admin changes rate → old order unchanged; Manager gets 403.

## Open items for the client (not blocking)
Seed rates are placeholders; threshold evaluated post-discount; migration must be applied to the real DB (past migrations 0016/0017 are still unapplied there).
