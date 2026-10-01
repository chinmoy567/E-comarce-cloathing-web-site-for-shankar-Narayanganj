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

### Contract additions (decided — resolve the frontend gaps)

```ts
// POST /api/track-order — found:false gains a closed discriminator. The GENERIC body stays byte-identical for every
// non-enumerating case; NOT_AVAILABLE_YET is returned only in the single case §4.14.4 already allows.
type TrackOrderNotFound =
  | { found: false; reason: 'GENERIC'; message: string }
  | { found: false; reason: 'NOT_AVAILABLE_YET'; message: string };
// shipmentStatus on every payload is the ShipmentStatus ENUM, never a pre-formatted label; the frontend maps §3.8 labels.

// GET /api/customer/orders — row projection (no internal ids)
type CustomerOrderListItem = {
  orderNumber: string; placedAt: string; paymentMethod: 'BKASH' | 'COD';
  orderStatus: OrderStatus; paymentStatus: PaymentStatus; shipmentStatus: ShipmentStatus;
  totalAmount: number; itemCount: number;
};

// GET /api/customer/orders/:orderNumber — and POST /api/orders/lookup — gain:
type CustomerStatusEvent = { kind: 'ORDER' | 'PAYMENT' | 'SHIPMENT'; status: string; occurredAt: string };
//   statusHistory: CustomerStatusEvent[]        // from order_status_history: status + time ONLY — no actor, reason, note, or id
//   purchaseEventId: string | null              // 'purchase:<orderNumber>' once the order has reached CONFIRMED, else null (spec 18)

// Guest payment resubmission (spec 11's PaymentSubmissionRequest) gains the proof of ownership the 404 rule already implies:
type PaymentSubmissionRequest = { idempotencyKey: string; transactionId?: string; phoneNumber: string };  // matched with orderNumber in one indexed query; mismatch → the same generic 404
```

`statusHistory` is the customer-safe projection of the same rows the admin timeline reads (spec 13), so the three views cannot disagree (§4.7).

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

### Frontend build detail

The bullets above stay as the behavioural summary. This section pins how they are built, using only the endpoints and response fields defined in **Backend work** above. Needs the backend does not cover are listed under **Backend gaps**.

#### Pages and access

| Route | Who | Failure handling |
| --- | --- | --- |
| `/track-order` (new, `app/track-order/page.tsx`) | **Public.** No session check, no login redirect (§4.14, §5.19). | `429` → the shared rate-limit message from `ApiClientError` plus "Try again in N seconds" from `retryAfter`; submit disabled until it elapses. `400 VALIDATION_ERROR` → "Enter a valid Order ID / Tracking ID." Network error → `ApiClientError`'s connection message. Every `found: false` shows the backend `message` verbatim. There is no 403 on this route. |
| `/orders/lookup` (exists, `app/orders/lookup/page.tsx`) | **Public.** | `429` → rate-limit message with `retryAfter`. **Every other failure, including `400` and `5xx`, renders the single generic "We could not find an order matching those details."** (the existing form already collapses errors this way — keep it). Connection failure is the one other distinguishable message, because the customer must act on it. |
| `/account/orders` (exists) | Customer session (`requireCustomerSession`, `lib/requireCustomerSession.ts`) | `401` → redirect to `/auth/login` (the pattern already in `OrderDetailView.tsx`). |
| `/account/orders/[orderNumber]` (exists as `[id]`) | Customer session | `401` → login; `404 NOT_FOUND` → "We could not find that order." (identical for "not yours" and "does not exist"). |

All four pages export `robots: 'noindex, nofollow'` via the Metadata API (the lookup and account pages already do; add it to `/track-order`) and are absent from `app/sitemap.ts`. Titles use `pageTitle('Track Order')` etc. from `lib/site.ts`. These are the only pages in the slice; the webhook and polling ingestion have no UI.

