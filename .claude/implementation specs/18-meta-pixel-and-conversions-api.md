# 18 — Meta Pixel and Conversions API (CAPI)

## Goal

After this slice the seven tracked events flow to Meta through both channels — the Pixel in the Next.js frontend and the Conversions API from the Express backend — sharing one `event_id` per logical occurrence so Meta deduplicates them. `Purchase` fires exactly once per order, on the transition into `CONFIRMED` and nowhere else, carrying the coupon-discounted final total. Customer identifiers are hashed before they leave the platform, payment proof and secrets never leave at all, and a Meta outage can never block, delay, or roll back a customer action.

## Requirement references

- `08-analytics-meta.md` §6.1 — both Meta Pixel (client-side, Next.js) and Conversions API (server-side, Express); both channels send the same event set so data is not lost to browser tracking prevention, while the backend copy carries authoritative order data.
- `08-analytics-meta.md` §6.2 — the tracked events: `PageView`, `ViewContent`, `Search`, `AddToCart`, `InitiateCheckout`, `AddPaymentInfo`, `Purchase`.
- `08-analytics-meta.md` §6.3 — **`Purchase` must not fire at order submission**; it fires when the order transitions to `CONFIRMED` (after bKash verification, or after COD confirmation); **the order-status transition handler that moves an order to `CONFIRMED` is the single place responsible for triggering it**, on both channels; exactly once, only on the write that actually sets `orderStatus` to `CONFIRMED` — never on a "payment verified" state that has not also set the order status; **no reversal or refund event** is sent if the order is later cancelled or returned.
- `08-analytics-meta.md` §6.4 — every event sent to both channels must carry the **same `event_id`**, generated once per logical event occurrence and shared between the Pixel call and the corresponding CAPI call; without it, events are double-counted.
- `08-analytics-meta.md` §6.5 — the data to include per event: product ID/SKU, name, category, variant, quantity, value (reflecting any coupon discount), **currency always `BDT`**, and Meta's content schema fields; customer-identifying fields limited to **hashed** values Meta expects, never plain text, applied identically to guest orders.
- `08-analytics-meta.md` §6.6 — never send passwords or hashes, OTPs, authentication/session tokens, bKash Transaction IDs, or payment screenshots/proof.
- `08-analytics-meta.md` §6.7 — Pixel ID and CAPI access token in environment variables, never hard-coded; the Pixel ID may be exposed to the frontend, but **the CAPI access token must never be** — CAPI calls are made only from the Express backend.
- `08-analytics-meta.md` §6.8 — a failure to send must **never block, delay, fail, or roll back** the underlying customer action; failed sends are logged for visibility but must not be retried in a way that risks duplicate order side-effects.
- `08-analytics-meta.md` §6.9 — extend an existing analytics utility rather than creating a parallel system; frontend and backend share a single source of truth for event names, parameter shapes, and `event_id` generation.
- `10-coupon-discount.md` §8.31 — `InitiateCheckout`/`AddPaymentInfo` reflect the current server-computed total including any discount; `Purchase` uses the final discounted total; **no new event type is introduced for coupon application**.
- `13-homepage-cms.md` §13.16 — homepage load fires `PageView`; clicking into a product fires `ViewContent` on the product page; the homepage fires **no second, competing content-view event**; no new taxonomy.
- `07-order-state-machine.md` §5.21.9 — the `CONFIRMED` transition and its actors.
- `11-security-hardening.md` §11.5 (CSP), §11.6 (validation), §11.9 (secrets).
- Skills: `backend` §8, `security` §7, `frontend` §2, `test` §5.

## Depends on

- **01** — API conventions, env loading, logger.
- **04** — `safeFetch`, the CSP (which must allow `connect.facebook.net`), limiters.
- **07** — product pages and search (`ViewContent`, `Search`).
- **09** — cart (`AddToCart`).
- **11** — checkout (`InitiateCheckout`, `AddPaymentInfo`) and order totals.
- **12** — the `order.confirmed` domain event emitted post-commit on the `CONFIRMED` write.

## Scope

**In scope**

