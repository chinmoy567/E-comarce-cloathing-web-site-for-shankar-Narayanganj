# 14 — Courier Service Abstraction and Shipment Creation (Pathao, Steadfast)

## Goal

After this slice a confirmed order can be shipped without anyone retyping customer details into a courier portal. A data-driven courier registry holds the available providers; one common interface — Create Shipment, Get Shipment Details, Track Shipment, Cancel Shipment — is implemented by a Pathao adapter and a Steadfast adapter, each normalizing its provider's fields and statuses into the platform's shared vocabulary. The Admin/Manager selects a courier and creates a shipment from the order panel; the `CREATING` state acts as a concurrency lock; failures are recorded and retryable with a different courier; and the Cancel Shipment port that spec 12's cancellation rule depends on is finally registered.

## Requirement references

- `04-courier-shipment.md` §4 — shipment processing through couriers such as Pathao and Steadfast; the Admin/Manager must **not** manually copy and paste customer or order information.
- `04-courier-shipment.md` §4.1 — after confirming an order, select a courier; the selected courier is associated with the shipment.
- `04-courier-shipment.md` §4.2 — the information sent to the courier (name, mobile, address, Division, District, Upazila/Thana, Union/Ward, postal code, order reference, product info, order amount, COD amount, parcel weight, delivery instructions, other provider-required fields); **order amount and COD amount are the server-computed final total after any coupon discount**, using the existing order-total field with no new field introduced; exact field names and formats are mapped at the adapter layer, and the internal schema is not assumed to match any provider's.
- `04-courier-shipment.md` §4.3 — a bKash shipment may be created only after payment verification and order confirmation.
- `04-courier-shipment.md` §4.4 — a COD shipment follows manual customer confirmation; the COD amount is sent so the courier can collect; payment stays `Pending Collection` until collected, updated by courier sync or manually.
- `04-courier-shipment.md` §4.5 — store the returned Parcel ID / Consignment ID / Tracking ID against the shipment and order; the Admin/Manager can view courier and tracking information.
- `04-courier-shipment.md` §4.8 — courier integration runs in the Express backend, never from the React frontend; courier credentials remain on the backend and are never exposed.
- `04-courier-shipment.md` §4.9 — a common courier service layer with the four operations; each implementation conforms to the **same method contract — same input shape, same return shape**; provider-specific fields and statuses are **normalized into the shared status vocabulary** before returning to the core system; "Pathao" and "Steadfast" are illustrative, **not a hardcoded closed set** — the courier list must be data-driven so a third can be added without changing a fixed enum.
- `04-courier-shipment.md` §4.11 — shipment-creation failure handling: record the failure, display the error in the Order Panel, keep the order `Confirmed`/`Processing`, allow retry, allow changing courier, prevent `Shipped` until creation succeeds and the parcel is handed over; **no automatic duplicate shipment when the courier API is temporarily unavailable**; the **concurrent creation guard** — while a shipment is `CREATING`, a second Create Shipment request for the same order must be rejected rather than dispatched concurrently; retry only once settled into `CREATION_FAILED`.
- `04-courier-shipment.md` §4.15 — the internal store Order Number ≠ the courier Order ID / Parcel ID / Tracking ID; the shipment record holds `shipment_id`, `order_id`, `courier`, `courier_order_id`/`parcel_id`/`tracking_id`, `shipment_status` — **no duplicate identifier fields are introduced**.
- `05-admin-operations.md` §5.5 — the back-office courier/shipment management flow and its field list; credentials never reach the frontend.
- `05-admin-operations.md` §5.6 — shipment failure handling in the panel; a courier API failure must not auto-reject a verified payment, auto-cancel a confirmed order, or mark the shipment Shipped.
- `07-order-state-machine.md` §5.21.4–§5.21.6, §5.21.9 — the shipment lifecycle, failure states, retry paths, and the actor for each shipment transition.
- `07-order-state-machine.md` §5.21.7 — if a shipment is `Created` or later when an order is cancelled, the courier's Cancel Shipment must be called; a courier that cannot cancel blocks or escalates the cancellation.
- `06-rbac.md` §5.16 — `courier.manage` (provider/API configuration) and `courier.select` (per-order selection) are **two distinct permissions**; `shipment.create` for creation.
- `06-rbac.md` §5.18 — Shipment View/Creation/Tracking/Retry, Courier Selection, Change Courier (all Yes/Yes); Courier Configuration (Yes/Assigned).
- `10-coupon-discount.md` §8.21 — courier shipment creation sends the amount fields exactly as already specified, now sourced from the discounted final total; **no change to the courier abstraction or adapters is required by the coupon feature**.
- `11-security-hardening.md` §11.6 (validation), §11.8 (webhook signature verification), §11.9 (secrets in env only).
- Skills: `backend` §5, `security` §7, `test` §1, `database` §3, `design` (Shipment Creation modal).

## Depends on

- **01** — API conventions, errors, env loading.
- **02** — the address model and its discriminators, `withTransaction`, `audit_logs`.
- **03** — `requirePermission`.
- **04** — `safeFetch` (SSRF-guarded outbound HTTP), `authenticatedCeiling`.
- **11** — `orders`, `order_items`, `shipments`.
- **12** — `transitionShipmentStatus()`, the `CourierCancellationPort` interface, `status_sequence`.
- **13** — the admin order detail page, whose shipment slot this slice fills.

## Scope

**In scope**

- `couriers` registry table (data-driven, per §4.9) and `courier_credentials` configuration.
- The `CourierAdapter` interface and its four operations with one shared input/output contract.
- Pathao and Steadfast adapters, including status normalization.
- Shipment creation with the `CREATING` concurrency lock, retry, and change-courier.
- Parcel/tracking identifier storage.
- Mark-as-shipped (parcel handover).
- `CourierCancellationPort` implementation, registered with spec 12.
- Courier configuration admin endpoints (`courier.manage`).
- Admin frontend: courier selection and shipment creation modal, failure display, retry/change courier.

**Out of scope / deferred**

- Courier status **synchronization** (webhooks/polling) and the public Track Order page — spec **15**. This slice implements the `trackShipment` adapter method and leaves the ingestion path to spec 15.
- Courier performance analytics — spec **20**.
- The exact Pathao and Steadfast request/response schemas — **§6 of CLAUDE.md and §7.3 of the fraud PRD both forbid guessing an external API**. The adapters are written against the current official documentation at implementation time; this spec defines the contract they must satisfy, not the provider payloads.

## Database changes

Migration file: `backend/migrations/0014_couriers_and_shipments.sql`

### `couriers` — the data-driven registry (§4.9)

