# Spec 15 Implementation Plan — Status Sync, Track Order, Guest Lookup, Order History

Spec: `.claude/implementation specs/15-status-sync-track-order-and-guest-lookup.md`

## Context

Customers currently can't see shipment progress. Spec 15 adds three separate paths (public Track Order by courier ID, guest lookup by Order Number + phone, account order history) plus idempotent courier status ingestion (webhook + polling). Exploration found the repo is *behind* the spec's assumptions:

- **Spec 12 applier is not built**: no `applyCourierStatusUpdate()`, `shipment_sync_events`, or `shipments.status_sequence`. Existing `shipment.service.ts` (live path, no cascade) and orphaned `shipmentStatus.service.ts` (cascades, but no dup/stale handling).
- **No real Pathao/Steadfast adapters**; adapter interface has no webhook parse/verify. CLAUDE.md §6 forbids guessing provider APIs.
- State machine has no `CREATED→IN_TRANSIT`; `CREATED→SHIPPED` is ADMIN-only.
- Existing customer endpoints diverge from spec: `GET /api/customer/orders/lookup` (query string, 404 on miss), `GET /api/customer/orders/:id` (UUID, leaks internal ids/full address).
- Frontend: no `/track-order`; header hides Track Order below `sm`; nav/footer/checkout point to `/orders/lookup`; account routes use `[id]`; no DOM test env.

**Decisions (user-confirmed):** build a *minimal* applier inside spec 15; build a *provider-agnostic* webhook/polling framework tested with the fake adapter (real provider signature schemes wait for official docs).

## Spec-vs-repo corrections to apply
- Column is `orders.phone_number` (not `contact_phone`). `order_number` is already UNIQUE → composite index adds little; add it only if cheap, otherwise skip and note.
- `shipments.courier_error`/`courier_error_at` (not `last_error`).
- `req.actor` has no `customerId`; resolve via `usersRepository.findById(actor.userId).customerId` (as existing controllers do).
- `trackOrder` limiter keys on `body.orderNumber ?? body.trackingNumber`; spec's field is `trackingId` → extend `extractIdentifier` in `src/middleware/rateLimit.ts` to also read `trackingId` (else all requests share one `'unknown'` bucket).
- Global `express.json` gives no raw body → webhook route mounted with its own `express.raw` before the global parser.

## Backend

### Migration `backend/migrations/0015_tracking_lookup.sql` (forward-only, no txn control, IF NOT EXISTS)
- `shipments.status_sequence integer NOT NULL DEFAULT 0` (backfill from status ordinals: NOT_CREATED0…DELIVERED6; failures inherit).
- `shipment_sync_events(id, shipment_id FK, courier_code, provider_event_id, status, applied bool, skip_reason text CHECK DUPLICATE|STALE|INVALID_TRANSITION|UNKNOWN_SHIPMENT|NULL, occurred_at, created_at)` with UNIQUE `(shipment_id, provider_event_id) WHERE provider_event_id IS NOT NULL` plus a dedupe key (shipment_id,status,occurred_at) for providers without event ids.
- Index `shipments(courier_order_id)`; `courier_webhook_deliveries(id, courier_code, signature_valid, payload_digest, http_status_returned, received_at)` (digest only, no body).
- `shipments.last_synced_at`, `shipments.last_events jsonb` (cached normalized events for TRACK_REFRESH_TTL).