- A shared event contract module (names, parameter shapes, `event_id` generation) imported by both frontend and backend — §6.9's single source of truth.
- Frontend Pixel initialization and event firing.
- Backend CAPI client and the seven event senders.
- `event_id` allocation and propagation, including across the server-driven `Purchase`.
- SHA-256 hashing of customer identifiers per Meta's normalization rules.
- The `Purchase` subscriber on spec 12's `order.confirmed` event.
- A failure-isolated send path with logging and no unsafe retry.
- `meta_event_log` for observability and duplicate detection.

**Out of scope / deferred**

- Reversal/refund events — §6.3 explicitly scopes them out of v1.
- Any new event type, including a coupon-application event — §8.31 and §13.16 both forbid one.
- Consent management / cookie banner — no PRD requires one. See Open questions 4.
- Any other analytics provider — none is specified anywhere.

## Database changes

Migration file: `backend/migrations/0018_meta_events.sql`

### `meta_event_log`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `event_id` | `text` | NOT NULL | — | The shared deduplication id (§6.4) |
| `event_name` | `text` | NOT NULL | — | One of the seven (§6.2) |
| `order_id` | `uuid` | NULL | — | FK → `orders(id)` ON DELETE SET NULL; set for `Purchase` |
| `channel` | `text` | NOT NULL | — | `CAPI` (the backend records only its own sends) |
| `status` | `text` | NOT NULL | — | `SENT` \| `FAILED` \| `SKIPPED` |
| `http_status` | `integer` | NULL | — | |
| `error_message` | `text` | NULL | — | Redacted |
| `value_amount` | `numeric(12,2)` | NULL | — | For reconciliation against order totals |
| `sent_at` | `timestamptz` | NOT NULL | `now()` | |

- **`CREATE UNIQUE INDEX ON meta_event_log (event_name, order_id) WHERE event_name = 'Purchase' AND order_id IS NOT NULL;`** — a database-level guarantee that a second `Purchase` for the same order cannot be recorded, backing §6.3's "fires exactly once."
- Index on `event_id`.

No event payload is stored. Payloads contain hashed customer identifiers and order values; §6.6's prohibitions and the `database` skill §4's PII rule both argue for storing outcomes rather than bodies.

## Backend work

### The shared event contract (§6.9)

`shared/analytics/metaEvents.ts`, imported by **both** workspaces so names and shapes cannot drift:

```ts
export const META_EVENTS = {
  PAGE_VIEW: 'PageView',
  VIEW_CONTENT: 'ViewContent',
  SEARCH: 'Search',
  ADD_TO_CART: 'AddToCart',
  INITIATE_CHECKOUT: 'InitiateCheckout',
  ADD_PAYMENT_INFO: 'AddPaymentInfo',
  PURCHASE: 'Purchase',
} as const;

export const CURRENCY = 'BDT' as const;          // §6.5 — always BDT

export type MetaContent = { id: string; quantity: number; item_price: number };

export type MetaEventPayload = {
  event_name: MetaEventName;
  event_id: string;                               // §6.4 — shared by both channels
  event_time: number;                             // unix seconds
  content_type?: 'product';
  content_ids?: string[];
  contents?: MetaContent[];
  content_name?: string;
  content_category?: string;
  search_string?: string;
  num_items?: number;
  value?: number;
  currency?: typeof CURRENCY;
};

export function newEventId(): string;             // UUID v4 — one generator, both sides
```

§6.9 requires frontend and backend to "share a single source of truth for event names, parameter shapes, and `event_id` generation strategy," so this module is the only place any of the three is defined. Neither side hardcodes an event name string.

### The CAPI client

`services/analytics/metaCapi.ts` — the only module holding `META_CAPI_ACCESS_TOKEN`.

```ts
sendEvent(payload: MetaEventPayload, user: MetaUserData, ctx: { orderId?: string }): Promise<void>;
```

- Posts to the Graph API endpoint for the configured Pixel ID, through `safeFetch` with a short timeout (default 3 s).
- **Never throws to its caller.** Every failure is caught, logged with the `event_id`, and recorded as `FAILED` in `meta_event_log`. §6.8 requires that a Meta failure "never block, delay, fail, or roll back the underlying customer action."
- **No automatic retry.** §6.8 permits logging but warns against retrying "in a way that risks duplicate order side-effects"; since a timeout may mean Meta accepted the event, a blind retry would double-count. One attempt, recorded.
- When `META_PIXEL_ID` or the access token is unset, the client records `SKIPPED` and returns — the platform runs fine without Meta configured.

