# 15 — Courier Status Synchronization, Public Track Order, Guest Order Lookup, and Customer Order History

## Goal

After this slice customers can see where their order is, through the three distinct paths the PRDs define and deliberately keep separate: the public **Track Order** page, which takes a courier-provided Order ID / Tracking ID and no login; the **guest order lookup**, which takes the store Order Number **and** the phone number and shows full order/payment status; and a registered customer's **account order history**. Behind them, courier status updates flow in through an idempotent synchronization path that drives shipment transitions and the two order cascades. Every customer-facing response returns only the customer-safe model, and neither lookup can be used to enumerate orders or identifiers.

## Requirement references

- `04-courier-shipment.md` §4.6 — retrieve shipment-status updates where the courier supports it; map courier statuses to internal ones; updates may arrive **more than once or out of order**, and the mapping step must be idempotent — applying the same update twice, or an older status after a newer one, must not corrupt status or duplicate history entries.
- `04-courier-shipment.md` §4.7 — three tracking paths, all backed by the same shipment/order record; tracking works identically for guest and registered orders.
- `04-courier-shipment.md` §4.14 — a single, clearly-labelled **Track Order** entry point using exactly that label, reachable without login by both guest and registered customers.
- `04-courier-shipment.md` §4.14.1 — Track Order and guest order lookup are **not the same feature** and must not be merged: different identifiers, different prerequisites, different data.
- `04-courier-shipment.md` §4.14.2 — the customer typically arrives with only a courier SMS identifier; no account, login, or password at any point.
- `04-courier-shipment.md` §4.14.3 — the Track Order form and what a valid result displays.
- `04-courier-shipment.md` §4.14.4 — before a shipment exists, show an honest "not available yet" message; **no fake tracking ID, no fabricated result**.
- `04-courier-shipment.md` §4.14.5 — a logged-in customer's order detail shows a Track Order action reflecting current shipment availability; this is additional, not a replacement for the public page.
- `04-courier-shipment.md` §4.14.6 — Track Order surfaces **shipment** status, not the internal order state machine; no new order-status values are introduced.
- `04-courier-shipment.md` §4.14.7 — the order confirmation must not claim tracking is available before a shipment exists.
- `04-courier-shipment.md` §4.14.8 — the entry point appears in header navigation, mobile navigation/menu, and the footer.
- `04-courier-shipment.md` §4.15 — the store Order Number and the courier identifier are **not** interchangeable.
- `04-courier-shipment.md` §4.16 — the Track Order endpoint is public and must have input validation, rate limiting separate from the guest lookup, safe generic errors that cannot enumerate identifiers, a customer-safe payload only (never admin notes, fraud/risk results, payment notes or proof or full Transaction IDs, credentials, internal database identifiers, or full contact/address beyond a delivery-area summary), and backend-enforced business rules.
- `02-customer.md` §2.9.5 — guest lookup requires Order Number **and** phone together; neither alone suffices.
- `02-customer.md` §2.9.6 — exactly what the guest lookup page shows, and what it must **not** expose.
- `02-customer.md` §2.9.7 — no sequential/enumerable order-number URLs; rate limiting per order number and per IP with temporary lockout; a mismatched pair returns the same generic "not found" as a fully invalid Order Number; no admin-only fields ever.
- `02-customer.md` §2.6 — registered customers view their order history.
- `03-payment-order.md` §3.7, §3.8 — the customer-facing display labels for order and shipment status.
- `07-order-state-machine.md` §5.21.4, §5.21.6, §5.21.9 — the shipment transitions driven by courier sync and the atomic `DELIVERED`/`RETURNED` cascades.
- `11-security-hardening.md` §11.3 (separate limiters), §11.6 (validation), §11.8 (webhook signature verification and rate limiting).
- Skills: `security` §8, `backend` §10, `frontend` §5, §10, `test` §1, `design` (Order Tracking page).

## Depends on

