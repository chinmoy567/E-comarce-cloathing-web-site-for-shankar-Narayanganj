# Spec9 — Courier Fraud / Customer Risk Check

## Context

The PRD (`09-fraud-risk-check.md` §7) requires that before a shipment is created, Admin/Manager can trigger a courier-history risk check on a customer's phone number via an external provider (BD Courier API), review the result, and decide whether to proceed — without ever auto-blocking an order or labeling a customer as fraudulent. A fully-specified implementation blueprint already exists at `.claude/implementation specs/16-customer-risk-check.md`, written against this exact PRD section, and it should be followed as the primary source of truth for this plan (it is more detailed and more current than the PRD prose alone).

Codebase state confirmed by exploration (2026-09-24):
- **Scaffolding already in place**: permission key `customer.risk.check` (`backend/src/types/permissions.ts`), rate-limit definitions `RL_RISK_CHECK_MAX`/`RL_RISK_CHECK_WINDOW_SEC` (`backend/src/config/env.ts`) and a `riskCheck` entry in `backend/src/config/rateLimits.ts`, phone normalization (`backend/src/lib/phone.ts` — `normalizeBdPhone`/`isValidBdPhone`), SSRF-guarded fetch (`backend/src/lib/safeFetch.ts`), audit logging (`backend/src/repositories/audit.repository.ts`).
- **Not yet built**: the `customer_risk_checks` table/migration, the `services/fraud/` module, the risk-check routes, `getOrderByNumber` in the orders repository, any admin order detail page/route, `BD_COURIER_API_KEY`/`BD_COURIER_BASE_URL` env vars.
- **Gaps vs. the implementation spec that this plan resolves**:
  1. The `riskCheck` rate limiter is currently keyed on `actorId` (the admin/manager), but §7.6 requires limiting fresh checks **per customer**. This plan adds a `'customerId'` `IdentifierSource` and rewires the limiter.
  2. Spec 16 assumes the spec-13 admin order detail page and an order-by-number lookup already exist. Neither does. Per user decision, this plan adds a **minimal, read-only** order detail page (route + a small `GET /api/admin/orders/:orderNumber` summary endpoint) solely to host the Customer Risk section — no payment verification, COD confirmation, cancellation, or other spec-13 actions. The full spec-13 order panel remains a separate, later effort.
  3. The exact BD Courier API contract (endpoint, auth, request/response shape) must be fetched from current official documentation at implementation time — it is intentionally not fixed by this plan, per §7.3 and CLAUDE.md §6.

## Scope

**In scope**
- `customer_risk_checks` table (migration `0008_customer_risk_checks.sql` — next available number after `0007_meta_events.sql`).
- `services/fraud/customerRiskService.ts` + `services/fraud/providers/{types.ts,bdCourierProvider.ts}`.
- `GET`/`POST` `/api/admin/orders/:orderNumber/risk-check` routes, permission- and status-gated.
- Rate-limit rework: new `'customerId'` `IdentifierSource`, `riskCheck` limiter rekeyed to customer.
- Minimal `GET /api/admin/orders/:orderNumber` summary endpoint (order number, status, customer id/name/phone) — just enough to host the risk panel. Requires adding `getOrderByNumber` to `orders.repository.ts`.
- Minimal admin order detail page at `frontend/src/app/admin/(shell)/orders/[orderNumber]/page.tsx` showing basic order info + the Customer Risk section.
- Env vars `BD_COURIER_API_KEY`, `BD_COURIER_BASE_URL` (names to be confirmed against current BD Courier docs at implementation time).
- Tests under `backend/tests/spec-09-fraud-risk-check/`.

**Out of scope (deferred to spec 13/14 later)**
- Order list page, payment verification/rejection, COD confirmation, cancellation, customer management, shipment creation/courier selection.
- Any automatic/scheduled risk checking or automatic order blocking.
- Risk data in any customer-facing response (already excluded by design).

## Database

New migration `backend/migrations/0008_customer_risk_checks.sql`, following the header-comment + `CREATE TABLE` + separate `CREATE INDEX` convention from `0007_meta_events.sql`.