### `MetaUserData` — hashing (§6.5, §6.6)

```ts
type MetaUserData = {
  em?: string;    // SHA-256 of the lowercased, trimmed email
  ph?: string;    // SHA-256 of the digits-only phone in international form
  fn?: string;    // SHA-256 of the lowercased first name
  ln?: string;    // SHA-256 of the lowercased last name
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string; fbc?: string;    // Meta's own browser cookies, forwarded as-is
};
```

Normalization follows Meta's documented rules (lowercase, trim, digits-only phone with country code) before hashing, because an unnormalized hash simply fails to match and silently degrades attribution. **No field is ever sent in plain text** (§6.5).

§6.5 states this "applies the same way to guest orders… with no separate handling required because Purchase firing and event data both key off the order record, not off whether an account exists." The builder therefore reads the **order's** contact fields, never a session, so guest and registered orders produce identical shapes with one code path.

**Never included, at any layer** (§6.6): passwords or hashes, OTPs, session or auth tokens, bKash Transaction IDs, payment screenshots or any proof reference. The `MetaUserData` type has no field capable of carrying them, and the payload builders read from an allowlisted projection of the order — so omission is structural, not a matter of remembering.

### The `Purchase` subscriber (§6.3)

Subscribes to spec 12's `order.confirmed` domain event, which spec 12 emits **only** on the write that sets `order_status = 'CONFIRMED'` and **after** the transaction commits.

```text
order.confirmed { orderId } →
  load the order (total, items, contact fields)
  event_id = 'purchase:' + orderId          // deterministic — see below
  insert meta_event_log (Purchase, orderId) // unique index rejects a second
  → on conflict: skip, already sent
  → otherwise: sendEvent(Purchase, …)
  return the event_id to the frontend for the Pixel copy
```

Three properties this gives, each mapping to a PRD rule:

- **Exactly once** (§6.3) — the unique index on `(event_name, order_id)` for `Purchase` makes a second send impossible even if the event were somehow emitted twice. Combined with spec 12's guarantee that `CONFIRMED` is reachable only once per order, the event fires once per order, period.
- **Only on the `CONFIRMED` write** (§6.3) — the subscriber is attached to the order transition alone. Verifying a payment (`PAID_VERIFIED`) emits nothing. §6.3 is explicit: "never on a 'payment verified' state that has not yet also set the order status to `CONFIRMED`," and whether the admin performs one combined action or two sequential ones (spec 13 implements two), `Purchase` fires exactly once because only the order write triggers it.
- **Never blocks the order** (§6.8) — the subscriber runs post-commit; a throw inside it cannot roll back a confirmation. Spec 12 asserts this independently.

**`event_id` for `Purchase` is deterministic** (`purchase:<orderId>`) rather than random. `Purchase` is server-initiated, and the Pixel copy must carry the same id (§6.4) even though the browser was not involved in the confirmation. A deterministic id lets any later Pixel firing — for instance, if the customer views their order and the page reports a newly-confirmed purchase — reuse the exact same value. Every other event is browser-initiated and uses a random `newEventId()` passed to the backend.

**No reversal event** (§6.3) — no subscriber exists for `CANCELLED` or `RETURNED`.

**Value is the discounted total** (§6.3, §8.31, §8.15c) — `orders.total_amount`, never the pre-discount subtotal.

### Server-side event ingestion

`POST /api/analytics/event` — public, `rateLimit('publicCeiling')`, called by the frontend so that browser-initiated events reach CAPI with the **same** `event_id` the Pixel used (§6.4).

```ts
type AnalyticsEventRequest = {
  eventName: Exclude<MetaEventName, 'Purchase'>;   // Purchase is server-initiated only
  eventId: string;                                  // generated by the client, shared with the Pixel
  eventSourceUrl: string;
  payload: { contentIds?: string[]; searchString?: string; /* ids and quantities only */ };
};
```