- **01** — API conventions, errors, validation.
- **04** — `guestOrderLookup`, `trackOrder`, `publicCeiling` limiters; `safeFetch`.
- **08** — customer sessions for the account order history.
- **11** — `orders`, `order_items`, `payments`.
- **12** — `applyCourierStatusUpdate()`, `transitionShipmentStatus()`, `shipment_sync_events`, `status_sequence`.
- **14** — `couriers` registry, adapters' `trackShipment`, `shipments.courier_order_id`, tracking URL templates.

## Scope

**In scope**

- Courier status ingestion: a webhook endpoint per provider (signature-verified) and a polling job, both funnelling into spec 12's idempotent applier.
- `POST /api/track-order` — the public, courier-identifier lookup.
- `POST /api/orders/lookup` — the guest Order Number + phone lookup.
- `GET /api/customer/orders` and `GET /api/customer/orders/:orderNumber` — account order history.
- Two distinct customer-safe projections (tracking vs. order lookup).
- Storefront pages: `/track-order`, `/orders/lookup`, `/account/orders`, `/account/orders/[orderNumber]`.
- Navigation placement of the Track Order entry point.

**Out of scope / deferred**

- The shipment state machine itself — spec **12** owns it; this slice supplies input.
- Adapter tracking calls — spec **14** owns them.
- Customer notifications on status change — no channel is defined by any PRD (flagged in specs 08 and 13).
- Post-delivery returns/RMA — §5.21.7 places a `DELIVERED → RETURNED` workflow explicitly out of v1 scope.

## Database changes

Migration file: `backend/migrations/0015_tracking_lookup.sql`

No new business tables; `shipment_sync_events` and `status_sequence` already exist from spec 12.