**Navigation (§4.14.8).** The entry is labelled exactly **"Track Order"** and points to `/track-order` in: `SiteHeader.tsx` (desktop nav **and** the mobile menu/drawer — the current header hides the link below `sm`, which violates §4.14.8; spec 07's hamburger drawer must carry it), `SiteFooter.tsx`. Both currently point at `/orders/lookup`; they must be repointed. `/orders/lookup` is reached from a link on `/track-order`, from the checkout confirmation, and from the account area — it has no nav label named "Track".

#### Components

| Component | File | Props | Reuses |
| --- | --- | --- | --- |
| `TrackOrderForm` | `components/orders/TrackOrderForm.tsx` (new) | none | `apiPost` (`lib/apiClient.ts`) |
| `TrackingResult` | `components/orders/TrackingResult.tsx` (new) | `result: Extract<TrackOrderResponse, { found: true }>` | `StatusBadge`/`toneFor`, `shipmentStatusLabel`, `formatDate` |
| `ShipmentProgressTrail` | `components/orders/ShipmentProgressTrail.tsx` (new) | `events`, `currentStatus` | `shipmentStatusLabel`, `formatDate` |
| `TrackingNotFound` | `components/orders/TrackingNotFound.tsx` (new) | `message: string` | — |
| `GuestOrderLookupForm` | `components/orders/GuestOrderLookupForm.tsx` (exists; rebuild) | none | `apiPost` |
| `GuestOrderResult` | `components/orders/GuestOrderResult.tsx` (new) | `result: Extract<GuestOrderLookupResponse, { found: true }>`, `lookup: { orderNumber; phoneNumber }` | the shared pieces below |
| `CustomerOrderStatusBadges` | `components/orders/CustomerOrderStatusBadges.tsx` (extracted from `OrderDetailView.tsx`; deliberately not the admin `components/admin/orders/OrderStatusBadges.tsx`, which is back-office styling) | `orderStatus`, `paymentStatus`, `shipmentStatus` | `StatusBadge`, `toneFor`, `orderStatusLabel`, `paymentStatusLabel`, `shipmentStatusLabel` (`lib/account.ts`) |
| `OrderItemsAndAmounts` | `components/orders/OrderItemsAndAmounts.tsx` (extracted) | `items`, `amounts`, `appliedCouponCode` | `formatMoney` |
| `OrderHistoryList` | `components/account/OrderHistoryList.tsx` (exists) | none | `apiList` |
| `OrderDetailView` | `components/account/OrderDetailView.tsx` (exists) | `orderNumber: string` (rename from `orderId`) | the two extracted components |
| `TrackOrderAction` | `components/account/TrackOrderAction.tsx` (new) | `trackOrder: { available: boolean; trackingId: string \| null }` | — |

The three status badges and the item/amount block are shared between the guest result and the account detail so the two views cannot diverge (§4.7: all views read the same record). The single label map is the one already in `lib/account.ts`; do not create a second.

#### Data: endpoint → fields shown

| Component | Endpoint | Fields rendered |
| --- | --- | --- |
| `TrackOrderForm` | `POST /api/track-order` `{ trackingId }` | on `found: true`: `trackingId` (monospace), `courierName`, `shipmentStatus` (enum → `shipmentStatusLabel`; the API's "display label per §3.8" is rendered through the label map, not trusted as pre-formatted), `events[].status/occurredAt/description`, `estimatedDeliveryAt`, `deliveryAreaSummary` (shown as "Delivering to {area}"), `courierTrackingUrl`. On `found: false`: `message` verbatim. |
| `GuestOrderLookupForm` | `POST /api/orders/lookup` `{ orderNumber, phoneNumber }` | `orderNumber`, `placedAt`, `orderStatus`, `paymentStatus`, `shipment.shipmentStatus` (three separate badges), `paymentMethod`, `amounts.subtotal/discountAmount/shippingAmount/totalAmount`, `appliedCouponCode`, `items[].productName/variantLabel/quantity/unitPrice/lineTotal`, `deliveryAddressSummary` (a **string**), `shipment.courierName/trackingId/trackingUrl` or "Shipment: Not yet created", `paymentResubmissionAllowed` |
| `OrderHistoryList` | `GET /api/customer/orders?page&pageSize` | the list rows carry order number, date, status badges and total (§2.6); exact projection is not specified — gap 2. Pagination block `{page,pageSize,total,totalPages}` from `apiList`. |
| `OrderDetailView` | `GET /api/customer/orders/:orderNumber` | the guest field set plus the full `deliveryAddress`, and `trackOrder.available` / `trackOrder.trackingId` |

`courierTrackingUrl`/`trackingUrl` render as a link only when non-null and `https://`, with `target="_blank" rel="noopener noreferrer"`.

#### States

**`/track-order`**

| State | Behaviour |
| --- | --- |
| Idle | Form with the §4.14.3 helper text. No result area. |
| Loading | Button shows "Checking…" (the `Button` loading text), input read-only, result region `aria-busy`. |
| Success (`found: true`) | `TrackingResult`: header with tracking ID + courier, one shipment-status badge, the progress trail, estimated delivery when non-null, delivery area when non-null, the courier link when non-null. A second lookup replaces the result. |
| Not found (`found: false`) | `TrackingNotFound`: the backend message in a `role="status"` region, plus a secondary link "Look up your order with your Order Number and phone number" → `/orders/lookup`. The link is shown **only** when `reason === 'NOT_AVAILABLE_YET'`; the message text itself is never altered or interpreted. |
| Validation | Format check before any request: trimmed, 4–64 characters, `[A-Za-z0-9_-]`. A failing value shows the inline error and sends nothing. |
| Rate-limited / error | As in the access table; the previous result is cleared so an old tracking result is never shown next to a new error. |
| Disabled | Submit disabled while loading, while rate-limited, and while the field is empty. |
| Double-click | An `inFlight` ref makes a second submit a no-op; an `AbortController` cancels the in-flight request if the value changes and is resubmitted. The same value submitted twice produces one request. |

**`/orders/lookup`** — same shape: Idle → Loading → Success (`GuestOrderResult`) / Generic failure / Rate-limited. The result is held in component state only and is cleared when either field is edited. A second `Find My Order` while loading is ignored. `paymentResubmissionAllowed: true` shows a **Submit payment information** button (48px) that opens spec 11's resubmission form with `lookup.orderNumber` and `lookup.phoneNumber` passed **in memory** — not in the URL, `localStorage`, or `sessionStorage`.

**`/account/orders`** — Loading (skeleton rows), Empty ("You have not placed any orders yet." + Shop link), Error (message + Retry button, already present), Success with Previous/Next. Page changes ignore stale responses.

**`/account/orders/[orderNumber]`** — Loading, Error/404, Success. `TrackOrderAction` shows, when `trackOrder.available` is true, a **Track Order** button (48px) that stores `trackOrder.trackingId` in `sessionStorage` under one key and navigates to `/track-order`; the form reads and clears the key on mount and **pre-fills the input without submitting**. When `available` is false it shows exactly "Shipment: Not yet created" and "Tracking: Not available yet" (§4.14.5) with no button. *Why not a query string:* the root `<PixelInit />` sends the full page URL to Meta (spec 18), and a tracking identifier must not travel there.

#### Forms

| Form | Fields | UX-only validation | Errors |
| --- | --- | --- | --- |
| Track Order | `Order ID / Tracking ID` (text, required, `autoComplete="off"`, `autoCapitalize="off"`, `spellCheck={false}`), helper text exactly as §4.14.3 | trim; 4–64 chars; allowed characters | inline message under the field; backend `VALIDATION_ERROR` shown the same way |
| Guest lookup | `Order Number` (text, required), `Phone Number` (`type="tel"`, `inputMode="tel"`, placeholder `01XXXXXXXXX`, required) | both non-empty; phone accepts `+880…`, `880…`, `01…` (no stripping — the backend normalizes) | **one** generic message for every non-429 failure; never says which field was wrong |

Labels are always visible above the inputs (not placeholders), inputs 16px font / 44px+ height, submit 48px full-width on mobile.

#### Progress trail and status display

`ShipmentProgressTrail` renders the shipment lifecycle from the **normalized `events` only**:

- Nodes are, in order, `CREATED → SHIPPED → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED`, each labelled with `shipmentStatusLabel()`. A node is "reached" when an event with that status exists or a later node is reached; its timestamp is `occurredAt` and is shown **only** when an event supplies it. A node with no event never shows an invented time or description.
- `DELIVERY_FAILED` and `RETURNED` render as terminal exception nodes in place of the remaining nodes, not as a second trail.
- Current status is the response's `shipmentStatus`; the current node carries a text "Current" marker (not colour alone) and `aria-current="step"`.
- Rendered as an ordered list: vertical on mobile, horizontal from `md`.
- **Clarification of the bullet above:** the bullet's trail names ("Order Confirmed", "Picked Up") are narrative. `frontend` §2 and §4.14.6 forbid showing an order-status value on this page and require exact enum values with the §3.8 labels, so the trail starts at "Created" and uses "Shipped" for the `SHIPPED` enum. See the conflicts list.

Order, payment and shipment status are three separate badges wherever they appear together (guest result, account detail, account list rows) — never merged, never derived from each other.

#### Responsive behaviour and accessibility

- 375px first, verified at 320px, no horizontal scroll; forms are single-column at every width up to `md` and constrained to `max-w-md` above it.
- Controls ≥ 44px, primary submit and Track Order button 48px; 8px between adjacent targets.
- Result regions are `aria-live="polite"`; errors `role="alert"`; focus moves to the result heading after success and to the first invalid field on a validation error.
- Tracking IDs and order numbers use the monospace token and `break-all` so they wrap on 320px.
- No timers, no auto-refresh, no animation beyond the loading label.

#### Analytics

No page in this slice fires an event of its own. The root `<PixelInit />` fires `PageView` as for every route. Customer order pages are where spec 18's opportunistic **Pixel-side `Purchase`** would be attached (see spec 18 frontend detail and its gap on `purchaseEventId`); until the order payloads carry that id, these pages fire nothing.

#### What the frontend must NOT do

- Gate `/track-order` or `/orders/lookup` behind a session, or redirect a guest to login.
- Merge the two lookups into one form, one endpoint, one result, or share a limiter assumption between them (§4.14.1).
- Show an order-status value, order number, payment data, full address, or internal id on the Track Order result.
- Tell a customer which field of a failed lookup was wrong, or vary wording between "unknown" and "mismatch".
- Fabricate a tracking ID, an event, a timestamp or an estimated date; synthesize a "Preparing" step when there is no shipment.
- Put an Order Number, phone number or tracking ID in a URL, `localStorage`, analytics payload or log line; use `GET` for either lookup; cache lookup results.
- Link to or accept an internal order id (the current list links to `/account/orders/${order.id}` — see below).
- Decide `paymentResubmissionAllowed`, `trackOrder.available`, or any status itself.
- Claim tracking is available before a shipment exists — including on spec 11's order-confirmation view (§4.14.7): that page must say the customer can track the order once it ships, and offer the guest lookup / Track Order link, not a tracking promise.

#### Existing code to reconcile

- `GuestOrderLookupForm.tsx` calls `GET /api/customer/orders/lookup?order_number=&phone_number=` and models `deliveryAddressSummary` as an object and `shipment.courier`; the spec is `POST /api/orders/lookup` with `{ orderNumber, phoneNumber }` and a string summary. Rebuild against the spec's types.
- `OrderDetailView.tsx` / `OrderHistoryList.tsx` / `app/account/orders/[id]` use the internal `id` (`/account/orders/${order.id}`, `OrderSummary.id`). The route and API are `:orderNumber` (acceptance 17/18); remove `id` from the summary/detail types and the links.
- `OrderDetailView.tsx` shows "A courier shipment has not been created for this order yet." — replace with the §4.14.5 wording above, and add `TrackOrderAction`.
- `SiteHeader.tsx`, `SiteFooter.tsx` and `CheckoutWizard.tsx` (line ~210) link "Track Order" to `/orders/lookup`; the header hides it below `sm`.
- `lib/account.ts` `ShipmentInfo` uses `courier`; the spec's tracking block uses `courierName`/`trackingUrl`.

#### Backend gaps (all resolved — see Contract additions and Gap resolutions)

1. **The two `found: false` responses are indistinguishable** (`{ found: false, message }` for both the generic and the §4.14.4 "not available yet" cases), so the frontend cannot show the guest-lookup pointer only in the second. Interim: the pointer is shown for both. A `reason` field would allow the narrower behaviour; it must stay non-enumerating.
2. **`GET /api/customer/orders` has no defined row projection.** The list needs order number, date, three statuses and total; only the detail shape is specified (as "the guest field set plus…").
3. **No status history or event list in the customer order detail**, yet the account detail is asked to show "a vertical timeline with checkmarks." Without events the frontend can show only the three current-status badges and the Track Order action; it will not synthesize a timeline from the current status.
4. **Payment resubmission from the guest lookup has no proof-of-ownership field.** Spec 11's `PaymentSubmissionRequest` carries `idempotencyKey` and `transactionId` only, while its error table implies an order/phone check. The form needs the phone to be part of that request (or a short-lived token returned by the lookup).
5. **`purchaseEventId` is absent** from the guest lookup and customer order payloads (needed by spec 18's Pixel `Purchase`).
6. **Track Order `shipmentStatus` is described as a "display label per §3.8"** but typed as the enum. The frontend maps the enum itself; confirm the API returns the enum.

#### Spec-vs-spec / spec-vs-PRD conflicts (decisions in Gap resolutions)

- Bullet trail ("Order Confirmed … Picked Up") versus §4.14.6, `frontend` §2 and the §3.8 label map: resolved in favour of the PRD/skill as described above.
- Spec 15's routes (`/track-order`, `/account/orders/[orderNumber]`) versus the implemented `/orders/lookup` nav links and `[id]` account route.
- The `design` skill's Order Tracking page (status timeline, "Payment Verified", "Estimated delivery") implies order-status steps and data the customer payloads do not carry; the PRD-aligned, data-backed subset above is what is built.

#### Gap resolutions and frontend consequences

| Gap | Decision |
| --- | --- |
| 1 | `reason` discriminates the two `found:false` cases. The guest-lookup pointer link is shown **only** for `NOT_AVAILABLE_YET`; `GENERIC` shows the message alone (no hint that an order may exist). Wording is the backend `message` verbatim in both. |
| 2 | `CustomerOrderListItem` above; `OrderSummary` in `lib/account.ts` drops `id` and gains `placedAt`, `itemCount`. Links are `/account/orders/${orderNumber}`. |
| 3 | The account detail renders a real vertical timeline from `statusHistory` (three kinds shown with their own labels, checkmark per reached entry, timestamp from `occurredAt`). No step is synthesized when the history is empty. |
| 4 | The resubmission form sends `phoneNumber` (held in memory from the lookup form) with the order number; the order-scoped route stays unauthenticated. |
| 5 | `purchaseEventId` is returned as above and consumed by spec 18's `PurchasePixel`. |
| 6 | The API returns the enum; the frontend owns labels. |

**Conflicts decided.** (a) Trail nodes use §3.8 labels from the shipment enum; the narrative "Order Confirmed"/"Picked Up" names are dropped. (b) Navigation points to `/track-order`; `/orders/lookup` remains the guest lookup and is linked from the Track Order page, checkout confirmation and account area. (c) The account detail route is `/account/orders/[orderNumber]`. (d) The `design` skill's order-tracking timeline is satisfied by `statusHistory`, not by invented steps.

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