The endpoint **recomputes every monetary value server-side** rather than accepting one. §8.31 requires `InitiateCheckout` and `AddPaymentInfo` to "reflect the current server-computed total at the time of firing… rather than a client-computed figure" (§8.16 forbids trusting client economics generally). The client sends ids and quantities; the server resolves the cart (spec 09) and computes the value. Rejecting `Purchase` here is what keeps the §6.3 timing rule unforgeable — a client cannot fire a purchase at submission time.

### Failure isolation (§6.8)

Every call site wraps the send in a fire-and-forget that cannot affect the request:

```ts
void metaCapi.sendEvent(...).catch(() => {});   // already logged internally
```

No order, payment, cart, or checkout code path awaits a Meta call, and no such call participates in a database transaction.

## Frontend work

### Pixel initialization (§6.1, §6.7)

- `NEXT_PUBLIC_META_PIXEL_ID` — public by necessity, since the Pixel script needs it (§6.7 confirms the ID "is not secret and may be exposed to the frontend").
- The script loads from `connect.facebook.net`, which spec 04's CSP `script-src` already allows.
- When the env var is unset, the Pixel is not loaded and the site works normally.
- **The CAPI access token appears nowhere in the frontend** — not in any `NEXT_PUBLIC_*` var, not in any bundle (§6.7).

### The shared client utility (§6.9)

`frontend/src/lib/analytics.ts` — one module, extending whatever analytics utility exists rather than creating a parallel system (§6.9):

```ts
track(eventName, payload) {
  const eventId = newEventId();              // the shared generator
  fbq('track', eventName, params, { eventID: eventId });   // Pixel copy
  void postToBackend({ eventName, eventId, ... });          // CAPI copy, same id
}
```

One call produces both copies with one `event_id` — §6.4's requirement satisfied by construction, since no call site can fire one channel without the other.

### Event placement (§6.2, §13.16)

| Event | Where |
| --- | --- |
| `PageView` | Root layout, on every route change, including the homepage (§13.16) |
| `ViewContent` | Product detail page (spec 07) — and **only** there; the homepage fires no competing content-view event (§13.16) |
| `Search` | Search results page (spec 07), with the query string |
| `AddToCart` | Add-to-cart success in spec 09 |
| `InitiateCheckout` | Entering checkout step 1 (spec 11) |
| `AddPaymentInfo` | Payment method selected / payment information submitted (spec 11, §6.2) |
| `Purchase` | **Never fired by client action.** The Pixel copy fires only when the backend reports a confirmed order with its `event_id` |

The attach points marked in specs 07, 09, and 11 are filled here; no new call sites are invented.

`Purchase` on the Pixel side: since confirmation happens in the back-office long after the customer left, the client-side copy fires only if the customer later loads a page (their order history or the guest lookup) reporting a newly-confirmed order whose `purchaseEventId` has not yet been fired in that browser. It reuses the deterministic id, so Meta deduplicates against the CAPI copy (§6.4). If the customer never returns, the CAPI copy stands alone — which is precisely why §6.1 describes the backend copy as carrying "authoritative order data that only the server can guarantee."

### Frontend never computes a value (`frontend` §2, §8.31)

The client sends content ids and quantities; monetary values come from the backend's response or are computed server-side in the CAPI copy. No Pixel payload carries a value the browser calculated.

## Security requirements

- **CAPI access token is backend-only** (§6.7) — held in one module, never in a response, never logged, never in any `NEXT_PUBLIC_*` var or client bundle.
- **All customer identifiers are hashed** before leaving the platform (§6.5) — `MetaUserData` has no plain-text field.
- **Prohibited data cannot be sent** (§6.6) — no builder reads a password, OTP, token, Transaction ID, or payment-proof field; the payload types have no slot for them.
- **Meta failures are isolated** (§6.8) — no analytics call is awaited by, or transacted with, a business operation.
- **No unsafe retry** (§6.8).
- **`Purchase` is server-initiated only** — the public ingestion endpoint rejects it, so a client cannot forge a purchase or fire one at submission time (§6.3).
- **Monetary values are recomputed server-side** (§8.31, §8.16) — a tampered client value cannot reach Meta or influence anything.
- **Outbound calls go through `safeFetch`** with a host allowlist (`security` §6).
- **CSP** permits exactly the Meta script origin and no other third party (§11.5).
- **Rate limiting** on the ingestion endpoint (§11.3).
- No event payload bodies are stored, so the log cannot become a secondary PII store (`database` §4).