§4.9 is explicit that the courier list must not be "a fixed enum of courier names," so providers are rows, not enum values.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `code` | `text` | NOT NULL | — | PK, e.g. `PATHAO`, `STEADFAST` |
| `name` | `text` | NOT NULL | — | Display name |
| `adapter_key` | `text` | NOT NULL | — | Which registered adapter implementation handles it |
| `is_enabled` | `boolean` | NOT NULL | `true` | Available for selection |
| `supports_cancel` | `boolean` | NOT NULL | `true` | Drives §5.21.7's cancellation rule |
| `supports_tracking` | `boolean` | NOT NULL | `true` | §4.6 "where supported by the courier API" |
| `tracking_url_template` | `text` | NULL | — | e.g. `https://…/{trackingId}` (§2.9.6, §4.14.3's tracking link) |
| `display_order` | `integer` | NOT NULL | `0` | |
| `config` | `jsonb` | NOT NULL | `'{}'` | Non-secret settings (store id, default weight, zone defaults) |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

Seeded with `PATHAO` and `STEADFAST`. Adding a third courier is an insert plus an adapter module — no migration, no enum change, no order-management change (§4.9).

**Credentials are not stored here.** They live in environment variables (`PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`, plus base URLs), resolved by adapter key (§4.8, §5.5, §11.9). The `database` skill §4 is explicit that third-party secrets do not belong in an application-queryable table.

### `shipments` — completed

Spec 11 created the row; spec 12 added `status_sequence` and the error columns. This migration completes it, using **exactly** §4.15's field list with no duplicate identifiers:

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK — §4.15's `shipment_id` |
| `order_id` | `uuid` | NOT NULL | FK → `orders(id)`; `UNIQUE` — one shipment per order |
| `courier_code` | `text` | NULL | FK → `couriers(code)`; §4.15's `courier` |
| `status` | `shipment_status` | NOT NULL | §4.15's `shipment_status` |
| `courier_order_id` | `text` | NULL | §4.15's `courier_order_id` / `parcel_id` / `tracking_id` — **one field**, not three |
| `tracking_url` | `text` | NULL | Resolved from the courier's template |
| `cod_amount` | `numeric(12,2)` | NULL | What the courier was told to collect (§4.4, §8.16b) |
| `declared_weight_grams` | `integer` | NULL | §4.2 |
| `status_sequence` | `integer` | NOT NULL | From spec 12 |
| `last_error` / `last_error_at` / `last_error_courier` | — | NULL | §5.21.5 |
| `created_with_courier_at` | `timestamptz` | NULL | |
| `shipped_at` | `timestamptz` | NULL | Parcel handover |
| `cancelled_with_courier_at` | `timestamptz` | NULL | |

§4.15 warns against treating the store Order Number and the courier identifier as interchangeable. They are separate columns on separate tables (`orders.order_number`, `shipments.courier_order_id`), and no code path assigns one from the other.

### `courier_requests` — an audit of every provider call

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `shipment_id` | `uuid` | NULL | FK → `shipments(id)` |
| `courier_code` | `text` | NOT NULL | |
| `operation` | `text` | NOT NULL | `CREATE` \| `DETAILS` \| `TRACK` \| `CANCEL` |
| `request_digest` | `text` | NOT NULL | Hash of the outbound payload — **not** the payload, which contains customer PII |
| `http_status` | `integer` | NULL | |
| `succeeded` | `boolean` | NOT NULL | |
| `error_message` | `text` | NULL | Redacted, provider-supplied text |
| `duration_ms` | `integer` | NULL | |
| `created_at` | `timestamptz` | NOT NULL | `now()` |

§5.21.5 requires storing the courier API error, the failure timestamp, and the courier used. This table holds the full call history; `shipments.last_error*` holds the latest for fast display. Storing a digest rather than the body keeps customer PII out of a log-shaped table (`database` skill §4).

## Backend work

### The adapter contract (§4.9)

One interface, identical input and output shapes for every provider, in `services/courier/types.ts`:

```ts
export type CourierShipmentRequest = {
  orderReference: string;              // orders.order_number
  recipient: {
    name: string; phone: string;
    division: string; district: string;
    areaUnitType: 'UPAZILA' | 'THANA'; areaUnitName: string;
    wardUnitType: 'UNION' | 'WARD';    wardUnitName: string;
    detailedAddress: string; postalCode: string | null;
  };
  items: Array<{ name: string; quantity: number }>;
  orderAmount: number;                 // orders.total_amount — discounted (§4.2, §8.16b)
  codAmount: number;                   // total_amount for COD, 0 for a prepaid bKash order
  weightGrams: number;
  deliveryInstructions: string | null;
};

export type CourierShipmentResult = {
  courierOrderId: string;              // §4.5 / §4.15 — one identifier
  trackingUrl: string | null;
  rawProviderReference: string | null;
};

export type NormalizedTracking = {
  status: ShipmentStatus;              // the shared vocabulary (§4.9)
  events: Array<{ status: ShipmentStatus; occurredAt: string | null; description: string }>;
  estimatedDeliveryAt: string | null;
  deliveryAreaSummary: string | null;  // area only — never the full address (§4.16)
};

export interface CourierAdapter {
  readonly key: string;
  createShipment(req: CourierShipmentRequest): Promise<CourierShipmentResult>;
  getShipmentDetails(courierOrderId: string): Promise<NormalizedTracking>;
  trackShipment(courierOrderId: string): Promise<NormalizedTracking>;
  cancelShipment(courierOrderId: string): Promise<{ cancelled: boolean; reason?: string }>;
}
```

§4.9 requires that "provider-specific response fields and status values must be normalized into the shared status vocabulary… before being returned to the core system, so the rest of the system never needs to know which courier handled a given shipment." Consequently **no raw provider response ever leaves an adapter**. The core order-management code never sees a Pathao or Steadfast field name, and a new courier is added by writing one module against this interface.

### Status normalization

Each adapter owns a mapping table from its provider's status strings to the `shipment_status` enum, plus an explicit fallback: an unrecognized provider status maps to `null` and is **logged and ignored** rather than guessed, so a provider adding a new status cannot silently corrupt state. §4.9 says statuses must be normalized "not invented events."

The mapping tables themselves must be built from the **current official documentation at implementation time** — CLAUDE.md §6 and §7.3's identical rule forbid guessing an external API. This spec fixes the shape and the obligation, not the values.

### The courier service layer

`services/courier/courierService.ts` resolves a `courier_code` to its adapter through the registry and wraps every call with `safeFetch` (spec 04), a timeout, the `courier_requests` audit row, and error normalization. Controllers never import an adapter directly — §4.8's architecture is Admin Panel → backend → Courier Service → provider.

### Routes

All under `/api/admin`, `requireAuth('admin')` + `rateLimit('authenticatedCeiling')`.

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/couriers` | `courier.select` |
| `GET` | `/orders/:orderNumber/shipment` | `shipment.view` |
| `POST` | `/orders/:orderNumber/shipment` | `shipment.create` **and** `courier.select` |
| `POST` | `/orders/:orderNumber/shipment/retry` | `shipment.retry` |
| `POST` | `/orders/:orderNumber/shipment/change-courier` | `shipment.courier.change` **and** `courier.select` |
| `POST` | `/orders/:orderNumber/shipment/mark-shipped` | `shipment.create` |
| `GET` | `/courier-config` | `courier.manage` |
| `PATCH` | `/courier-config/:code` | `courier.manage` |

The split between `courier.select` and `courier.manage` is §5.16's explicit disambiguation: a default Manager can pick Pathao or Steadfast per order (`courier.select`, `Yes`) but cannot reconfigure provider settings (`courier.manage`, `Assigned`). Creation additionally requires `courier.select` because choosing the courier is part of the request.

### Create Shipment — the concurrency lock (§4.11)

Inside `withTransaction`:

1. `SELECT … FOR UPDATE` on the order and shipment rows.
2. **Guard by current shipment status** — §4.11's concurrent-creation guard:
   - `CREATING` → reject `409 SHIPMENT_CREATION_IN_PROGRESS`. "A second Create Shipment request for the same order… must be rejected rather than dispatched to the courier API concurrently."
   - `CREATED` or later → reject `409 SHIPMENT_ALREADY_EXISTS`; §4.11 says the UI "should simply reflect the existing state rather than resubmitting."
   - `NOT_CREATED` or `CREATION_FAILED` → proceed.
3. Verify the order is `CONFIRMED` or `PROCESSING`. A bKash order additionally requires `payment_status = 'PAID_VERIFIED'` (§4.3); a COD order does not (§4.4).
4. Validate the selected courier exists and is enabled.
5. `transitionShipmentStatus(→ CREATING)` (spec 12) — **the lock is the state itself**, held in a committed row so it survives across requests and processes.
6. Commit, then call the courier **outside** the transaction. Holding a database transaction open across a slow third-party call would block the row for the provider's entire latency.

Then, in a second transaction:

- **Success** → store `courier_order_id`, `tracking_url`, `cod_amount`, `created_with_courier_at`; `transitionShipmentStatus(CREATING → CREATED)`; if the order is still `CONFIRMED`, advance it to `PROCESSING` (§4.10, §5.21.4's assumption that the order is `PROCESSING` while the shipment progresses).
- **Failure** → store `last_error`, `last_error_at`, `last_error_courier`; `transitionShipmentStatus(CREATING → CREATION_FAILED)` (§5.21.5).

**A failure changes nothing else.** The order stays `CONFIRMED`/`PROCESSING`, the payment status is untouched, and the shipment is not `SHIPPED` (§3.5, §4.11, §5.6, §5.21.5). Spec 12's transition tables make this structural — there is no transition from a shipment failure to any payment or order status.

**No automatic retry.** §4.11: "If the courier API is temporarily unavailable, the system will not create a duplicate shipment automatically. The Admin or Manager can retry the operation after reviewing the error." The service performs no internal retry on a create call, because a timeout may mean the courier *did* create the parcel.

### Ambiguous-failure handling

If a create call times out or fails in a way that leaves it unknown whether the courier created the shipment, the shipment goes to `CREATION_FAILED` with the error recorded, and the retry path **first calls `getShipmentDetails` with the order reference** (where the provider supports lookup by merchant reference) to detect an already-created parcel before creating a second one. This is the implementation of §4.11's "will not create a duplicate shipment automatically." Where a provider offers no such lookup, the admin UI warns explicitly before a retry that a duplicate parcel is possible — the honest behaviour, since the platform cannot verify otherwise.

### Retry and change courier (§4.11, §5.21.5)

Both require the shipment to be `CREATION_FAILED`; anything else is rejected, per §4.11's "may only retry once the shipment has settled into `CREATION_FAILED`." Change-courier additionally sets a new `courier_code`. Both then run the same create flow, so there is one creation code path and no divergent second implementation.

### Mark as shipped (§5.21.9)

`CREATED → SHIPPED`, an explicit Admin/Manager action representing parcel handover. §4.11 and §5.6 both require that a shipment cannot become `SHIPPED` unless creation succeeded — spec 12's transition table makes `CREATION_FAILED → SHIPPED` nonexistent.

### `CourierCancellationPort` (§5.21.7)

```ts
cancelForOrder(orderId): Promise<{ cancelled: boolean; reason?: string }>
```

Registered with spec 12 at startup. When an order with a shipment at `CREATED` or later is cancelled, spec 12 calls this; a `cancelled: false` result blocks the cancellation with `409 COURIER_CANCELLATION_FAILED`, per §5.21.7's "must be blocked or escalated to Admin/Manager rather than silently leaving the shipment active." A courier whose registry row has `supports_cancel = false` returns `cancelled: false` with that reason rather than pretending success.

### Amounts sent to the courier (§4.2, §8.16b, §8.21)

`orderAmount` and `codAmount` are read from `orders.total_amount` — the server-computed, coupon-discounted final total. §8.21 is explicit that no new field is introduced and no adapter change is required by the coupon feature: the existing total field simply already carries the discounted value. `codAmount` is `total_amount` for a COD order and `0` for a prepaid bKash order, since the courier collects nothing on a verified prepaid parcel.

`weightGrams` sums `products.weight_grams × quantity`, falling back to a configured default per parcel when weights are unset.

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Shipment already `CREATING` | 409 | `SHIPMENT_CREATION_IN_PROGRESS` |
| Shipment already `CREATED` or later | 409 | `SHIPMENT_ALREADY_EXISTS` |
| Order not `CONFIRMED`/`PROCESSING` | 409 | `ORDER_NOT_READY_FOR_SHIPMENT` |
| bKash order not yet verified | 409 | `PAYMENT_NOT_VERIFIED` |
| Unknown or disabled courier | 400 | `COURIER_UNAVAILABLE` |
| Courier API failed | 502 | `COURIER_REQUEST_FAILED` + a safe message |
| Retry when not `CREATION_FAILED` | 409 | `INVALID_TRANSITION` |
| Missing `shipment.create` / `courier.select` / `courier.manage` | 403 | `FORBIDDEN` |

`COURIER_REQUEST_FAILED` carries a sanitized provider message for the Order Panel (§4.11 step 2 requires the error be displayed) — never credentials, never a raw response body, never a stack trace.

### Contract additions (decided — resolve the frontend gaps)

These additions complete the contract above; they add no business behaviour. Migration `0014` gains one column: `couriers.supports_reference_lookup boolean NOT NULL DEFAULT false` (true only for an adapter whose provider can look a parcel up by merchant reference; drives the ambiguous-failure retry path above).

```ts
type CourierOption = { code: string; name: string };                       // GET /couriers, ordered by display_order, enabled only

type ShipmentView = {                                                      // every shipment endpoint returns this
  status: ShipmentStatus;                                                  // NOT_CREATED when no row exists yet
  courierCode: string | null;
  courierName: string | null;                                              // joined server-side — no courier.select needed to read it
  courierOrderId: string | null;
  trackingUrl: string | null;
  codAmount: number | null;
  declaredWeightGrams: number | null;
  createdWithCourierAt: string | null; shippedAt: string | null; cancelledWithCourierAt: string | null;
  lastError: string | null; lastErrorAt: string | null; lastErrorCourier: string | null;
  retryMayDuplicate: boolean;                                              // true when the failed courier has supports_reference_lookup = false
  allowedActions: Array<'CREATE_SHIPMENT'|'RETRY_SHIPMENT'|'CHANGE_COURIER'|'MARK_SHIPPED'>;  // derived: shipment state + order readiness (§4.3/§4.4) + the actor's permissions
};

type CreateShipmentRequest = { courierCode: string };                      // POST /shipment and /shipment/change-courier; .strict()
// retry and mark-shipped take no body.

type CourierConfigView = {                                                 // GET /courier-config rows
  code: string; name: string; isEnabled: boolean; displayOrder: number;
  trackingUrlTemplate: string | null; supportsCancel: boolean; supportsTracking: boolean;
  credentialsConfigured: boolean;                                          // env presence check only — never a value
  config: Record<string, string | number>;
  configSchema: Array<{ key: string; label: string; type: 'string' | 'number' }>;   // declared by the adapter
};
type UpdateCourierConfigRequest = {                                        // PATCH /courier-config/:code; .strict(), at least one field
  isEnabled?: boolean; displayOrder?: number; trackingUrlTemplate?: string | null;
  config?: Record<string, string | number>;                                // keys must be in the adapter's configSchema; unknown keys → 400
};
```

- `allowedActions` is computed in one place from the same guards `createShipment` enforces, so the UI never re-derives readiness. It is advisory; every route still enforces its own guards.
- `trackingUrlTemplate` is validated server-side: `https://` and exactly one `{trackingId}` placeholder.
- **Call history**: `GET /api/admin/orders/:orderNumber/shipment/requests` (`shipment.view`, paginated) returns `{ operation, succeeded, httpStatus, durationMs, errorMessage (redacted), createdAt }` per `courier_requests` row — never the digest, never PII.
- Secrets can never be written through `config`: the schema is an allowlist per adapter and the adapters declare only non-secret keys.

## Frontend work

The shipment section of `/admin/orders/[orderNumber]` (spec 13's slot), following the `design` skill's Shipment Creation modal.

- **Before creation**: courier radio list from `GET /couriers` (48px rows, data-driven — never hardcoded names, per §4.9), read-only order info, read-only delivery address, the COD amount pre-filled from the order total for COD orders, and a full-width 48px `Create Shipment` button.
- **During creation**: the button enters a loading state and the section reflects `CREATING`; the control is disabled so a second click cannot fire — and the backend's `CREATING` guard is the real protection (`frontend` §2).
- **On success**: courier name, Parcel/Tracking ID in monospace, a `Created` badge, and a Track link when the courier exposes one.
- **On failure**: the recorded error message, with `Retry` and `Change Courier` actions. A retry against a provider with no reference lookup shows the duplicate-parcel warning described above.
- **After handover**: a `Mark as Shipped` action, available only from `CREATED`.
- **Courier configuration** (`/admin/settings/couriers`) — enable/disable, display order, tracking URL template, and non-secret settings. **Credential fields are not rendered at all**, because credentials live in environment variables (§4.8, §5.5, §11.9); the page shows a configured/not-configured indicator derived from the backend, never a value.
- Actions render only with the matching permission and still handle a backend 403 (`frontend` §3).

### Frontend build detail

The bullets above stay as the behavioural summary. This section pins how they are built. Everything here consumes only the endpoints and columns defined in **Backend work** and **Database changes** above; anything the frontend needs that those sections do not define is listed under **Backend gaps** at the end, not assumed.

#### Pages and access

| Surface | Route | Who | Backend 403 |
| --- | --- | --- | --- |
| Shipment section | slot inside `/admin/orders/[orderNumber]` (spec 13's page; today `app/admin/(shell)/orders/[id]/page.tsx`) | Admin session. Section visible with `shipment.view`. **Create** needs `shipment.create` **and** `courier.select`; **Retry** needs `shipment.retry`; **Change courier** needs `shipment.courier.change` **and** `courier.select`; **Mark as shipped** needs `shipment.create` | Inline `role="alert"` inside the section: "You do not have permission to do this." The rest of the order page stays usable. The action's button is disabled until the page is reloaded. A 403 on the initial `GET …/shipment` replaces the section body with the same message instead of an empty card. |
| Courier settings | `/admin/settings/couriers` (new, `app/admin/(shell)/settings/couriers/page.tsx`) | `courier.manage` only | Full-page "You do not have access to courier settings." state (no redirect loop). The nav entry is added to `ADMIN_NAV_ITEMS` in `lib/admin/nav.ts` with `requires: 'courier.manage'`, so it is hidden for a default Manager (UX only, §5.16). |

A 401 on either surface is handled by the existing admin shell (`app/admin/(shell)/layout.tsx` redirects to `/admin/login`). Neither surface is indexable — the admin layout already renders no SEO metadata and `app/robots.ts` disallows `/admin`.

#### Components

All under `frontend/src/components/admin/orders/shipment/` unless stated. Every component is a client component calling the shared `lib/apiClient.ts` (`apiGet`/`apiPost`/`apiPatch`; failures arrive as `ApiClientError` with `.code`, `.status`, `.message`).

| Component | Props | Reuses | Notes |
| --- | --- | --- | --- |
| `ShipmentSection.tsx` | `orderNumber: string`, `order: { paymentMethod; deliveryAddress; amounts; items }` (the object spec 13's page already loaded — **no second order fetch**), `onOrderChanged(): void` | `useAdminSession().hasPermission` (`lib/admin/session.tsx`), `Button` (`components/admin/Button.tsx`), `ShipmentStatusBadge` (`components/admin/orders/OrderStatusBadges.tsx`) | Replaces the read-only "Shipment" `<section>` that spec 13's page already renders (it shows status, courier, `courierOrderId`, `lastError` only). Owns the shipment fetch and the state machine of the section. Calls `onOrderChanged()` after any successful action so spec 13's page refetches the order (creation can advance the order to `PROCESSING` server-side; the frontend never sets it). |
| `CourierPicker.tsx` | `value: string \| null`, `onChange(code)`, `disabled: boolean` | — | Radio list, one 48px row per courier returned by `GET /api/admin/couriers`. Row label is the API's `name`; **no courier name appears in the component source** (§4.9, acceptance 22). Radios 20×20 with a 28×28 tap area inside the 48px row. |
| `ShipmentCreatePanel.tsx` | `orderNumber`, `order`, `mode: 'create' \| 'change'`, `onDone()` | `CourierPicker`, `Button` | Read-only order info and delivery address blocks (from the `order` prop), COD amount line, full-width 48px submit. Used for first creation and for change-courier so there is one form. |
| `ShipmentStatusCard.tsx` | `shipment: ShipmentView` | `ShipmentStatusBadge` (`components/admin/orders/OrderStatusBadges.tsx`; labels via `statusLabel` in `lib/admin/orders.ts`), `formatMoney`, `formatDate` (`lib/account.ts`) | Courier, Parcel / Tracking ID, status badge, Track link, COD amount, timestamps. |
| `ShipmentFailureNotice.tsx` | `shipment`, `canRetry`, `canChangeCourier`, `onRetry()`, `onChangeCourier()` | `Button` | Shows `lastError`, `lastErrorAt`, `lastErrorCourier`; the two recovery actions; the retry confirmation. |
| `components/admin/settings/CourierConfigRow.tsx` | `courier: CourierConfigView`, `onSaved(updated)` | `FormField`, `ToggleField`, `Button` (`components/admin/*`) | One editable card per courier on the settings page. |

`ShipmentView` and `CourierConfigView` are hand-maintained mirrors in `lib/admin/types.ts`, like the existing admin types. They mirror the **table columns** of `shipments` and `couriers` (camel-cased as the rest of the API is) — the response projection itself is not specified; see gap 1.

#### Data: endpoint → fields shown

| Component | Endpoint | Fields rendered |
| --- | --- | --- |
| `ShipmentSection` (load / refresh) | `GET /api/admin/orders/:orderNumber/shipment` | `status` (`ShipmentStatusBadge`), `courierCode`, `courierOrderId` (monospace, labelled "Parcel / Tracking ID" — never "Order ID", §4.15), `trackingUrl`, `codAmount`, `declaredWeightGrams`, `createdWithCourierAt`, `shippedAt`, `cancelledWithCourierAt`, `lastError`, `lastErrorAt`, `lastErrorCourier` |
| `CourierPicker` | `GET /api/admin/couriers` | `code` (submitted value), `name` (label). Order is the server's order — the frontend does not re-sort. |
| `ShipmentCreatePanel` (create) | `POST /api/admin/orders/:orderNumber/shipment` | request carries the chosen courier code only; response → `ShipmentView` |
| `ShipmentFailureNotice` (retry) | `POST …/shipment/retry` | no body; response → `ShipmentView` |
| `ShipmentCreatePanel` (change) | `POST …/shipment/change-courier` | chosen courier code |
| `ShipmentStatusCard` (handover) | `POST …/shipment/mark-shipped` | no body |
| `CourierConfigRow` (list) | `GET /api/admin/courier-config` | `code`, `name`, `isEnabled`, `displayOrder`, `trackingUrlTemplate`, `supportsCancel` and `supportsTracking` (read-only, informational), `config` (non-secret key/values) |
| `CourierConfigRow` (save) | `PATCH /api/admin/courier-config/:code` | `isEnabled`, `displayOrder`, `trackingUrlTemplate`, `config` |

The read-only order info and the COD line come from the order object spec 13 already fetched (`deliveryAddress`, `items`, `amounts.totalAmount`, `paymentMethod`). The COD line is shown **only when `paymentMethod === 'COD'`**, labelled "COD amount to collect", and is display-only — it is never submitted. After creation the card shows the stored `codAmount` from the shipment, which is the figure the courier was actually told.

#### States

| State | Behaviour |
| --- | --- |
| Loading | "Loading shipment…" with `aria-busy` on the section; fixed min-height so the page does not jump. |
| `NOT_CREATED` / no shipment | Create panel. `Create Shipment` is disabled until a courier is chosen. If `GET /couriers` returns an empty list: "No couriers are enabled. Ask an administrator to enable one in Courier Settings." (link only if `courier.manage`). |
| Empty courier list error | `COURIER_UNAVAILABLE` (400) → refetch `GET /couriers`, clear the selection, show "That courier is no longer available. Choose another." |
| `CREATING` | Badge "Creating", button replaced by a non-interactive "Creating shipment…" row and a **Refresh** button. While in this state the section re-fetches `GET …/shipment` every 5 s and stops after 2 minutes (the Refresh button remains). This also covers a second admin tab or a page reload during a slow provider call; the backend `CREATING` lock is the real protection. |
| `CREATED` | Courier, Parcel / Tracking ID, `Created` badge, Track link (only when `trackingUrl` is non-null **and** starts with `https://`; opened with `target="_blank" rel="noopener noreferrer"`). `Mark as Shipped` shown to `shipment.create` holders. |
| `SHIPPED` and later | Read-only card. No create/retry/change actions render. Later states (`IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `DELIVERY_FAILED`, `RETURNED`) arrive via spec 15's sync and are displayed with the same label map. |
| `CREATION_FAILED` | `ShipmentFailureNotice` with the recorded error, **Retry** and **Change Courier**. Order and payment badges above are untouched — the notice states "The order is still {order status label}; no payment or order change was made." using the order's own label, not a computed one. |
| Retry confirmation | Retry opens a confirm step (not a native `confirm()` — an in-page `role="dialog"` with focus trap): "If the courier may already have created this parcel, check the courier portal before retrying — a duplicate parcel is possible." Cancel / Retry Shipment. Shown only when `ShipmentView.retryMayDuplicate` is true. |
| Success | After create/retry/change/mark-shipped: the section re-renders from the response, `onOrderChanged()` fires, and a polite live region announces "Shipment created." / "Marked as shipped." |
| Action error | Backend `message` shown inline in `role="alert"` (never the raw body). Code handling: `SHIPMENT_CREATION_IN_PROGRESS` → switch to the `CREATING` state and refetch; `SHIPMENT_ALREADY_EXISTS` → refetch and reflect the existing state without resubmitting (§4.11); `ORDER_NOT_READY_FOR_SHIPMENT` and `PAYMENT_NOT_VERIFIED` → show the backend message, state unchanged; `COURIER_REQUEST_FAILED` → refetch (the shipment is now `CREATION_FAILED`) and show the sanitized message; `INVALID_TRANSITION` → refetch and reflect; `FORBIDDEN` → the 403 behaviour above; 429 → message plus the button disabled for `retryAfter` seconds; network error → "Could not reach the server" with the button re-enabled. |
| Disabled | Every action button is disabled while any shipment request is in flight (single `inFlight` flag in `ShipmentSection`, not per button), so Create/Retry/Change/Mark cannot overlap. |
| Double-click | The handler returns immediately if `inFlight` is set; the button is also `disabled`+`aria-busy`. A second POST that does slip through is answered `409 SHIPMENT_CREATION_IN_PROGRESS` and handled as above. No client idempotency key exists for this endpoint (none is defined). |

The cancel-order dialog belongs to spec 13, but it must render a `409 COURIER_CANCELLATION_FAILED` message verbatim and leave the order view unchanged (§5.21.7); spec 13's dialog is where that is built, this spec only fixes the contract.

#### Forms

**Courier selection (create / change)** — one field: courier (radio, required). UX validation: the Create/Submit button stays disabled until a courier is selected; for change-courier the current `courierCode` is preselected-disabled so the user must pick a different one (UX convenience only — the backend accepts or rejects). Errors: a form-level `role="alert"` above the button; no per-field errors exist.

**Courier settings (`CourierConfigRow`)** — fields: Enabled (toggle), Display order (integer ≥ 0, `inputMode="numeric"`), Tracking URL template (text; UX check: empty, or begins with `https://` and contains `{trackingId}`), Non-secret settings (see below). One **Save** button per card, enabled only when the card is dirty. Backend validation errors map to fields through `ApiClientError.fieldError(field)` and are shown below the matching input in `#DC2626` 12px. Disabling a courier shows a plain note: "Orders already using this courier are not affected; it will no longer be offered for new shipments." (copy only — behaviour is the backend's).

**Non-secret settings** are rendered as key/value rows of text inputs (never a raw JSON box), with the standing hint "Do not enter API keys, secrets or passwords here. Credentials are configured on the server." There are **no credential fields anywhere** on this page: no key, secret, token, client-id or password input, no masked placeholder, and no "configured" value echoed back (§4.8, §5.5, §11.9). The configured / not-configured indicator is shown only if the backend supplies it (gap 4).

#### Responsive behaviour and accessibility

- Mobile first at 375px, verified at 320px: the section is a single column card; courier rows, the submit button and the three recovery/handover buttons are full width, **48px** tall, 8px apart. At `md` (768px) the action buttons sit in a row and auto-width. Nothing scrolls horizontally; the Parcel / Tracking ID wraps with `break-all`.
- The settings page is a stack of cards at 375px and a two-column grid from `lg`; every toggle and input is ≥ 44px (48px for buttons).
- Status is always text plus colour (`StatusBadge` label), never colour alone. The `CREATING` row uses a static label — no spinner animation beyond the `Button` loading text, honouring `prefers-reduced-motion`.
- Order, payment and shipment status stay **three separate badges** (`frontend` §2, §5.21.11); the shipment section only ever renders the shipment one.
- Live regions: action results and errors are `role="status"` / `role="alert"`; focus moves to the section heading after a successful creation and to the alert on failure. The retry dialog traps focus, closes on Escape, and returns focus to the Retry button.
- All fields have visible labels; radios are a `fieldset` with a `legend` ("Courier"); the Track link has text that names its destination ("Track on {courier name}" when a name is available, otherwise "Track parcel").

#### Analytics

None. Back-office pages fire no Meta events; spec 18's root `<PixelInit />` must not run under `/admin` (see spec 18's frontend detail).

#### What the frontend must NOT do on these surfaces

- Render, request, store or log any courier credential, and never send a credential to the backend; never read a `NEXT_PUBLIC_*` courier variable.
- Contact a courier or Pathao/Steadfast host from the browser; the browser talks only to the Express API (§4.8).
- Hardcode courier names, codes or logos — including the `COURIER_LABELS` map in `lib/account.ts`, which is for the storefront fallback only; the admin UI uses the API's `name` (§4.9).
- Decide whether a shipment may be created, retried or shipped. It shows buttons from `ShipmentView.allowedActions` (and `hasPermission`) and displays the backend's refusal; it does not re-implement the CONFIRMED/PROCESSING or `PAID_VERIFIED` gates.
- Compute or submit the COD amount, order amount or weight; compute or set any order, payment or shipment status; infer one status from another.
- Build the tracking URL from the template in the browser — it displays the backend's `trackingUrl` only.
- Show raw provider responses or stack traces; show `courier_requests` (not exposed and PII-adjacent).
- Treat the retry as safe to repeat automatically; there is no automatic or background retry from the UI.
- Couple shipment creation to the risk-check result (spec 16 is advisory).

#### Existing code to reconcile

- `app/admin/(shell)/orders/[id]/page.tsx` (spec 13's in-progress page) already has a read-only shipment `<section>` (status, `courier`, `courierOrderId`, `lastError`) that `ShipmentSection` replaces; it still reads snake_case order fields and the route parameter is `[id]` where specs 13/14 use `[orderNumber]`. Spec 13 owns that page; the components above are written against `orderNumber`.
- `lib/account.ts` `courierLabel()` hardcodes `PATHAO`/`STEADFAST`. Keep it as a storefront fallback only; admin code must not call it.
- `lib/admin/nav.ts` has no Settings entries yet.

#### Backend gaps (all resolved — see Contract additions and Gap resolutions)

1. **Response projections are unspecified** for `GET /couriers`, `GET /orders/:orderNumber/shipment`, `POST` create/retry/change/mark-shipped, and `GET /courier-config`. This spec assumes the table columns above (camel-cased). The shapes should be pinned (and a `ShipmentView` type published) before building.
2. **Request bodies are unspecified** for create and change-courier (assumed: the courier `code`) and for `PATCH /courier-config/:code` (assumed: `isEnabled`, `displayOrder`, `trackingUrlTemplate`, `config`).
3. **The shipment payload carries `courier_code`, not the courier's display name.** `GET /couriers` (needed to resolve it) requires `courier.select`, which a `shipment.view`-only user may lack. Either include `courierName` in the shipment payload or the card falls back to showing the raw code.
4. **No configured / not-configured field** exists for provider credentials, although the page is required to show that indicator "derived from the backend." The page omits the indicator until a boolean (never a value) is provided.
5. **No "supports reference lookup" signal** exists per courier, so the frontend cannot tell when the duplicate-parcel warning is required (§4.11). Interim behaviour: show the warning on every retry. A `couriers` flag would let it be shown only when it applies.
6. **`allowedActions` (spec 13's order detail) does not list shipment actions**, and no field says whether the order is ready for shipment. The UI therefore shows Create from shipment status + permission and relies on `ORDER_NOT_READY_FOR_SHIPMENT` / `PAYMENT_NOT_VERIFIED` responses.
7. **`couriers.config` is a free-form `jsonb`** with no defined key set or validation, so the settings editor cannot offer typed fields and cannot prevent an administrator pasting a secret into it beyond the on-page warning.
8. **No read endpoint for shipment/courier-call history** (`courier_requests`), so the panel shows only the latest error.

#### Spec-vs-design / spec-vs-spec conflicts (decisions in Gap resolutions)

- The `design` skill's Shipment Creation modal lists "Pathao / Steadfast / Other Courier" as fixed radios; §4.9 requires a data-driven list. **The PRD wins**: the list comes from `GET /couriers`.
- The `design` skill shows the shipment as a modal and as an order-page section; this spec builds it as the order-page section with an in-page dialog only for the retry confirmation, matching the existing bullets.
- Spec 13's `/admin/orders/[orderNumber]` versus the implemented `[id]` route (see above).

#### Gap resolutions and frontend consequences

| Gap | Decision |
| --- | --- |
| 1, 2 | Resolved by `CourierOption`, `ShipmentView`, `CreateShipmentRequest`, `CourierConfigView`, `UpdateCourierConfigRequest` above. The frontend types in `lib/admin/types.ts` mirror them exactly; the "assumed from table columns" wording no longer applies. |
| 3 | `ShipmentView.courierName` is joined server-side; the card shows it and never needs `GET /couriers`. |
| 4 | `CourierConfigView.credentialsConfigured` drives a "Credentials: Configured / Not configured" text indicator (never a value) on each settings card. |
| 5 | The retry confirmation dialog is shown **only** when `retryMayDuplicate` is true; otherwise Retry runs directly after a plain confirm-free click. This replaces the interim "warn on every retry". |
| 6 | Buttons render from `ShipmentView.allowedActions` (intersected with `hasPermission` for UX). The "from shipment status + permission" fallback is removed; `ORDER_NOT_READY_FOR_SHIPMENT`/`PAYMENT_NOT_VERIFIED` remain handled for races. |
| 7 | The settings editor renders one typed input per `configSchema` entry (text or number) instead of free key/value rows; no entry exists for a secret. |
| 8 | A collapsible "Courier call history" list (last 10, `Load more`) under the shipment card, visible with `shipment.view`. |

**Conflicts decided.** (a) Admin route folder is `[orderNumber]` — the order page folder `app/admin/(shell)/orders/[id]` is renamed and `useParams().orderNumber` is passed to every child; the API and URLs already use the order number. (b) Courier list is data-driven; the `design` skill's fixed radios are superseded by §4.9. (c) The shipment section replaces the read-only slot in the spec 13 page; no modal is introduced.

## Security requirements

- **Courier credentials never reach the frontend** (§4.8, §5.5) — they are env-only, resolved inside adapters, never returned by any endpoint, never stored in a queryable table, and redacted from logs.
- **All courier calls originate in the backend** (§4.8) — no frontend code contacts a provider.
- **Outbound calls go through `safeFetch`** — HTTPS only, host allowlist built from the configured provider base URLs, private/loopback targets rejected, bounded timeout and response size (`security` §6).
- **No raw provider response crosses the adapter boundary** (§4.9), which is what keeps §4.16's "never a raw courier API response" achievable on the public tracking endpoint in spec 15.
- **`courier.manage` and `courier.select` are checked independently** (§5.16) — a Manager with default permissions can ship but cannot reconfigure a provider.
- **Failures never cascade** (§3.5, §4.11, §5.6, §5.21.5) — a courier error cannot reject a verified payment, cancel a confirmed order, or mark a shipment shipped. Spec 12's tables make this structural rather than conventional.
- **No PII in the call-audit table** — only a request digest (`database` skill §4).
- **Every shipment action is audited** with actor, courier, and outcome (§5.15 rule 10).
- **All input validated** with `.strict()` schemas (§11.6); the courier code must exist in the registry.

## Data integrity / idempotency

- **`CREATING` is a committed-state lock** (§4.11) — because it is a database row value rather than an in-process mutex, it holds across concurrent requests, multiple backend instances, and page reloads during a slow provider call. This is the primary duplicate-parcel defence.
- **The provider call happens outside the transaction**, so a slow courier does not hold a row lock, while the lock state itself remains committed and visible.
- **No automatic retry on create** (§4.11) — a timeout is never assumed to be a failure, because it may be a success the platform cannot see.
- **Reference lookup before retry** detects an already-created parcel where the provider supports it, so the common retry path cannot duplicate.
- **One shipment per order** — `UNIQUE (shipments.order_id)`.
- **One identifier field** (§4.15) — `courier_order_id` is never derived from, or confused with, `orders.order_number`.
- **Retry and change-courier reuse the one creation path**, so guards cannot diverge between them.
- **`SHIPPED` is unreachable from `CREATION_FAILED`** (§4.11, §5.6) — enforced by the absent transition, not by a check.
- **Every provider call is recorded** in `courier_requests`, so an ambiguous outcome is reconstructable.

## Acceptance criteria

1. `GET /api/admin/couriers` returns Pathao and Steadfast from the registry; inserting a third enabled row makes it selectable with **no code change and no migration**.
2. `POST /orders/:n/shipment` for a `CONFIRMED` COD order transitions the shipment `NOT_CREATED → CREATING → CREATED` and stores `courier_order_id` and `cod_amount = orders.total_amount`.
3. For a bKash order with `payment_status = 'PENDING_VERIFICATION'`, creation returns `409 PAYMENT_NOT_VERIFIED`; after verification and confirmation it succeeds and sends `codAmount: 0` (§4.3).
4. With a coupon applied, the `orderAmount` and `codAmount` sent to the adapter equal the **discounted** `total_amount`, not the pre-discount subtotal (§4.2, §8.16b).
5. A second create request while the shipment is `CREATING` returns `409 SHIPMENT_CREATION_IN_PROGRESS`, and the adapter is called exactly **once** (§4.11's concurrent-creation guard).
6. Two truly concurrent create requests result in exactly one adapter call and one shipment.
7. A create request for a shipment already `CREATED` returns `409 SHIPMENT_ALREADY_EXISTS` and calls no adapter.
8. When the adapter throws, the shipment becomes `CREATION_FAILED`, the error/timestamp/courier are stored, and `order_status` and `payment_status` are **unchanged** (§5.21.5, §5.6).
9. No automatic retry occurs after a failure — exactly one adapter call is recorded (§4.11).
10. `POST /shipment/retry` from `CREATION_FAILED` succeeds; from `CREATED` it returns `409 INVALID_TRANSITION` (§4.11).
11. `POST /shipment/change-courier` from `CREATION_FAILED` with a different courier creates through that courier and records the new `courier_code`.
12. `POST /shipment/mark-shipped` works from `CREATED` and is rejected from `CREATION_FAILED` (§4.11, §5.6).
13. Successful creation advances a `CONFIRMED` order to `PROCESSING`, and the order stays `PROCESSING` through later shipment states (§5.21.4).
14. Cancelling an order whose shipment is `CREATED` calls the courier's cancel; on success the order cancels, on failure it returns `409 COURIER_CANCELLATION_FAILED` and the order is unchanged (§5.21.7).
15. A courier with `supports_cancel = false` blocks such a cancellation with a clear reason.
16. `grep -ri "PATHAO_CLIENT_SECRET\|STEADFAST_API_KEY" frontend/` returns nothing; no API response contains a credential.
17. The adapter's normalized output contains only `shipment_status` enum values; a raw provider status string never appears in any response or stored status column.
18. An unrecognized provider status is logged and ignored rather than mapped to a guess.
19. `courier_requests` records every call with operation, outcome, and duration, and contains no customer name, phone, or address.
20. A Manager with default permissions can create a shipment and select a courier, but `PATCH /courier-config/:code` returns 403 until `courier.manage` is granted (§5.16).
21. `orders.order_number` and `shipments.courier_order_id` are never equal by construction, and no code path assigns one from the other (§4.15).
22. The courier selection list in the admin UI is rendered from the API, with no hardcoded courier name in the component (§4.9).
23. At 375px the shipment section renders with 48px courier rows and a full-width 48px action button.

## Tests required

Per the `test` skill §1, which names shipment creation failure and the no-cascade rule as required coverage. The adapters themselves are tested against recorded fixtures of the **real** provider responses, never invented ones.

1. **Concurrent creation guard** (§4.11) — two simultaneous create requests produce exactly one adapter call and one shipment; the second is rejected. The named PRD rule and the highest-value test here.
2. **Create from `CREATED` is rejected** — no adapter call.
3. **Shipment creation failure does not cascade** (§3.5, §4.11, §5.6, §5.21.5) — assert the verified payment is not rejected, the confirmed order is not cancelled, and the shipment is not `SHIPPED`. The `test` skill asks for this as an explicit regression test.
4. **No automatic retry** (§4.11) — exactly one adapter call after a simulated timeout.
5. **Retry only from `CREATION_FAILED`** — allowed there, rejected from every other state.
6. **Change courier** — records the new courier and reuses the single creation path.
7. **`SHIPPED` unreachable after a failed creation** (§4.11, §5.6).
8. **bKash gating** (§4.3) — creation blocked until `PAID_VERIFIED` and `CONFIRMED`; COD creation needs no verification (§4.4).
9. **Discounted amounts reach the courier** (§4.2, §8.16b, §8.21) — a coupon order's `orderAmount`/`codAmount` equal `total_amount`; COD carries the total, prepaid carries 0.
10. **Adapter contract parity** (§4.9) — the same `CourierShipmentRequest` produces a conforming `CourierShipmentResult` from both adapters, and a shared contract test runs against every registered adapter so a third courier inherits the suite.
11. **Status normalization** (§4.9) — each provider's documented statuses map to the correct enum value; an unknown status is ignored, not guessed.
12. **No raw provider data escapes** — the service's return value contains no provider-specific key.
13. **Registry is data-driven** (§4.9) — inserting a courier row makes it selectable with no code change; disabling one removes it from selection.
14. **Cancellation port** (§5.21.7) — cancellation blocked when the courier refuses, allowed when it succeeds, blocked for a non-cancelling courier.
15. **Permission separation** (§5.16) — `courier.select` alone permits per-order selection; `courier.manage` is required for configuration; `shipment.create`, `shipment.retry`, and `shipment.courier.change` are each checked on their own route.
16. **Credentials never surface** — no response or log line contains a secret; the SSRF guard rejects a non-allowlisted host.
17. **Audit rows** — every shipment action and provider call recorded, with no PII in `courier_requests` (§5.15 rule 10).
18. **Address mapping** (§4.2) — the recipient payload carries both discriminators, and the adapter maps them to the provider's own fields without losing which convention applied.

## Open questions / assumptions

1. **Provider API specifics.** CLAUDE.md §6 and §7.3 both forbid guessing an external API, and the PRDs deliberately give no Pathao or Steadfast payload shapes. *Assumption:* the implementing session fetches the current official documentation for both providers and writes the adapters against it, including authentication (Pathao's OAuth client-credentials flow and Steadfast's API-key headers, as their current docs describe), the city/zone/area lookup Pathao requires, and each provider's status vocabulary. **This spec deliberately does not specify those payloads** — doing so would be the guessing the rules prohibit.
2. **Pathao's zone/area identifiers.** Pathao's API historically requires numeric city/zone/area ids rather than free-text names, while the platform stores Division/District/Upazila-Thana/Union-Ward as text (§2.2). *Assumption:* the Pathao adapter performs a lookup-and-cache against Pathao's own location endpoints to resolve ids, and fails the creation with a clear, actionable error when an address cannot be resolved — rather than silently sending a wrong zone. **Flagged:** this is the most likely practical friction point, and it is exactly the mapping assigned to the adapter layer (§4.2, §4.9).
3. **Parcel weight.** §4.2 lists parcel weight; spec 05 captures `weight_grams` per product, but no PRD says what to send when it is unset. *Assumption:* sum the line weights, falling back to `DEFAULT_PARCEL_WEIGHT_GRAMS` from configuration. **Flagged:** couriers price by weight, so a wrong default has a real cost.
4. **COD amount for a prepaid bKash order.** §4.4 describes COD amounts for COD orders; §4.2 lists "COD amount for COD orders." *Assumption:* `0` for a verified bKash order, since the parcel is prepaid. Sending the full amount would cause the courier to collect twice.
5. **One shipment per order.** No PRD mentions split shipments or partial fulfilment. *Assumption:* one shipment per order, enforced by a unique constraint. Adding split shipments later would change the cascade rules in §5.21.4/§5.21.6, so it is deliberately not anticipated.
6. **Ambiguous create outcomes.** §4.11 forbids automatic duplicate creation but does not say how to resolve a timeout whose result is unknown. *Assumption:* reference lookup before retry where the provider supports it, and an explicit warning where it does not. **Flagged:** with a provider offering no merchant-reference lookup, a duplicate parcel after a timeout is possible and can only be resolved manually.
7. **Tracking URL templates.** §2.9.6 and §4.14.3 both mention a courier tracking link "when the selected courier exposes one." *Assumption:* stored per courier in the registry as a template, so adding a courier needs no code change.