```sql
CREATE TYPE risk_level AS ENUM ('LOW','MEDIUM','HIGH','UNKNOWN','CHECK_FAILED');

CREATE TABLE customer_risk_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  provider text NOT NULL,
  risk_score numeric(6,2),
  risk_level risk_level NOT NULL,
  total_orders integer,
  successful_orders integer,
  returned_orders integer,
  raw_result jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by uuid REFERENCES users(id)
);

CREATE INDEX idx_customer_risk_checks_customer_checked_at
  ON customer_risk_checks (customer_id, checked_at DESC);
```

Verify current highest migration number in `backend/migrations/` at implementation time before finalizing the filename (currently `0007`).

## Backend

### Module layout (mirrors `services/courier/` pattern)
```
backend/src/services/fraud/
  customerRiskService.ts
  providers/
    types.ts              # RiskCheckProvider interface, RiskCheckResult type
    bdCourierProvider.ts   # written against current BD Courier API docs, via safeFetch
```

### Repository additions
- `backend/src/repositories/orders.repository.ts`: add `getOrderByNumber(orderNumber: string, options?): Promise<Order | null>` (mirrors existing `getOrderById`).
- New `backend/src/repositories/customerRiskChecks.repository.ts`: two read functions per spec 16 §"raw_result is never selected" — `getLatestForCustomer(customerId)` (display projection, no `raw_result`) and an audit-only reader; plus `insert(...)`.