## Data integrity / idempotency

- **One `Purchase` per order, enforced by a unique index** (§6.3) — not by application discipline. Combined with spec 12's single reachable `CONFIRMED` write, double-counting is structurally prevented.
- **Shared `event_id` per occurrence** (§6.4) — one generator, one call site producing both channels, so Pixel and CAPI copies always deduplicate.
- **Deterministic `Purchase` id** means a delayed Pixel copy still matches its CAPI counterpart, however long afterwards it fires.
- **Post-commit emission** means an event never describes an order state that was rolled back.
- **No reversal events** (§6.3) — a cancelled order's `Purchase` stands, as the PRD explicitly accepts.
- **Values reconcile** — `meta_event_log.value_amount` records what was sent, so a mismatch against `orders.total_amount` is detectable rather than invisible.
- **Analytics never mutates business data** — no subscriber or sender writes to any table other than `meta_event_log`.

## Acceptance criteria

1. With `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` set, loading a product page fires a Pixel `ViewContent` and a CAPI `ViewContent` **with the same `event_id`** (verified in the network log and `meta_event_log`).
2. The same holds for `PageView`, `Search`, `AddToCart`, `InitiateCheckout`, and `AddPaymentInfo` — all seven names come from the shared constants module, with no hardcoded string at any call site.
3. Placing an order fires **no** `Purchase` on either channel (§6.3).
4. Verifying a bKash payment (`PAID_VERIFIED`) fires **no** `Purchase` (§6.3).
5. Confirming the order fires exactly one CAPI `Purchase`, with `value` equal to `orders.total_amount` and `currency: 'BDT'`.
6. Confirming a COD order fires `Purchase` on the same transition (§6.3).
7. With a coupon applied, the `Purchase` value is the **discounted** total, not the subtotal (§8.31, §6.3).
8. `SELECT count(*) FROM meta_event_log WHERE event_name='Purchase' AND order_id=$1` is 1; a forced second emission is rejected by the unique index.
9. Cancelling or returning a confirmed order fires **no** event of any kind (§6.3).
10. With the Meta endpoint returning 500 or timing out, order confirmation still succeeds, stock still decrements, and the failure is recorded as `FAILED` (§6.8).
11. No automatic retry occurs after a failed send — exactly one outbound attempt is recorded (§6.8).
12. `POST /api/analytics/event` with `eventName: 'Purchase'` returns 400.
13. `POST /api/analytics/event` carrying a `value` field returns 400; the server computes the value from the cart (§8.31).
14. Every CAPI payload's `user_data` fields are 64-character hex hashes; no plain-text email, phone, or name appears in any outbound request (§6.5).
15. No outbound payload contains a password, OTP, token, Transaction ID, or payment-proof reference (§6.6).
16. `grep -ri "META_CAPI_ACCESS_TOKEN" frontend/` returns nothing, and the built client bundle does not contain the token (§6.7).
17. Unsetting `META_PIXEL_ID` leaves the storefront fully functional with no Pixel script and `SKIPPED` CAPI entries.
18. A guest order's `Purchase` carries the same hashed-identifier shape as a registered customer's, with no branch on account type (§6.5).
19. The homepage fires `PageView` only; clicking into a product fires `ViewContent` on the product page, and the homepage fires no competing content-view event (§13.16).
20. No event name outside the seven in §6.2 is ever sent — no coupon-application event exists (§8.31).
21. Every event's `currency` is `BDT` (§6.5).

## Tests required

Per the `test` skill §5 (standard coverage) — with the `Purchase` timing rule treated as high-risk, since it depends on the state machine the skill ranks first.

