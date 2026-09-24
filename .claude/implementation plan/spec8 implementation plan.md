# Implementation Plan — Spec 08: Analytics and Meta Pixel / CAPI (Buildable Slice)

Source requirement: `.claude/project requirment documents/08-analytics-meta.md` §6
Source implementation spec: `.claude/implementation specs/18-meta-pixel-and-conversions-api.md`
Related PRDs: `10-coupon-discount.md` §8.31, `13-homepage-cms.md` §13.16, `07-order-state-machine.md` §5.21.9, `11-security-hardening.md` §11.5/§11.6/§11.9
Status: **Planned — not yet implemented. Scoped down from the full spec-18 doc — see "Why this is a partial slice" below.**

---

## Context

The user asked for an implementation plan for "spec 8" (the Analytics/Meta Pixel requirement, `08-analytics-meta.md`). A full implementation spec for it already exists at `.claude/implementation specs/18-meta-pixel-and-conversions-api.md` and is very detailed. However, that spec assumes infrastructure this repo does not yet have.

A codebase audit (two Explore passes) found:

- **No domain event system exists anywhere in `backend/src`.** `orderStatus.service.ts`'s `confirmOrder()` updates status and writes audit/history rows but emits nothing. Spec 18's central mechanism — a `Purchase` subscriber on an `order.confirmed` event — has no event to subscribe to.
- **No cart or checkout exists.** No `cart`/`checkout` files anywhere in `backend/src`, no order-items table, no customer-facing (non-admin) order routes. `AddToCart` and `InitiateCheckout`/`AddPaymentInfo` have no call site.
- **No storefront pages exist at all** — only the admin back-office and a placeholder homepage layout. There is no product detail page and no search results page, so `ViewContent` and `Search` also have no call site yet.
- **No `shared/` workspace exists.** Root `package.json` declares only `"workspaces": ["backend", "frontend"]`. Spec 18's proposed `shared/analytics/metaEvents.ts` is a brand-new pattern requiring workspace + tsconfig scaffolding.
- What **does** exist and is reusable as-is: `backend/src/lib/safeFetch.ts` (SSRF-guarded fetch, matches spec 18's CAPI-client needs), `backend/src/lib/logger.ts` (pino, redaction-aware), `backend/src/config/env.ts` (Zod env schema, `.optional()` pattern), `backend/src/config/rateLimits.ts` (`'publicCeiling'` limiter already defined), and the migration-runner convention (`backend/migrations/000N_*.sql`, forward-only, no explicit `BEGIN`/`COMMIT` in the file).

Per user decision: **scope this plan down to what is buildable today**, and explicitly list the rest as deferred follow-up rather than pretending the dependencies exist. This avoids producing dead code that references a `Purchase` subscriber with no event to hook, or frontend event calls on pages that don't exist.

---

## What this slice builds now

1. The shared event-contract module and the `shared/` workspace scaffolding it requires (§6.9 — the single source of truth both sides must import).
2. The backend CAPI client (`services/analytics/metaCapi.ts`), built on the existing `safeFetch`.
3. Identifier hashing (`MetaUserData`) per §6.5/§6.6.
4. The `meta_event_log` migration and its unique-index guarantee for `Purchase` (schema only — the writer path is deferred, but building the table now means spec 12/18-completion doesn't need a second migration later).
5. The public event-ingestion endpoint `POST /api/analytics/event`, restricted to non-`Purchase` events, with server-side rate limiting.
6. Frontend Pixel initialization + the shared `track()` client utility, mounted in the root layout so `PageView` fires on every route change from day one.
7. Env/config wiring: `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_GRAPH_API_VERSION`, `NEXT_PUBLIC_META_PIXEL_ID`.

## What this slice explicitly defers (and why)

| Deferred item | Blocked by | Action needed later |
| --- | --- | --- |
| `ViewContent` event | No product detail page exists | Wire into the storefront PDP when built (spec 07/implementation-spec-07 equivalent) |
| `Search` event | No search results page exists | Wire in when the search page is built |
| `AddToCart` event | No cart exists | Wire in when cart (spec 09) is built |
| `InitiateCheckout` / `AddPaymentInfo` | No checkout exists | Wire in when checkout (spec 11) is built |
| `Purchase` event + its subscriber | No `order.confirmed` domain event exists; `orderStatus.service.ts`'s `confirmOrder()` doesn't emit anything | Requires finishing the event-emission part of the order-state-machine service (spec 12), then adding the subscriber described in spec 18 |

Each deferred item's contract (event name, payload shape) is still defined now in the shared module, so nothing about it needs to be redesigned later — only the call site and the subscriber need to be added once their dependencies exist.

---

## 1. `shared/` workspace scaffolding

- Add `"shared"` to root `package.json`'s `"workspaces"` array (`["backend", "frontend", "shared"]`).
- Create `shared/package.json` (name `@fabrillke/shared` or similar, `"main"`/`"types"` pointing at `src/index.ts`, no runtime deps).
- Create `shared/tsconfig.json` extending the root `tsconfig.base.json`.
- Add a path mapping in `frontend/tsconfig.json`'s `paths`: `"@shared/*": ["../shared/src/*"]`.
- `backend/tsconfig.json` currently has no `paths` block at all — add one the same way (`"@shared/*": ["../shared/src/*"]`) rather than inventing a different resolution strategy for the backend.
- Verify both `npm run build`/`tsc --noEmit` in each workspace can resolve the new package before writing any consuming code.

## 2. Shared event contract — `shared/src/analytics/metaEvents.ts`

Per spec 18 §6.9, exactly as specified there:

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

export const CURRENCY = 'BDT' as const;

export type MetaEventName = (typeof META_EVENTS)[keyof typeof META_EVENTS];
export type MetaContent = { id: string; quantity: number; item_price: number };
export type MetaEventPayload = { /* per spec 18 §"shared event contract" */ };

export function newEventId(): string; // crypto.randomUUID()
```

All seven names are defined here even though four have no call site yet — this is what keeps the taxonomy closed (spec 18 acceptance criterion 20: "No event name outside the seven is ever sent") and means the deferred work only adds call sites, not new contract surface.

## 3. Database migration — `backend/migrations/0007_meta_events.sql`

**Correcting spec 18's own file-number assumption**: the doc says `0018_meta_events.sql`, but the latest migration on disk is `0006_orders.sql`, so the real next file is **`0007_meta_events.sql`**.

Same `meta_event_log` table spec 18 defines:

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `event_id` | `text` | NOT NULL | — | Shared dedup id |
| `event_name` | `text` | NOT NULL | — | One of the seven |
| `order_id` | `uuid` | NULL | — | FK → `orders(id)` ON DELETE SET NULL |
| `channel` | `text` | NOT NULL | — | `CAPI` |
| `status` | `text` | NOT NULL | — | `SENT` \| `FAILED` \| `SKIPPED` |
| `http_status` | `integer` | NULL | — | |
| `error_message` | `text` | NULL | — | Redacted |
| `value_amount` | `numeric(12,2)` | NULL | — | |
| `sent_at` | `timestamptz` | NOT NULL | `now()` | |

- `CREATE UNIQUE INDEX ON meta_event_log (event_name, order_id) WHERE event_name = 'Purchase' AND order_id IS NOT NULL;` — built now even though nothing writes a `Purchase` row yet, so the constraint is already in place the day the subscriber is added.
- Index on `event_id`.
- Follow `0006_orders.sql`'s exact conventions: header comment naming the file/spec, no explicit `BEGIN`/`COMMIT` (the runner wraps it), forward-only.

No payload bodies stored, per spec 18 and the `database` skill's PII rule.

## 4. Backend: env and config

`backend/src/config/env.ts` — append before the closing `});` (matching the existing `.optional()` style, e.g. `REDIS_URL`):

```ts
META_PIXEL_ID: z.string().min(1).optional(),
META_CAPI_ACCESS_TOKEN: z.string().min(1).optional(),
META_GRAPH_API_VERSION: z.string().min(1).optional(),
```

All optional — per spec 18, the platform must run fine with Meta unconfigured (`SKIPPED` entries, no Pixel script).

## 5. Backend: CAPI client — `backend/src/services/analytics/metaCapi.ts`

The only module holding `META_CAPI_ACCESS_TOKEN`.

```ts
export async function sendEvent(
  payload: MetaEventPayload,
  user: MetaUserData,
  ctx: { orderId?: string }
): Promise<void>
```

- Built on the existing `safeFetch` (`backend/src/lib/safeFetch.ts`) with `allowedHosts: ['graph.facebook.com']` and a short `timeoutMs` (3000).
- Never throws to its caller — every failure is caught, logged via the existing `logger` (`backend/src/lib/logger.ts`), and recorded as `FAILED` in `meta_event_log`.
- No automatic retry (§6.8 — a blind retry risks double-counting).
- When `META_PIXEL_ID` or the token is unset, records `SKIPPED` and returns.
- **Graph API version**: no PRD names one. Per spec 18's own flagged assumption, read Meta's current Conversions API docs at implementation time and pin the version via `META_GRAPH_API_VERSION` so an upstream change is a config update, not a code change.

## 6. Backend: identifier hashing — `backend/src/services/analytics/metaUserData.ts`

```ts
export type MetaUserData = {
  em?: string; ph?: string; fn?: string; ln?: string;
  client_ip_address?: string; client_user_agent?: string;
  fbp?: string; fbc?: string;
};
export function buildMetaUserData(input: { email?: string; phone?: string; firstName?: string; lastName?: string; ip?: string; userAgent?: string; fbp?: string; fbc?: string }): MetaUserData;
```

- SHA-256 over Meta's documented normalization (lowercase + trim email/names, digits-only phone with country code) before hashing.
- No plain-text field exists on the type — omission of prohibited data (§6.6: passwords, OTPs, tokens, Transaction IDs, payment proof) is structural, not a matter of remembering, since the function only reads an allowlisted set of scalar inputs.
- Not wired to the order table yet (no orders flow through analytics until the `Purchase` subscriber exists) — built now as a pure, order-independent utility so it's ready when that subscriber is added.

## 7. Backend: public ingestion endpoint

`POST /api/analytics/event` — public, `rateLimit('publicCeiling')` (already defined in `backend/src/config/rateLimits.ts` — reused, not duplicated).

```ts
type AnalyticsEventRequest = {
  eventName: Exclude<MetaEventName, 'Purchase'>;
  eventId: string;
  eventSourceUrl: string;
  payload: { contentIds?: string[]; searchString?: string };
};
```

- Rejects `eventName: 'Purchase'` with 400 — keeps the timing rule unforgeable even before the real subscriber exists.
- Rejects any request carrying a client-computed `value` field with 400 (§8.31/§8.16 — never trust client economics). Since no cart/checkout exists yet to compute a server-side value against, this endpoint validates and forwards ids/metadata only; value computation is added when spec 09/11 exist.
- Validated with a new Zod schema following `catalogue.validation.ts`'s pattern.
- Every call to `metaCapi.sendEvent` is fire-and-forget (`void sendEvent(...).catch(() => {})`) — never awaited by, or transacted with, any business operation (there are none yet at this call site, but the pattern is set here for later reuse).

## 8. Frontend: Pixel init + shared client — `frontend/src/lib/analytics.ts`

- `NEXT_PUBLIC_META_PIXEL_ID` — public by design (§6.7).
- Script loads from `connect.facebook.net` — confirm this is present in the CSP `script-src` set up by spec 04's security hardening before wiring the script tag.
- When unset, no Pixel script loads and the site works normally.
- The CAPI access token appears nowhere in the frontend — not in any `NEXT_PUBLIC_*` var, not in any bundle.

```ts
export function track(eventName: Exclude<MetaEventName, 'Purchase'>, payload: ...) {
  const eventId = newEventId();
  fbq('track', eventName, params, { eventID: eventId });
  void postToBackend({ eventName, eventId, ... });
}
```

Mount point: `frontend/src/app/layout.tsx` is a server component today with no client-side route tracking anywhere in the storefront (`usePathname` is only used in the admin shell). Add a small client component (e.g. `PixelInit`) as a sibling inside `<body>`, using `usePathname`/`useSearchParams` to fire `PageView` on every route change — this is the only call site this slice adds, since it's the only one of the seven events with an existing page to attach to.

## 9. Security requirements (apply now, hold for later additions)

- CAPI token: backend-only, one module, never logged, never in a `NEXT_PUBLIC_*` var.
- All identifiers hashed before leaving the platform — no plain-text field exists on `MetaUserData`.
- Outbound calls go through `safeFetch` with a host allowlist.
- CSP must permit `connect.facebook.net` and no other third party.
- Rate limiting on the ingestion endpoint via the existing `publicCeiling` limiter.
- No event payload bodies stored in `meta_event_log`.

## 10. Tests — `backend/tests/spec-08-analytics-meta/`

Following the `spec-{number}-{kebab-slug}` convention (matches implementation-spec numbering, not requirement-doc numbering — confirmed against the actual `spec-07-order-state-machine` folder on disk, not the stale prose in `TEST_ORGANIZATION.md`):

1. `metaEvents.contract.unit.test.ts` — the shared module: exactly seven event names, `newEventId()` uniqueness, no eighth name reachable from the ingestion endpoint's type.
2. `metaUserData.unit.test.ts` — hashing: normalization is applied before hashing; output is a 64-char hex SHA-256; no plain-text value appears in the return object's own shape (key-set assertion, so a future field addition fails rather than leaks per spec 18's own test-writing note).
3. `metaCapi.unit.test.ts` — failure isolation: a mocked 500 or timeout from `safeFetch` never throws out of `sendEvent`, and results in a `FAILED` `meta_event_log` row; missing `META_PIXEL_ID`/token results in `SKIPPED`; exactly one outbound attempt (no retry).
4. `analyticsIngestion.api.test.ts` — `POST /api/analytics/event`: `eventName: 'Purchase'` → 400; a request carrying a `value` field → 400; a valid non-Purchase event returns 200 and produces a `meta_event_log` row with the same `event_id` sent by the client; rate limiting via `publicCeiling` is enforced.
5. `metaEventLog.migration.test.ts` (or folded into the API test) — the unique index on `(event_name, order_id) WHERE event_name = 'Purchase'` rejects a second manually-inserted `Purchase` row for the same `order_id`, proving the DB-level guarantee is live even though no application code writes to it yet.

Add `backend/config/vitest/spec08/vitest.config.ts` mirroring `spec07`'s shape, and `"test:spec08": "vitest run --config config/vitest/spec08/vitest.config.ts"` to `backend/package.json`. (Note: `test:spec08geo` already exists for an unrelated geography prerequisite — do not collide with it; use `test:spec08` for this analytics work as a separate script name, or rename if a conflict is confirmed at implementation time.)

## 11. Acceptance criteria for this slice

1. With `META_PIXEL_ID` set, loading any storefront page fires a Pixel `PageView` and a CAPI `PageView` with the same `event_id`.
2. `POST /api/analytics/event` with `eventName: 'Purchase'` returns 400.
3. `POST /api/analytics/event` carrying a `value` field returns 400.
4. Every CAPI payload's `user_data` fields (when present) are 64-character hex hashes; no plain-text identifier appears in any outbound request.
5. With the Meta endpoint returning 500 or timing out, the ingestion request still returns 200 to the client and the failure is recorded as `FAILED`.
6. Unsetting `META_PIXEL_ID` leaves the storefront fully functional with no Pixel script and `SKIPPED` CAPI entries.
7. `grep -ri "META_CAPI_ACCESS_TOKEN" frontend/` returns nothing.
8. No event name outside the seven in the shared contract module is ever accepted by the ingestion endpoint.
9. `SELECT count(*) FROM meta_event_log WHERE event_name='Purchase' AND order_id=$1` cannot exceed 1 — enforced by the unique index even before any writer exists.

## 12. Follow-up work (not part of this slice — tracked for later)

- Finish spec 12's event emission (`order.confirmed`) inside `confirmOrder()` in `orderStatus.service.ts`.
- Build spec 09 (cart) and spec 11 (checkout) — needed for `AddToCart`, `InitiateCheckout`, `AddPaymentInfo`.
- Build the storefront product detail and search pages — needed for `ViewContent`, `Search`.
- Once the above exist: add the `Purchase` subscriber described in spec 18 (deterministic `event_id = 'purchase:' + orderId`, insert into `meta_event_log` guarded by the unique index already built in this slice, `sendEvent` with the order's discounted total and `buildMetaUserData` from the order's contact fields).
- Revisit `fbp`/`fbc` cookie forwarding once the frontend has a checkout flow to attach them to.

---

## Verification

1. `npm install` at the root resolves the new `shared` workspace in both `frontend` and `backend`.
2. `npm run build` (or `tsc --noEmit`) succeeds in `shared`, `backend`, and `frontend`.
3. Run the migration runner; confirm `0007_meta_events.sql` applies cleanly against a disposable schema and the unique partial index exists (`\d meta_event_log` in psql).
4. `npm run test:spec08` in `backend/` passes all five test files above.
5. Manually load the frontend with `NEXT_PUBLIC_META_PIXEL_ID` set and unset; confirm the Pixel script is present/absent in the rendered HTML accordingly, and that a `PageView` request appears in the network tab and a `SENT`/`SKIPPED` row appears in `meta_event_log`.
6. `grep -ri "META_CAPI_ACCESS_TOKEN" frontend/` returns nothing; confirm the built frontend bundle doesn't contain the token string either.