- Index `shipments (courier_order_id)` — the Track Order lookup key. Not unique across couriers on its own, so the lookup resolves on `courier_order_id` and, where the customer supplies it or only one match exists, disambiguates by courier; two couriers issuing the same string is possible in principle, so a multi-match returns the generic not-found rather than guessing (§4.16's no-enumeration rule makes silence the correct response).
- Index `orders (order_number, contact_phone)` — the guest lookup's composite key, so the pair is matched in one indexed lookup rather than by fetching on order number and then comparing (which would leak timing information about which orders exist).
- `courier_webhook_deliveries` — a small table recording raw inbound webhook receipts for audit: `id`, `courier_code`, `signature_valid`, `payload_digest`, `http_status_returned`, `received_at`. The body is not retained beyond a digest, since it contains customer data (`database` skill §4).

## Backend work

### Courier status ingestion (§4.6)

Two mechanisms, one destination. Both normalize through the spec 14 adapter and then call spec 12's `applyCourierStatusUpdate()`, which owns duplicate detection, staleness detection, transition validation, and the cascades. Neither ingestion path writes a status column itself.

**Webhooks** — `POST /api/webhooks/courier/:courierCode`, public but not anonymous in effect:

1. `rateLimit('publicCeiling')` (§11.8 requires webhook endpoints to be rate-limited so they cannot become a DoS vector).
2. **Verify the provider's signature before acting on the payload** (§11.8). The shared secret comes from env. An invalid signature returns `401` and records `signature_valid: false`; **no payload is processed**.
3. Normalize through the courier's adapter — raw provider fields never travel further (§4.9).
4. Resolve the shipment by `courier_order_id`.
5. Call `applyCourierStatusUpdate()` with the provider's event id where supplied.
6. Return `200` for accepted, duplicate, and stale alike — a provider must not be encouraged to retry-storm because the platform correctly ignored a repeat. The distinction is recorded in `shipment_sync_events.skip_reason`, not in the HTTP status.

**Polling** — a scheduled task (run by the deployment's scheduler, not an in-process timer — §11.4 forbids heavy work in the request path) that selects shipments in `CREATED`/`SHIPPED`/`IN_TRANSIT`/`OUT_FOR_DELIVERY`/`DELIVERY_FAILED` whose courier has `supports_tracking`, calls `trackShipment`, and funnels the normalized result into the same applier. §4.6 says updates arrive "via webhook or polling, depending on what the selected courier API supports," so both exist and neither is privileged.

Because both paths converge on one idempotent applier, a webhook and a poll reporting the same transition apply it once. That is precisely §4.6's requirement, and it is why no ingestion path is allowed its own status-write shortcut.

### `POST /api/track-order` (§4.14, §4.16)

Public, no authentication, `rateLimit('trackOrder')` — a **separate limiter instance** from the guest lookup, per §4.16's "independently rate-limited from the guest order-lookup endpoint."

```ts
type TrackOrderRequest = { trackingId: string };

type TrackOrderResponse =
  | { found: true;
      trackingId: string;
      courierName: string;
      shipmentStatus: ShipmentStatus;         // display label per §3.8
      events: Array<{ status: ShipmentStatus; occurredAt: string | null; description: string }>;
      estimatedDeliveryAt: string | null;
      deliveryAreaSummary: string | null;     // area only — never the full address (§4.16)
      courierTrackingUrl: string | null; }
  | { found: false; message: string };
```

Behaviour:

1. Validate format and length before any lookup (§4.16's "format/length checks before it is used in any courier or database lookup") — 4–64 characters, alphanumeric with `-`/`_`.
2. Look up `shipments.courier_order_id`.
3. **Not found, or found but the shipment is not yet `CREATED`** → the same generic response (§4.16): `"Tracking information could not be found. Please check your Order ID / Tracking ID and try again."` The response is byte-identical in both cases, so the endpoint cannot distinguish "no such identifier" from "identifier exists but belongs to another order" and cannot be used to enumerate valid identifiers.
4. Found → optionally refresh from the courier (cached, see below) and return the normalized, customer-safe model.

**Two distinct "not found" surfaces.** §4.14.4 requires a different, honest message when the customer has entered something that is plausibly their **store Order Number** before a shipment exists: "Shipment tracking is not available yet. Your order has been confirmed and is being prepared for shipment…" Reconciling that with the no-enumeration rule: the "not available yet" message is returned **only** when the submitted value matches the store Order Number format *and* an order with that number exists *and* it has no shipment. That does confirm an order number exists — but an Order Number alone already confirms nothing sensitive (no details are shown), and this honest message is required rather than a misleading generic one. Every other case, including an unknown tracking id, returns the generic message. The stronger enumeration protection (§2.9.7) continues to apply to the **guest lookup** endpoint, which is where order *details* are actually exposed.

**No fabrication** (§4.14.4): no tracking identifier is ever generated, and no courier result is ever synthesized before a real shipment exists.

**Order status is never included** (§4.14.6): the response carries shipment status only, and no new order-status value such as `TRACKING_PENDING` is introduced anywhere.

**Caching.** A courier refresh is attempted at most once per `TRACK_REFRESH_TTL_SECONDS` (default 300) per shipment; otherwise the stored status and last-known events are returned. This keeps the public endpoint from becoming a free proxy for hammering a provider's API — the same reasoning §7.6 applies to the risk-check provider.

### `POST /api/orders/lookup` (§2.9.5–2.9.7)

Public, no authentication, `rateLimit('guestOrderLookup')` — its own limiter, keyed per order number and per source IP with a temporary lockout (§2.9.7).

```ts
type GuestOrderLookupRequest = { orderNumber: string; phoneNumber: string };  // both required

type GuestOrderLookupResponse =
  | { found: true;
      orderNumber: string;
      placedAt: string;
      orderStatus: OrderStatus;               // display label per §3.7
      paymentStatus: PaymentStatus;           // §3.6
      paymentMethod: 'BKASH' | 'COD';
      amounts: { subtotal: number; discountAmount: number; shippingAmount: number; totalAmount: number };
      appliedCouponCode: string | null;
      items: Array<{ productName: string; variantLabel: string; quantity: number;
                     unitPrice: number; lineTotal: number }>;
      deliveryAddressSummary: string;         // summary, not the full stored address
      shipment: { courierName: string; trackingId: string;
                  shipmentStatus: ShipmentStatus; trackingUrl: string | null } | null;
      paymentResubmissionAllowed: boolean; }
  | { found: false; message: string };
```

Behaviour:

1. Validate both fields; normalize the phone with `normalizeBdPhone` so formatting variants match.
2. Match the **pair** in one query. §2.9.5: "Neither value alone is sufficient."
3. Any failure — unknown order number, wrong phone, or both — returns the identical generic `"We could not find an order matching those details."` (§2.9.7: "the same generic 'order not found' style response… so the endpoint cannot be used to enumerate valid order numbers"). The comparison is constant-time-ish in the sense that the same single indexed query runs in all cases; there is no early return on order-number-found.
4. Found → return the §2.9.6 field set.

**Never exposed** (§2.9.6, §2.9.7): internal admin/manager notes, fraud/risk-check results, payment proof or screenshots, the full Transaction ID, any authentication or session credential, internal database identifiers, or the customer's full stored contact record. `paymentResubmissionAllowed` is a derived boolean (`method = BKASH AND payment_status IN ('PENDING_VERIFICATION','REJECTED')`) so the page can offer resubmission (spec 11) without revealing payment internals.

**Not merged with Track Order** (§4.14.1): separate route, separate limiter, separate request shape, separate response shape, separate page. The two features answer different questions from different identifiers and are deliberately kept apart.

### `GET /api/customer/orders` and `/:orderNumber` (§2.6, §4.14.5)

`requireAuth('customer')`, paginated. Scoped by `req.actor.customerId` — **never** by a client-supplied id, and never by `account_type`, which is what makes §2.9.8's claimed guest orders appear automatically once the customer record is shared.

The detail response matches the guest lookup's field set plus the full delivery address (the customer's own), and includes a `trackOrder` block: `{ available: boolean; trackingId: string | null }`. §4.14.5 allows the action to either link to the public page pre-filled or render inline; this slice pre-fills the public page, keeping one tracking renderer. Before a shipment exists the block reports `available: false` and the UI shows "Shipment: Not yet created / Tracking: Not available yet" (§4.14.5's own wording).

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Malformed tracking id or order number | 400 | `VALIDATION_ERROR` |
| Tracking id not found / not yet shipped | 200 | `{ found: false, message }` — generic |
| Store order number entered, order exists, no shipment | 200 | `{ found: false, message }` — the §4.14.4 "not available yet" text |
| Guest lookup mismatch (any cause) | 200 | `{ found: false, message }` — generic |
| Rate limited | 429 | `RATE_LIMITED` + `Retry-After` |
| Webhook signature invalid | 401 | `UNAUTHORIZED` |
| Webhook for an unknown courier or shipment | 200 | accepted and ignored, recorded in `shipment_sync_events` |
| Customer order not owned by the session | 404 | `NOT_FOUND` |

Lookups return `200` with `found: false` rather than `404` so that response-code observation cannot substitute for the body as an enumeration oracle.

## Frontend work

### `/track-order` (§4.14.3, §4.14.8)

- Reached from header navigation, the mobile menu, and the footer, labelled exactly **"Track Order"** (§4.14, §4.14.8) — not "Track Package" or "Track Shipment."
- The form is one input and one button, with the §4.14.3 helper text: "You can find your Order ID or Tracking ID in the SMS sent by the courier, or on your order confirmation once the shipment has been created."
- Result view: tracking ID, courier name, shipment status, a horizontal progress trail (Order Confirmed → Shipment Created → Picked Up → In Transit → Out for Delivery → Delivered) built from the normalized events, estimated delivery when the courier provides one, delivery **area** summary, and the courier's tracking link when one exists.
- Not-found view: the generic message. Not-yet-shipped view: §4.14.4's honest message, plus a link to the guest order lookup so the customer has somewhere useful to go ("The guest may instead use the Order Number + Phone Number lookup to see current order/payment status in the meantime").
- No order-status value is shown here (§4.14.6).

### `/orders/lookup` (§2.9.5–2.9.6)

Two fields — Order Number and Phone Number, both required — and a result view showing order status, payment status, the items and amounts, the delivery address summary, and shipment information with a tracking link when one exists. A "Submit payment information" action appears when `paymentResubmissionAllowed` is true, routing to spec 11's resubmission form. The page explains it is distinct from Track Order and links to it.

### `/account/orders` and `/account/orders/[orderNumber]` (§2.6, §4.14.5)

Paginated list with order number, date, status badges, and total; detail matching the `design` skill's Order Tracking page — a vertical timeline with checkmarks, current status, tracking info when available, and a `Track Order` button that opens the public page pre-filled. Before a shipment exists: "Shipment: Not yet created / Tracking: Not available yet."

### Status display

Enum values from §5.21 are rendered through one shared label map producing the Title Case display labels defined in §3.7/§3.8 (see that section). Order, payment, and shipment statuses are shown as **three separate badges**, never merged (`frontend` §2, §5.21.11).

All pages: mobile-first at 375px, 44px inputs and buttons, explicit loading/error/success/empty states, and no leakage of backend error detail (`frontend` §10).

## Security requirements

- **Both lookups are unauthenticated by design** (§4.14, §2.9, §5.19) and gated by submitted-field validation, not by a session. Adding a login gate would be a regression, not a fix.
- **The guest lookup requires the pair** (§2.9.5) — the Order Number alone is never sufficient and never appears in a details-returning GET URL (§2.9.7's "must not function as a bearer token").
- **No enumeration oracle** (§2.9.7, §4.16) — identical responses, identical status codes, and a single indexed query path for every failure mode on both endpoints.
- **Separate limiters** (§4.16, §11.3) — exhausting one endpoint's budget does not consume the other's.
- **Input validated before use** (§4.16) — format and length checks precede any database or courier call.
- **Customer-safe payloads only** (§4.16, §2.9.6) — a shared projection function per endpoint is the only serializer, so a new internal field cannot leak by default. Never returned: admin notes, risk-check results, payment proof, full Transaction IDs, credentials, internal primary keys, or the full contact/address beyond a summary.
- **No raw courier response reaches a customer** (§4.9, §4.16) — the adapter's normalized model is the only thing serialized.
- **Backend-enforced availability** (§4.16) — the "not yet available" outcome comes from the backend checking real shipment existence, not from the frontend declining to call.
- **Webhook signatures verified before processing** (§11.8), with the secret in env; webhooks are rate-limited.
- **Account order history is scoped to the session's customer** and never to a client-supplied identifier.
- **Courier refresh is cached**, so the public endpoint cannot be used to hammer a provider.

## Data integrity / idempotency

- **Idempotent sync (§4.6)** — spec 12's applier rejects duplicates by unique constraint and stale updates by the monotonic `status_sequence`, and writes an `order_status_history` row only when a transition actually applies, so repeated or out-of-order webhooks corrupt nothing and duplicate no history.
- **Webhook and polling converge** on one applier, so a status reported by both is applied once.
- **Atomic cascades (§5.21.4, §5.21.6)** — a sync-driven `DELIVERED` or `RETURNED` moves the order in the same transaction, so a customer refreshing during the update never sees a delivered shipment on a processing order.
- **No status write outside the transition service** — the ingestion paths call spec 12, and spec 12's database trigger blocks anything else.
- **Reads are consistent** — all three customer-facing views read the same `orders`/`shipments` rows (§4.7: "all backed by the same underlying shipment/order record"), so they cannot disagree.
- **The two identifiers stay distinct (§4.15)** — Track Order queries `courier_order_id`; the guest lookup queries `order_number`; neither endpoint falls back to the other's column.

## Acceptance criteria

1. A webhook with an invalid signature returns `401`, processes nothing, and records `signature_valid: false`.
2. A valid webhook moving a shipment `SHIPPED → IN_TRANSIT` applies once and writes one `order_status_history` row.
3. Replaying that identical webhook returns `200`, applies nothing, and records `skip_reason: 'DUPLICATE'`; history still has one row (§4.6).
4. Delivering `IN_TRANSIT` after `OUT_FOR_DELIVERY` is recorded as `STALE` and does not regress the status (§4.6).
5. A webhook and a poll reporting the same transition result in one application.
6. A sync-driven shipment `DELIVERED` moves the order to `DELIVERED` atomically; a COD order's `payment_status` remains `PENDING_COLLECTION` (§5.21.3, §5.21.4).
7. A sync-driven `DELIVERY_FAILED → RETURNED` moves the order to `RETURNED` and restores stock, atomically (§5.21.6).
8. `POST /api/track-order` with a valid courier id returns courier name, shipment status, events, and the tracking link; the payload contains **no** order status, no order number, no full address, no payment data, and no internal id (§4.14.3, §4.14.6).
9. An unknown tracking id and a tracking id belonging to another order return byte-identical responses (§4.16).
10. A store Order Number for an order with no shipment returns the §4.14.4 "not available yet" message, and no tracking identifier is fabricated.
11. `POST /api/orders/lookup` with a matching pair returns the §2.9.6 field set.
12. A correct Order Number with a wrong phone, and a nonexistent Order Number, return byte-identical responses with the same status code (§2.9.7).
13. The guest lookup response contains no risk-check data, no payment screenshot reference, no full Transaction ID, and no admin note (§2.9.6).
14. Phone formatting variants (`+880…`, `880…`, `01…`) all match the same order.
15. Exhausting the Track Order limiter does not affect the guest lookup limiter, and vice versa (§4.16).
16. Exceeding either limit returns `429` with `Retry-After` and a message that does not reveal whether the identifier exists (§11.2).
17. No route in this slice accepts an order id or customer id as a URL parameter for a public lookup.
18. `GET /api/customer/orders` returns only the session customer's orders; requesting another customer's order number returns `404`.
19. A customer who ordered as a guest and later claimed the account (§2.9.8) sees those orders in their history without any data migration.
20. An order without a shipment shows `trackOrder.available: false` and the account page renders "Shipment: Not yet created" (§4.14.5).
21. The header, mobile menu, and footer each contain a link labelled exactly "Track Order" pointing at `/track-order` (§4.14.8).
22. The order confirmation page from spec 11 does not claim tracking is available before a shipment exists (§4.14.7).
23. Order, payment, and shipment statuses render as three separate badges on the guest lookup and account pages (§5.21.11).
24. Two calls to Track Order within the refresh TTL produce at most one courier API call.
25. At 375px, `/track-order`, `/orders/lookup`, and the account order pages render with no horizontal scroll and 44px controls.

## Tests required

Per the `test` skill §1 (idempotent courier sync is a named required case) and §4 (public-endpoint abuse resistance).

1. **Idempotent sync — duplicate** (§4.6) — the same update twice applies once, with no duplicate history row. The PRD's named rule.
2. **Idempotent sync — out of order** (§4.6) — an older status after a newer one does not regress the shipment.
3. **Webhook and polling convergence** — the same transition from both paths applies once.
4. **Webhook signature verification** (§11.8) — an invalid signature processes nothing.
5. **Sync-driven cascades** (§5.21.4, §5.21.6) — `DELIVERED` and `RETURNED` cascade atomically; a forced failure in the order write leaves the shipment status unchanged too.
6. **COD payment untouched by delivery** (§5.21.3) — a delivered COD order remains `PENDING_COLLECTION`.
7. **Track Order non-enumeration** (§4.16) — unknown id, foreign id, and malformed-but-valid-shaped id produce identical bodies and status codes. The single most important security test here.
8. **Track Order payload hygiene** (§4.16) — a snapshot test of the exact key set, asserting the absence of order status, admin notes, risk data, payment data, full address, and internal ids. Written as a key-set assertion so a future field addition fails the test rather than leaking.
9. **No fabricated tracking** (§4.14.4) — before a shipment exists, no tracking id or courier result is produced.
10. **Guest lookup requires both values** (§2.9.5) — order number alone, phone alone, and a mismatched pair all fail.
11. **Guest lookup non-enumeration** (§2.9.7) — correct-number/wrong-phone and unknown-number are indistinguishable in body and status.
12. **Guest lookup payload hygiene** (§2.9.6) — key-set assertion excluding risk results, payment proof, full Transaction ID, and admin notes.
13. **Separate rate limiters** (§4.16) — exhausting one leaves the other usable; each has an under-limit success and an over-limit `429` (the `test` skill §4 pair, per endpoint).
14. **Phone normalization in lookup** — formatting variants match.
15. **Account order scoping** (§2.6) — a customer cannot read another's order by number.
16. **Claimed guest orders appear** (§2.9.8) — history is scoped by `customer_id`, so claimed orders appear with no migration.
17. **Status independence in customer views** (§5.21.11) — the three statuses are presented separately and never derived from one another.
18. **Courier refresh caching** — repeated tracking calls within the TTL produce one provider call.
19. **Track Order shows no order-status value** (§4.14.6) — asserted against the serialized payload.

## Open questions / assumptions

1. **Webhook support and signature schemes.** §4.6 hedges with "whether received via webhook or polling, depending on what the selected courier API supports," and §11.8 requires signature verification without naming a scheme (CLAUDE.md §6 forbids guessing an external API). *Assumption:* implement both paths; enable the webhook only for a provider whose current documentation defines one, and use that provider's documented signature mechanism. Polling is the guaranteed baseline, so tracking works even where no webhook exists.
2. **Polling schedule.** No PRD gives an interval. *Assumption:* every 15 minutes for shipments in active states, env-configurable, run by the deployment's scheduler rather than an in-process timer (§11.4). A tighter interval would multiply provider calls for little customer benefit.
3. **The §4.14.4 vs. §4.16 tension.** §4.14.4 requires an honest "not available yet" message when the customer has entered a store Order Number, while §4.16 requires that the endpoint never distinguish an existing identifier from a nonexistent one. *Assumption:* the resolution described above — the honest message is returned only for a real Order Number with no shipment, where no order detail is disclosed, and everything else is generic. **Flagged as a genuine tension between two sections of the same PRD**; the alternative (always generic) would violate the explicit wording and leave customers with no path forward.
4. **`courier_order_id` uniqueness across couriers.** §4.15 treats the identifier as courier-scoped. *Assumption:* the lookup returns the generic not-found on a multi-courier collision rather than guessing, which is both safe and consistent with §4.16. A collision is unlikely but not structurally prevented.
5. **Tracking event history depth.** §4.14.3 says events are shown "where the courier provides them." *Assumption:* whatever the adapter returns, normalized and capped at a reasonable number for display; no event is invented to fill a gap in the trail (§4.14.4's no-fabrication rule extends naturally here).
6. **Delivery-area summary.** §4.16 permits a "delivery area/address summary… not the full detailed address." *Assumption:* District plus the Upazila/Thana name — enough for the customer to recognize their own parcel, not enough to disclose a street address to someone holding only a tracking number.
7. **Guest lookup as GET vs. POST.** §2.9.7 forbids the Order Number appearing alone in a guessable lookup URL. *Assumption:* `POST` for both lookups, so identifiers never land in browser history, server access logs, or `Referer` headers — a stricter reading than the minimum, and consistent with §2.9.7's intent.