### Rate limiting rework
- `backend/src/config/rateLimits.ts`: extend `IdentifierSource` to `'phone' | 'userIdentifier' | 'orderNumber' | 'actorId' | 'customerId' | 'none'`.
- `backend/src/middleware/rateLimit.ts`: teach the identifier resolver to read `customerId` (from the loaded order's `customer_id`, attached to `req` before the limiter runs — requires the route to resolve the order first, then apply `rateLimit('riskCheck')`, changing the current route-then-limiter ordering).
- Update the `riskCheck` entry's `identifierSource` to `'customerId'`.

### Routes (`backend/src/routes/admin/orders.routes.ts`, following existing `validate → requirePermission → controller` convention)
| Method | Path | Permission | Limiter |
|---|---|---|---|
| `GET` | `/:orderNumber` | `order.view` | `authenticatedCeiling` |
| `GET` | `/:orderNumber/risk-check` | `customer.risk.check` | `authenticatedCeiling` |
| `POST` | `/:orderNumber/risk-check` | `customer.risk.check` | `riskCheck` (keyed by resolved customer) |

Controllers follow the modern thin style used in `managers.controller.ts` (`try/catch → next(err)`, `res.status(n).json({ data } satisfies ApiSuccess<T>)`), not the legacy `orders.controller.ts` pattern.

### Behavior — implements spec 16 §"GET behaviour" / §"POST behaviour" exactly:
- `GET`: loads order by number → resolves `customer_id` → looks up most recent `customer_risk_checks` row **for that customer across all orders** (not order-scoped) → returns cached result or "not available," plus `canTriggerFreshCheck` (true only if `order_status` is `CONFIRMED`/`PROCESSING`). Never calls the provider.
- `POST`: server-side status gate (409 `RISK_CHECK_NOT_ALLOWED` outside `CONFIRMED`/`PROCESSING`) → rate limit per customer → normalize/validate phone (`normalizeBdPhone`/`isValidBdPhone`) → call provider via `safeFetch` → insert new row (success, failure→`CHECK_FAILED`, or no-history→`UNKNOWN`) → audit log entry → return mapped response (never `raw_result`).

### Types
`RiskCheckResponse` exactly as specified in spec 16 (no field for `raw_result`).

### Error cases
Exactly the table in spec 16: `RISK_CHECK_NOT_ALLOWED` (409), `FORBIDDEN` (403), `RATE_LIMITED` (429), `INVALID_PHONE_NUMBER` (422), provider failure → 200 with `CHECK_FAILED` payload (graceful degrade, not an HTTP error), `RISK_PROVIDER_UNCONFIGURED` (503).

## Frontend

- `frontend/src/app/admin/(shell)/orders/[orderNumber]/page.tsx` (new — first file in this directory tree): minimal order header (order number, status, customer name/phone) fetched from the new `GET /:orderNumber` endpoint, plus the Customer Risk section.
- Customer Risk section per spec 16's exact layout, labels, and palette (`#059669` LOW / `#F59E0B` MEDIUM / `#DC2626` HIGH / `#6B7280` UNKNOWN & CHECK_FAILED):
  - Loads via `GET .../risk-check` on page open — never triggers the provider.
  - "Check Customer Risk" button (44px, full-width on mobile) issues `POST`, disabled + tooltip when `canTriggerFreshCheck` is false.
  - Omits fields the provider didn't return (never renders `0` or `—` for absent data).
  - Wording discipline: never "fraud," "fraudster," "criminal," "blacklist."
  - Visible only to users with `customer.risk.check`; renders backend 403 gracefully.
- No order list page, no action buttons for verify/confirm/cancel/etc. — those routes 404 until spec 13 lands, so this page has no links to them.

## Security
- Provider calls only from backend via `safeFetch` with `BD_COURIER_BASE_URL` in the allowlist.
- `BD_COURIER_API_KEY`/`BD_COURIER_BASE_URL` in env only, never in `NEXT_PUBLIC_*` or client bundle.
- Server-side `CONFIRMED`/`PROCESSING` gate on `POST`, independent of any frontend button state.
- Both endpoints permission-checked server-side (`customer.risk.check`).
- Only the normalized phone number leaves the platform — no passwords, OTPs, tokens, or other customer data.
- `raw_result` has no field in the response type or display projection — structurally excluded, not just omitted by convention.
- Every check writes an `audit_logs` row via `audit.repository.ts` `append()`.

## Tests (`backend/tests/spec-09-fraud-risk-check/`)

Following the spec-wise folder convention (CLAUDE.md §10) and spec 16's 16-item "Tests required" list:
1. Caching is real — repeated `GET` = zero provider calls; `POST` = exactly one.
2. Cache key is `customer_id`, not `order_id` — order B for the same customer sees order A's check result.
3. Server-side status gate — one test per disallowed status (`PENDING_CONFIRMATION`, `COD_VERIFICATION_PENDING`, `CANCELLED`, `DELIVERED`, `RETURNED`) and per allowed status (`CONFIRMED`, `PROCESSING`), called directly bypassing any UI.
4. Failure degrades gracefully — timeout/500 → `CHECK_FAILED`, order/payment/shipment status unchanged.
5. No history → `UNKNOWN`, never `HIGH`.
6. Absent provider fields stay `NULL`, not `0`.
7. Unrecognized risk band → `UNKNOWN`, logged not guessed.
8. `raw_result` never appears in any response (key-set assertion).
9. Outbound payload contains only the normalized phone number.
10. Phone normalization applied before the call.
11. Rate limiting — under/over limit, scoped per customer (a different customer is unaffected).
12. Permission enforcement — 403 without `customer.risk.check` on both endpoints.
13. Guest-customer parity — identical behavior for a guest customer reference.
14. Audit log written with actor, order, customer.
15. No order/payment/shipment status side effects, before/after snapshot.
16. Risk fields absent from any customer-facing payload (regression guard).

Update `backend/vitest.spec09.config.ts` (new file, mirroring existing `vitest.specXX.config.ts` files) to include this folder.

## Verification
1. Run new spec-09 vitest suite: `npm run test:spec09` (after adding the script/config) — all tests green.
2. Run full backend test suite to confirm no regression: `npm test` (or the repo's existing aggregate script).
3. Manually smoke test via the dev server: confirm an order in `CONFIRMED` status can trigger a check (mock/stub provider if BD Courier credentials aren't available yet), confirm the panel renders correctly at 375px width, confirm the button is disabled on a `DELIVERED`-status order and that hitting the `POST` endpoint directly (e.g. via curl) against that order returns `409 RISK_CHECK_NOT_ALLOWED`.
4. `grep -ri "BD_COURIER" frontend/` returns nothing.
5. Confirm no response payload anywhere contains `raw_result` or a provider-specific key via a serialized-payload assertion in tests (already covered by test #8).

## Open items to resolve during implementation
- Fetch current BD Courier API docs (`https://bdcourier.com/api-docs#endpoints`) to fix the exact request/response contract for `bdCourierProvider.ts` — do not guess.
- Confirm actual next-available migration number in `backend/migrations/` (assumed `0008` here, verify at implementation time).
- Confirm risk-level-from-score mapping thresholds only if the provider's docs define them; otherwise `UNKNOWN` fallback per spec 16's stated assumption.