### Minimal applier (`src/services/shipmentSync.service.ts`)
`applyCourierStatusUpdate({shipmentId|courierCode+courierOrderId, status, providerEventId?, occurredAt?})`:
1. In `withTransaction`, lock shipment+order (`forUpdate`), insert sync event; unique hit → `DUPLICATE`.
2. `sequenceOf(status) <= status_sequence` (non-failure) → `STALE`, no write.
3. Otherwise apply via existing `shipment.service` `transitionInTx` / order cascade for `DELIVERED` and `RETURNED` (order must be PROCESSING; reuse `orderStatus.service` logic with client, restore stock on RETURNED; COD payment stays `PENDING_COLLECTION`). Write `order_status_history` only when applied; bump `status_sequence`.
4. Handle no-skip state machine: sync-driven `CREATED→SHIPPED` is allowed only for SYSTEM actor if the courier reports a later status (chain intermediate transitions in the same txn, each recorded) — **confirm against 07-order-state-machine.md §5.21.9 before coding; if disallowed, record `INVALID_TRANSITION` and don't force it.**
5. Unrecognized/`null` status → log + ignore. Errors from cascades roll back shipment change too (atomic).
Add `shipmentsRepository.findByCourierOrderId`, `listPollable`, and `syncEventsRepository`. Delete or reconcile orphaned `shipmentStatus.service.ts` only if nothing imports it (verify with grep; otherwise leave).

### Ingestion framework
- Extend `CourierAdapter` (`src/services/courier/types.ts`) with optional `verifyWebhook(rawBody, headers)` and `parseWebhook(rawBody) → {courierOrderId, status, providerEventId?, occurredAt?}`; add optional `webhookSecretEnv`. Add env vars (`TRACK_REFRESH_TTL_SECONDS=300`, `COURIER_POLL_INTERVAL`, per-courier webhook secret names) in `src/config/env.ts`.
- `POST /api/webhooks/courier/:courierCode` (`routes/webhooks.routes.ts`, controller): `rateLimit('publicCeiling')`, raw-body, adapter lookup, signature verify → invalid = 401 + record `signature_valid:false`, no processing; valid → parse → applier; return 200 for applied/duplicate/stale/unknown. Courier without webhook support → 200-ignored/404 per spec table.
- Poller: `scripts/pollCourierStatus.ts` + `npm run poll:couriers`, calling `courierService.trackShipment` for shipments in CREATED/SHIPPED/IN_TRANSIT/OUT_FOR_DELIVERY/DELIVERY_FAILED whose courier `supports_tracking`, funnelling into the same applier (deployment scheduler runs it; no in-process timer).

### Public endpoints
- `POST /api/track-order` (`rateLimit('trackOrder')`, zod `.strict()` `{trackingId}` 4–64 `[A-Za-z0-9_-]`): lookup by `courier_order_id`; multi-match or not-found-or-not-CREATED → identical generic body, 200. `NOT_AVAILABLE_YET` only when value matches order-number format, order exists, no shipment. Optional courier refresh gated by `last_synced_at` + TTL (one provider call per TTL). Response via a single `toTrackingView()` projection (enum `shipmentStatus`, events, estimatedDeliveryAt, deliveryAreaSummary = district + upazila/thana, courierTrackingUrl — resolve with the template helper; export `resolveTrackingUrl` from `shipment.service.ts`). `found:false` carries `reason: 'GENERIC'|'NOT_AVAILABLE_YET'`.
- `POST /api/orders/lookup` (`rateLimit('guestOrderLookup')`, `{orderNumber, phoneNumber}`): `normalizeBdPhone` (invalid phone → same generic miss, not 400 leak), single query on `(order_number, phone_number)`, generic `found:false` for every failure, 200. `toGuestOrderView()` projection incl. items, amounts, coupon, address summary string, shipment block, `paymentResubmissionAllowed`, `statusHistory` (status+time only), `purchaseEventId`.
- Keep the old `GET /api/customer/orders/lookup` only if spec-11 tests still need it; otherwise remove and update `tests/spec-11-checkout`.
- `GET /api/customer/orders` → `CustomerOrderListItem[]` (no ids); `GET /api/customer/orders/:orderNumber` (replaces UUID `:id`) → guest field set + full own delivery address + `trackOrder{available,trackingId}` + `statusHistory`; 404 if not owned. Scoped by session customer.
- Spec-11 payment resubmission: add `phoneNumber` to `PaymentSubmissionRequest` for guests (generic 404 on mismatch).
- Shared projection functions are the only serializers; never include internal ids, notes, risk data, proof, full txn id.

