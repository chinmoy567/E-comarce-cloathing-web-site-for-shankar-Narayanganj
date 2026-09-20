# Requirements — Analytics and Marketing Integrations (Meta Pixel/CAPI)

> Part of the requirements set — see [01-overview.md](01-overview.md) for the index. Purchase-event timing depends on the order state machine in [07-order-state-machine.md](07-order-state-machine.md).

## 6. Analytics and Marketing Integrations

### 6.1 Meta Pixel and Conversions API (CAPI)

The platform will track customer behaviour and conversions for Meta (Facebook/Instagram) advertising using both:

- **Meta Pixel** — client-side, running in the Next.js frontend.
- **Meta Conversions API (CAPI)** — server-side, running in the Express.js backend.

Both channels send the same set of events so that ad performance data is not lost to browser tracking prevention, while the backend copy also carries authoritative order data that only the server can guarantee (e.g. a Purchase that has actually reached `CONFIRMED`).

### 6.2 Tracked Events

The following events must be tracked:

- `PageView`
- `ViewContent` — product detail page view.
- `Search` — product search performed.
- `AddToCart`
- `InitiateCheckout` — checkout started.
- `AddPaymentInfo` — payment method selected / payment information submitted during checkout.
- `Purchase`

### 6.3 Purchase Event Timing

The `Purchase` event must not fire at order submission. It must follow the existing order-confirmation flow defined in sections 3 and 5.21:

- For **bKash Send Money** orders: fire `Purchase` when the order transitions to `CONFIRMED` (i.e. after payment has been verified by Admin/Manager per section 5.3), not when the customer submits the Transaction ID.
- For **Cash on Delivery** orders: fire `Purchase` when the order transitions to `CONFIRMED` per the COD confirmation rules in section 5.4 / 5.21.3, not when the order is placed.

The order-status transition handler that moves an order to `CONFIRMED` is the single place responsible for triggering the `Purchase` event (both Pixel-side, via a value returned to the frontend or a follow-up client event, and CAPI-side, via the backend). This avoids duplicate or premature Purchase events for orders that are later rejected, cancelled, or never confirmed.

This applies regardless of how many separate UI actions/API calls lead up to that transition. For bKash orders, "payment verification" (Section 5.3) and "order confirmation" may be implemented as one combined action or two sequential ones — either way, `Purchase` fires exactly once, only on the write that actually sets `orderStatus` to `CONFIRMED` (Section 5.21.9), never on a "payment verified" state that has not yet also set the order status to `CONFIRMED`.

If a `CONFIRMED` order is later `CANCELLED` or `RETURNED`, no reversal or refund event is sent to Meta for it in v1 — the already-fired `Purchase` event is not retracted or corrected. This is an accepted scoping decision, not an oversight.

If a coupon was applied to the order (Section 8, [10-coupon-discount.md](10-coupon-discount.md)), the `Purchase` event's `value` is the order's final, coupon-discounted total (Section 8.15c), not the pre-discount subtotal. This does not change the timing rule above — `Purchase` still fires exactly once, only on the `CONFIRMED` transition.

### 6.4 Event Deduplication (event_id)

Every event sent to both Meta Pixel and CAPI must include the same `event_id` for that logical event occurrence, generated once per event (e.g. UUID) and shared between the client-side Pixel call and the corresponding server-side CAPI call. Meta uses `event_id` to deduplicate events received from both channels for the same customer action; without a shared ID, events will be double-counted in reporting.

### 6.5 Data Sent Per Event

Where applicable, events must include:

- Product ID / SKU, product name, category.
- Variant (size, colour, etc.) where relevant.
- Quantity.
- Value (order or line-item value, reflecting any applied coupon discount per Section 8.31, [10-coupon-discount.md](10-coupon-discount.md)) and **currency, always `BDT`**.
- Content type / content IDs per Meta's Pixel/CAPI schema (e.g. `content_ids`, `content_type`, `contents`).

Customer-identifying fields sent to Meta (for advanced matching / CAPI) are limited to hashed values Meta's API expects (e.g. hashed email, hashed phone number) where the customer has provided them — never sent in plain text. This applies the same way to guest orders (Section 2.9): the guest's checkout-supplied name/email/phone are hashed for advanced matching exactly as a registered customer's profile fields would be, with no separate handling required because Purchase firing (Section 6.3) and event data both key off the order record, not off whether an account exists.

### 6.6 Data That Must Never Be Sent to Meta

The following must never appear in any Pixel or CAPI payload:

- Passwords or password hashes.
- OTPs.
- Authentication/session tokens.
- bKash Transaction IDs.
- Payment screenshots or any uploaded payment proof.

### 6.7 Credentials and Configuration

- The Meta Pixel ID and the CAPI access token must be stored in environment variables, never hard-coded in source.
- The Pixel ID is not secret and may be exposed to the frontend (it is required for the client-side Pixel script), but the **CAPI access token must never be exposed to the frontend** — CAPI calls are made only from the Express backend.

### 6.8 Failure Handling

A failure to send an event to Meta Pixel or CAPI (network error, API error, rate limit) must never block, delay, fail, or roll back the underlying customer action — order placement, payment submission, or order confirmation must succeed independently of Meta API availability. Failed CAPI sends should be logged for visibility but must not be retried in a way that risks duplicate order side-effects.

### 6.9 Implementation Notes

- If an analytics utility/module already exists in the frontend or backend codebase, this integration must extend it rather than introduce a second, parallel analytics system.
- Frontend Pixel calls and backend CAPI calls should share a single source of truth for event names, parameter shapes, and `event_id` generation strategy where practical, to avoid drift between the two implementations.