1. **`Purchase` timing** (§6.3) — the central rule, one test per case: not at order placement; not on payment verification; exactly once on the `CONFIRMED` transition for bKash; exactly once on `CONFIRMED` for COD.
2. **`Purchase` fires once** (§6.3) — a forced duplicate emission is blocked by the unique index; a re-confirmation attempt (rejected by spec 12 as an invalid transition) sends nothing.
3. **No reversal events** (§6.3) — cancelling or returning a confirmed order sends nothing.
4. **Shared `event_id`** (§6.4) — for each browser-initiated event, the Pixel id and the CAPI id are identical; a mismatch fails the test.
5. **Deterministic `Purchase` id** — the CAPI copy and a later Pixel copy carry the same id.
6. **Discounted value** (§6.3, §8.31) — `Purchase`, `InitiateCheckout`, and `AddPaymentInfo` values all reflect the coupon discount and equal the server-computed total.
7. **Server-side value computation** (§8.31, §8.16) — a client-submitted value is rejected, not used.
8. **`Purchase` cannot be client-initiated** (§6.3) — the ingestion endpoint rejects it.
9. **Identifier hashing** (§6.5) — email, phone, and name are hashed with Meta's normalization applied; no plain-text value appears in a captured request.
10. **Prohibited data never sent** (§6.6) — a payload-inspection test asserting the absence of password, OTP, token, Transaction ID, and proof fields; written as a key-set assertion so a future field addition fails rather than leaks.
11. **Failure isolation** (§6.8) — the `test` skill's kind of regression case: with Meta erroring or timing out, order confirmation succeeds, stock decrements, and the transaction commits. Run for both a 500 and a timeout.
12. **No unsafe retry** (§6.8) — one outbound attempt per event.
13. **Missing configuration degrades gracefully** — with no Pixel ID or token, nothing breaks and entries record `SKIPPED`.
14. **Guest parity** (§6.5) — identical payload shape for guest and registered orders.
15. **Event taxonomy is closed** (§6.2, §8.31, §13.16) — a test asserting that only the seven names can be sent, so no future feature quietly adds an eighth.
16. **Currency is always `BDT`** (§6.5).
17. **Homepage does not double-fire content views** (§13.16).

## Open questions / assumptions

1. **Graph API version.** No PRD names one, and CLAUDE.md §6 forbids guessing an external API. *Assumption:* the implementing session reads Meta's current Conversions API documentation and pins the version in `META_GRAPH_API_VERSION` so an upstream change is a configuration update rather than a code change.
2. **`fbp` / `fbc` cookie forwarding.** §6.5 lists Meta's expected fields without naming these, but Meta's own matching quality depends on them. *Assumption:* forward the `_fbp` and `_fbc` cookies from the browser to the CAPI call when present. They are Meta's own identifiers, not platform PII, so this does not conflict with §6.6.
3. **The Pixel copy of `Purchase`.** §6.3 says the transition handler triggers `Purchase` "both Pixel-side, via a value returned to the frontend or a follow-up client event, and CAPI-side, via the backend," while confirmation happens in the back-office with no customer browser present. *Assumption:* the CAPI copy is authoritative and always sent; the Pixel copy fires opportunistically when the customer next loads a page reporting the confirmed order, using the deterministic shared id. **Flagged:** for many orders the Pixel copy will simply never fire, which §6.1's rationale anticipates ("the backend copy also carries authoritative order data that only the server can guarantee").
4. **Consent / cookie banner.** No PRD mentions consent, and §11.10 warns against speculative additions. *Assumption:* no consent gate in v1; the Pixel loads when configured. **Flagged:** the platform is Bangladesh-focused, so GDPR-style consent is not automatically required, but any EU traffic would raise the question. This is a business/legal decision, not a technical one.
5. **`Search` event content.** §6.2 lists `Search`; §6.5's field list is generic. *Assumption:* send `search_string` and the resulting `content_ids` (capped), which is Meta's documented shape.
6. **Existing analytics utility.** §6.9 says to extend one "if an analytics utility/module already exists." *Assumption:* none exists before this slice, so this slice creates the single module both sides import — which is what §6.9 is protecting against having two of.
7. **Event log retention.** Not specified. *Assumption:* `meta_event_log` is retained indefinitely for `Purchase` rows (reconciliation against orders) and pruned after 90 days for the rest, since the high-volume rows have no lasting value.