## Frontend (`frontend/src`)
- `lib/account.ts`: drop `id` from `OrderSummary`/`OrderDetail`, add `placedAt`, `itemCount`, `trackingUrl`, `courierName`, `statusHistory`, tracking types; keep single label map.
- New: `app/track-order/page.tsx` (noindex, `pageTitle('Track Order')`; add `/track-order` to `robots.ts` disallow), `components/orders/{TrackOrderForm,TrackingResult,ShipmentProgressTrail,TrackingNotFound,GuestOrderResult,CustomerOrderStatusBadges,OrderItemsAndAmounts}.tsx`, `components/account/TrackOrderAction.tsx`.
- Rebuild `GuestOrderLookupForm` to `POST /api/orders/lookup` (generic error collapse, `retryAfter` countdown, state cleared on edit, no phone/order in URL).
- Rename `app/account/orders/[id]` → `[orderNumber]`; update `OrderHistoryList` links and `OrderDetailView` (§4.14.5 wording, timeline from `statusHistory`, `TrackOrderAction` using `sessionStorage` prefill, not query string — PixelInit leak risk).
- Nav (§4.14.8): `SiteHeader` show "Track Order" on mobile (add compact menu or visible link below `sm`) → `/track-order`; `SiteFooter` repoint; `CheckoutWizard` confirmation: use `Link`, no tracking promise, link to `/track-order` and guest lookup, add `/account/orders` link for logged-in users.
- Tracking/Open links only when `https://`, `rel="noopener noreferrer"`.

## Tests
- Backend: new `tests/spec-15-tracking/` + `config/vitest/spec15/vitest.config.ts` (copy spec14) + `test:spec15` script. Make fake adapter scriptable (`setTrackResult`, `verifyWebhook`/`parseWebhook`). Cover spec's 19 required tests: duplicate/out-of-order/webhook+poll convergence, signature invalid, atomic cascades + forced-failure rollback, COD stays PENDING_COLLECTION, track non-enumeration and key-set hygiene, no fabrication, guest lookup pair/non-enumeration/hygiene/phone variants, separate limiters (under/over limit each), account scoping + claimed guest orders, refresh TTL = one provider call, no order-status in track payload. Update spec-11 tests and route/pagination invariants tests for changed routes.
- Frontend: vitest is node-only (no jsdom/RTL) → pure-logic tests only (progress-trail node derivation, label/tone maps, tracking-id validator, link safety). Do not add a DOM env unless user asks.

## Order of work
1. Read `07-order-state-machine.md` §5.21 + `04-courier-shipment.md` §4.6/4.14 to settle the CREATED→later-status chaining question.
2. Migration 0015 + repos + applier + tests (1–6).
3. Webhook route + poll script + adapter interface extension.
4. Public endpoints + projections + limiter fix + customer history rework + tests.
5. Frontend pages/components/nav changes.
6. Verification.

## Verification
- `npm run typecheck` and `npm run test:spec15`, plus `test:spec11`, `test:spec14`, `test:spec04`, shared enum/migration tests (needs `TEST_DATABASE_URL`).
- `npm run migrate` against a disposable schema; confirm 0015 applies cleanly.
- Manual: run app; POST a signed fake webhook twice (one applied, one DUPLICATE), out-of-order event (STALE); hit `/track-order` with unknown/foreign/valid IDs and diff bodies; guest lookup with wrong phone vs unknown number; check 375px layouts and that header/footer/mobile show "Track Order" → `/track-order`.
- `grep` frontend for credentials and confirm no order/phone/tracking id appears in URLs.

## Open items to flag to user
- Real Pathao/Steadfast webhook signatures and status mappings remain unimplemented until official docs are consulted.
- Spec's composite `(order_number, phone)` index is nearly redundant given UNIQUE `order_number`.
