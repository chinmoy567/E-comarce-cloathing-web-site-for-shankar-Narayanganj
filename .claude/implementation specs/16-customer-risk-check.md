# 16 — Courier Fraud / Customer Risk Check

## Goal

After this slice an Admin/Manager reviewing a confirmed order can explicitly trigger a courier-history risk check on the customer's phone number, see the provider's delivery-history indicators in a Customer Risk section on the order detail page, and decide whether to proceed to shipment creation. Results are cached per customer, the external API is never called on page load, failures degrade gracefully without blocking the order, and the raw provider response is stored for audit but never returned verbatim to the frontend. The check adds a review step — it introduces no order status and creates no shipment.

## Requirement references

- `09-fraud-risk-check.md` §7.1 — check the customer's delivery history through a courier fraud/risk-check service before a shipment is created, and surface the result so the Admin/Manager can decide; this is **a risk indicator based on courier delivery history, not proof of fraud** — the system must never label a customer a criminal or definitively call them a "fraudster."
- `09-fraud-risk-check.md` §7.2 — the workflow; the check must happen **before** courier shipment creation and must **never run automatically without an Admin/Manager-initiated action**; the external call is triggered explicitly, not on every page load; the action is enabled only when `orderStatus` is `CONFIRMED` or `PROCESSING`, and **the backend must enforce this status check server-side**, rejecting a request outside that range.
- `09-fraud-risk-check.md` §7.3 — called only from the Express backend, never from the Next.js frontend; a dedicated `customerRiskService` module kept separate from the courier shipment service; **the exact endpoint, authentication, request format, and response schema must be taken from the current official BD Courier API documentation at implementation time — never guessed**.
- `09-fraud-risk-check.md` §7.4 — credentials in environment variables (e.g. `BD_COURIER_API_KEY`, `BD_COURIER_BASE_URL`), never hard-coded, never exposed to the browser or the Next.js client bundle.
- `09-fraud-risk-check.md` §7.5 — the displayable fields; **the system must not invent fields the API does not return**.
- `09-fraud-risk-check.md` §7.6 — the external API is not called every time an order page is opened; the latest result is stored in PostgreSQL and reused; a fresh check is manually triggerable, subject to the §2.5 rate-limiting approach; **the cache key is `customer_id` (the phone-number-keyed customer record), not `order_id`**; `order_id` records provenance only; a new row is inserted only on an explicit fresh check; this works identically for guest orders; the `customer_risk_checks` table and its columns.
- `09-fraud-risk-check.md` §7.7 — the Customer Risk section layout and the five risk-level labels: `LOW RISK`, `MEDIUM RISK`, `HIGH RISK`, `UNKNOWN`, `CHECK FAILED`.
- `09-fraud-risk-check.md` §7.8 — error handling: an unavailable or timed-out API does not block or cancel the order and shows "Risk check unavailable — please try again"; no history for the phone shows "No courier history found" and **must not auto-classify the customer as high-risk**; the raw response is not exposed to the frontend beyond §7.5's displayable fields.
- `09-fraud-risk-check.md` §7.9 — credentials in env only; never send passwords, OTPs, tokens, or unrelated customer information to the provider; phone numbers validated and normalized to the format the API expects; only authorized Admin/Manager users may trigger or view, enforced on the backend; risk-check actions are logged/audited.
- `09-fraud-risk-check.md` §7.10 — Admin and Manager may both perform and view, via the existing `Customer Risk Check` permission row (§5.18), introducing no separate authorization system.
- `09-fraud-risk-check.md` §7.11 — the check sits between order confirmation and courier selection, changes no status model, and does not automatically create a shipment.
- `06-rbac.md` §5.18 — `Customer Risk Check` is `Yes` for both Admin and Manager.
- `11-security-hardening.md` §11.3 (risk-check trigger limiter), §11.6 (validation).
- Skills: `backend` §7, `security` §9, `test` §4, `database` §4, `design`.

## Depends on

- **01** — API conventions, errors, validation.
- **02** — `customers` (phone-keyed), `audit_logs`, `withTransaction`.
- **03** — `requireAuth('admin')`, `requirePermission`.
- **04** — `riskCheck` limiter, `safeFetch`.
- **11** — `orders`.
- **13** — the admin order detail page and its Customer Risk slot.
- **14** — nothing is called; this slice precedes shipment creation in the workflow but is not coupled to it.

## Scope

**In scope**

- `customer_risk_checks` table, exactly per §7.6.
- `customerRiskService` — a dedicated module under `services/fraud/`, separate from `services/courier/`.
- A provider adapter for the configured risk provider, written against its current official documentation.
- `GET` cached result and `POST` fresh check endpoints, both permission- and status-gated.
- The Customer Risk section on the admin order detail page.

**Out of scope / deferred**

- Any automatic or scheduled checking — §7.2 forbids it outright.
- Any automatic blocking, holding, or cancelling of an order based on a result — §7.8 and §7.11 both rule it out; the decision is human.
- Risk data in any customer-facing response — §2.9.6 and §4.16 forbid it, and specs 07, 09, and 15 already exclude it from their projections.
- Risk-based analytics or reporting — no PRD defines any.

## Database changes

Migration file: `backend/migrations/0016_customer_risk_checks.sql`

### `customer_risk_checks` (§7.6)

The column list is §7.6's, with types and nullability added, using `snake_case` per that section's own note and the `database` skill §1.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `customer_id` | `uuid` | NOT NULL | — | FK → `customers(id)` ON DELETE CASCADE — **the cache key** (§7.6) |
| `order_id` | `uuid` | NULL | — | FK → `orders(id)` ON DELETE SET NULL — **provenance only**, never a cache partition (§7.6) |
| `phone_number` | `text` | NOT NULL | — | Normalized at check time |
| `provider` | `text` | NOT NULL | — | e.g. `BD_COURIER` |
| `risk_score` | `numeric(6,2)` | NULL | — | Only if the provider returns one (§7.5) |
| `risk_level` | `risk_level` | NOT NULL | — | See enum below |
| `total_orders` | `integer` | NULL | — | Only if returned |
| `successful_orders` | `integer` | NULL | — | Only if returned |
| `returned_orders` | `integer` | NULL | — | Only if returned |
| `raw_result` | `jsonb` | NULL | — | The provider's raw response, for audit (§7.6) |
| `checked_at` | `timestamptz` | NOT NULL | `now()` | |
| `checked_by` | `uuid` | NULL | — | FK → `users(id)` — the triggering Admin/Manager |

```sql
CREATE TYPE risk_level AS ENUM ('LOW','MEDIUM','HIGH','UNKNOWN','CHECK_FAILED');
```

The five values are §7.7's five labels. `UNKNOWN` is what a "no courier history found" result stores — §7.8 is explicit that absence of history "must not be automatically classified as high-risk," so `UNKNOWN` exists precisely so that case has somewhere honest to land.

- Index `(customer_id, checked_at DESC)` — the lookup for "the most recent row for this customer across all of their orders" (§7.6).
- Every count column is nullable because §7.5 says the displayed fields "depend on what the actual API response provides" and the system "must not invent fields the API does not return." A provider that returns only a risk level stores nulls rather than zeros, which would be a fabricated statistic.

**`raw_result` is never selected by a general-purpose read.** Per §7.6 and the `database` skill §4, the repository exposes two functions — one returning the displayable projection (which does not select `raw_result` at all) and a separate audit-only reader. There is no `SELECT *` path that could carry it into a response by accident.

## Backend work

### Module placement (§7.3)

```text
backend/src/services/
  courier/          (existing shipment integration — spec 14)
  fraud/
    customerRiskService.ts
    providers/
      bdCourierProvider.ts
      types.ts
```

§7.3 specifies this layout and says to follow the codebase's existing services structure if one exists — spec 14 established `services/courier/`, so `services/fraud/` sits alongside it, not inside it. The two never import each other: the risk check is a review step, not part of shipment creation.

### The provider adapter

```ts
export type RiskCheckResult = {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  riskScore: number | null;
  totalOrders: number | null;
  successfulOrders: number | null;
  returnedOrders: number | null;
  raw: unknown;                 // stored, never returned to the frontend
};

export interface RiskCheckProvider {
  readonly key: string;
  check(normalizedPhone: string): Promise<RiskCheckResult>;
}
```

The adapter's endpoint, authentication scheme, request shape, and response parsing come from **the current official BD Courier API documentation at implementation time** (§7.3, and CLAUDE.md §6's identical rule). This spec fixes the contract and the obligations, not the provider's payloads — specifying them here would be the guessing both documents forbid.

Mapping rules the adapter must honour:

- A field the provider does not return maps to `null`, never to `0` or a placeholder (§7.5).
- No history for the phone maps to `riskLevel: 'UNKNOWN'`, never `HIGH` (§7.8).
- A provider risk band maps to `LOW`/`MEDIUM`/`HIGH` only where the documentation defines the band; an unrecognized value maps to `UNKNOWN` and is logged, rather than guessed.
- Delivery success rate is **computed for display** as `successfulOrders / totalOrders` only when both are present; it is not stored, because §7.6's column list does not include it and a derived value would drift from its inputs.

All calls go through `safeFetch` (spec 04) with a bounded timeout, HTTPS only, and the provider host allowlisted from `BD_COURIER_BASE_URL`.

### Routes

| Method | Path | Auth | Permission | Limiter |
| --- | --- | --- | --- | --- |
| `GET` | `/api/admin/orders/:orderNumber/risk-check` | admin | `customer.risk.check` | `authenticatedCeiling` |
| `POST` | `/api/admin/orders/:orderNumber/risk-check` | admin | `customer.risk.check` | `riskCheck` |

`GET` returns the cached result and **never calls the provider** — §7.6: "The external API is not called every time an order page is opened." `POST` is the explicit, Admin/Manager-initiated fresh check §7.2 requires.

Both use the existing `Customer Risk Check` permission row (Yes/Yes per §5.18), introducing no separate authorization system (§7.10).

### Types

```ts
type RiskCheckResponse = {
  available: boolean;
  phoneNumber: string;                 // the customer's own number, shown in the panel (§7.7)
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' | 'CHECK_FAILED';
  riskScore: number | null;
  totalOrders: number | null;
  successfulOrders: number | null;
  returnedOrders: number | null;
  successRatePercent: number | null;   // computed for display only when inputs exist
  checkedAt: string | null;
  checkedByUserIdentifier: string | null;
  canTriggerFreshCheck: boolean;       // false outside CONFIRMED/PROCESSING (§7.2)
  message: string | null;              // e.g. §7.8's messages
};
```

`raw_result` has no representation in this type. §7.6 and §7.8 both require that the raw response not be exposed beyond the displayable fields listed in §7.5, and the response type is where that becomes structural.

### `GET` behaviour (§7.6)

1. Load the order; resolve its `customer_id`.
2. Select the **most recent `customer_risk_checks` row for that customer across all orders** — not scoped to this order. §7.6: "the cache key is `customer_id`… rather than requiring a fresh check per order."
3. None found → `available: false`, `riskLevel: 'UNKNOWN'`, and a prompt to run a check.
4. `canTriggerFreshCheck` is true only when `order_status` is `CONFIRMED` or `PROCESSING` (§7.2).
5. No provider call is made under any circumstance.

Because the cache is phone-keyed and a guest customer reference is a phone-keyed `customers` row (§2.9.4), guest orders work identically with no special handling — §7.6's guest-compatibility note holds by construction, not by a branch.

### `POST` behaviour (§7.2, §7.6, §7.8)

Server-side gate first, then the call:

1. Load the order. **Reject with `409 RISK_CHECK_NOT_ALLOWED` unless `order_status` is `CONFIRMED` or `PROCESSING`** — §7.2 requires this be enforced server-side, "not only hide the control in the UI," and a request against an order in `PENDING_CONFIRMATION`, `COD_VERIFICATION_PENDING`, `CANCELLED`, `DELIVERED`, or `RETURNED` must be rejected.
2. Apply `rateLimit('riskCheck')`, keyed per **customer** (§7.6: "applied here to limit how often a fresh check can be triggered for the same customer") and per actor, using the §2.5 approach.
3. Normalize and validate the phone to the format the provider expects (§7.9). An invalid number fails before any outbound call.
4. Call the provider through `safeFetch`.
5. **Success** → insert a new `customer_risk_checks` row with the mapped fields, `raw_result`, `order_id` as provenance, and `checked_by`. §7.6: a new row is inserted only on an explicit fresh check.
6. **Failure or timeout** → insert a row with `risk_level: 'CHECK_FAILED'` and the error in `raw_result`, and return `message: "Risk check unavailable — please try again."` **The order is not blocked, held, or cancelled** (§7.8). Recording the failure keeps the audit trail honest about what was attempted; the panel shows the failure rather than a stale success.
7. **No history** → `risk_level: 'UNKNOWN'` with `message: "No courier history found."` — never `HIGH` (§7.8).
8. Append an `audit_logs` row recording who ran the check, when, and for which order and customer (§7.9, §5.15 rule 10).

Only ever sent to the provider: the normalized phone number. Never a password, OTP, session token, address, email, order contents, or any other customer information (§7.9).

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Order not in `CONFIRMED`/`PROCESSING` | 409 | `RISK_CHECK_NOT_ALLOWED` |
| Missing `customer.risk.check` | 403 | `FORBIDDEN` |
| Rate limited | 429 | `RATE_LIMITED` |
| Invalid phone on the customer record | 422 | `INVALID_PHONE_NUMBER` |
| Provider unavailable/timeout | 200 | `{ riskLevel: 'CHECK_FAILED', message: … }` — not an HTTP error, because §7.8 requires graceful degradation rather than a failed operation |
| Provider not configured | 503 | `RISK_PROVIDER_UNCONFIGURED` |

## Frontend work

The **Customer Risk** section on `/admin/orders/[orderNumber]` (spec 13's slot), rendered per §7.7:

```text
Customer Risk

Phone: 01XXXXXXXXX

Total Orders: 25
Delivered: 22
Returned: 3
Success Rate: 88%

Risk Score: 88
Risk Level: LOW

Last Checked: 20 Sep 2026
```

- The section loads from the `GET` endpoint on page open. It **never triggers the provider** — §7.2 and §7.6 both require the external call to be explicit.
- A **Check Customer Risk** button issues the `POST`. It is disabled with an explanatory tooltip when the order is outside `CONFIRMED`/`PROCESSING` (`canTriggerFreshCheck: false`) — and the backend rejects the request regardless, per §7.2.
- **Risk level indicator** uses the five §7.7 labels with the documented palette: `LOW RISK` in `#059669`, `MEDIUM RISK` in `#F59E0B`, `HIGH RISK` in `#DC2626`, `UNKNOWN` and `CHECK FAILED` in `#6B7280`. Colour is never the only signal — the label text is always present (`design`: accessibility, "All badges and status indicators must be readable").
- **Fields the provider did not return are omitted**, not rendered as "0" or "—" (§7.5's "must not invent fields the API does not return"). Success Rate appears only when both inputs exist.
- **No history**: "No courier history found." with no risk styling implying danger (§7.8).
- **Failure**: "Risk check unavailable — please try again," with a retry action and the order unaffected (§7.8).
- Dates render as `DD MMM YYYY` per the `design` skill.
- **Wording discipline (§7.1)**: the UI never uses "fraud," "fraudster," "criminal," or "blacklist." The section is labelled "Customer Risk," values are described as delivery-history indicators, and nothing states or implies proven wrongdoing.
- The section is visible only to users holding `customer.risk.check`, and still renders a backend 403 gracefully (`frontend` §3).
- Mobile-first: the card stacks at 375px, the button is 44px full-width.

## Security requirements

- **Backend-only provider calls** (§7.3) — no risk-check request originates in the browser, and the provider host never appears in the client bundle or CSP `connect-src`.
- **Credentials in env only** (§7.4, §7.9) — `BD_COURIER_API_KEY`, `BD_COURIER_BASE_URL` (or whatever the current documentation requires); never hard-coded, never in a response, never logged, never in `NEXT_PUBLIC_*`.
- **Server-side status gate** (§7.2) — the `CONFIRMED`/`PROCESSING` restriction is enforced on the endpoint, not just by hiding the button.
- **RBAC** (§7.9, §7.10, §5.18) — both endpoints check `customer.risk.check`; no separate authorization system is introduced.
- **Minimal outbound data** (§7.9) — only the normalized phone number leaves the platform.
- **`raw_result` never reaches the frontend** (§7.6, §7.8) — the response type has no field for it and the display projection does not select the column.
- **Risk data never reaches a customer** — §2.9.6 and §4.16 forbid it in guest lookup and Track Order; specs 07, 09, and 15 already exclude it. No customer-facing projection in the system contains a risk field.
- **Rate limiting** (§7.6, §11.3) — fresh checks limited per customer using the §2.5 approach, bounding both cost and the provider's exposure to the platform.
- **SSRF-guarded outbound calls** through `safeFetch` (`security` §6).
- **Audit** (§7.9) — who ran a check, when, for which order and customer.
- **No automated adverse action** (§7.8, §7.11) — a result never blocks, holds, cancels, or flags an order automatically; every consequence is a human decision.

## Data integrity / idempotency

- **Append-only history.** Each fresh check inserts a row; nothing is updated in place, so the sequence of checks over time is reconstructable.
- **Cache is customer-keyed, not order-keyed** (§7.6) — one check serves every order for that customer, and `order_id` records only which order's review prompted it. A second order for the same customer therefore shows the existing result without a provider call.
- **Repeat safety.** A double-clicked Check button produces at most one provider call per rate-limit window; a second row within the window is prevented by the limiter rather than by a uniqueness constraint, since two genuine checks minutes apart are legitimate data.
- **Failures are recorded, not silently swallowed** — a `CHECK_FAILED` row means the panel shows the failure rather than a stale success presented as current.
- **No fabricated values** — absent provider fields stay `NULL` through storage and display (§7.5).
- **No coupling to order state** — a risk check writes no order, payment, or shipment status (§7.11), so it cannot interfere with spec 12's state machine.

## Acceptance criteria

1. Opening an order detail page issues **zero** provider calls, regardless of whether a cached result exists (§7.2, §7.6).
2. `POST .../risk-check` on a `CONFIRMED` order calls the provider once, stores a row, and returns the mapped fields.
3. `POST` on an order in `PENDING_CONFIRMATION`, `COD_VERIFICATION_PENDING`, `CANCELLED`, `DELIVERED`, or `RETURNED` returns `409 RISK_CHECK_NOT_ALLOWED` and calls no provider — verified by calling the API directly with the UI bypassed (§7.2).
4. `POST` on a `PROCESSING` order succeeds (§7.2's range is `CONFIRMED` through `PROCESSING`).
5. A second order for the **same customer** shows the existing result on `GET` with no provider call (§7.6's customer-keyed cache).
6. A guest order's risk check behaves identically to a registered customer's, with no code branch on `account_type` (§7.6).
7. Exceeding the fresh-check limit for one customer returns `429`; a different customer is unaffected (§7.6, §11.3).
8. A provider timeout stores `CHECK_FAILED`, returns "Risk check unavailable — please try again," and leaves `order_status`, `payment_status`, and `shipment_status` **unchanged** (§7.8).
9. A "no history" response stores `UNKNOWN` and displays "No courier history found." — **not** `HIGH` (§7.8).
10. A provider response omitting `total_orders` stores `NULL`, and the UI omits the field rather than showing `0` (§7.5).
11. No API response in this slice contains `raw_result` or any provider-specific key (asserted against the serialized payload) (§7.6, §7.8).
12. A user without `customer.risk.check` gets 403 on both endpoints (§7.10).
13. `grep -ri "BD_COURIER" frontend/` returns nothing; no response or log line contains the API key (§7.4).
14. The only outbound payload field is the normalized phone number — asserted against the captured request (§7.9).
15. Every check appends an `audit_logs` row with actor, order, and customer (§7.9).
16. The Customer Risk panel contains none of the words "fraud," "fraudster," "criminal," or "blacklist" (§7.1).
17. Risk fields appear in no customer-facing response — asserted against the guest lookup, Track Order, and customer order detail payloads (§2.9.6, §4.16).
18. The risk check creates no shipment and changes no status (§7.11).
19. At 375px the panel stacks cleanly with a 44px full-width action button.

## Tests required

Per the `test` skill §4, which names risk-check caching and failure handling as required coverage.

1. **Caching is real** (§7.6) — opening the order page and calling `GET` repeatedly produces zero provider calls; a `POST` produces exactly one. The `test` skill's named case.
2. **Cache key is `customer_id`, not `order_id`** (§7.6) — a check run against order A is returned for order B of the same customer, with no second provider call. This is the rule most likely to be implemented wrongly as a per-order cache.
3. **Server-side status gate** (§7.2) — one test per disallowed status, calling the API directly with the UI bypassed; and one per allowed status. The PRD explicitly requires backend enforcement, so a UI-only test would not satisfy it.
4. **Failure degrades gracefully** (§7.8) — a timeout and a 500 each store `CHECK_FAILED`, return the documented message, and leave all three order statuses untouched. Order processing must not crash or block.
5. **No history is not high risk** (§7.8) — an empty-history response stores `UNKNOWN`.
6. **Absent fields stay null** (§7.5) — a partial provider response produces nulls, not zeros, and the display omits them.
7. **Unrecognized risk band maps to `UNKNOWN`** and is logged, not guessed.
8. **`raw_result` never escapes** (§7.6, §7.8) — a key-set assertion on the response, so a future field addition fails the test rather than leaking.
9. **Outbound payload minimality** (§7.9) — only the normalized phone is sent; no password, OTP, token, address, email, or order content appears in the captured request.
10. **Phone normalization** (§7.9) — variants resolve to the provider's expected format before the call.
11. **Rate limiting** (§7.6, §11.3) — under the limit succeeds, over it returns 429, and the limit is per customer (the `test` skill §4 pair).
12. **Permission enforced** (§5.18, §7.10) — 403 without `customer.risk.check` on both endpoints.
13. **Guest parity** (§7.6) — identical behaviour for a guest customer reference.
14. **Audit written** (§7.9) — actor, order, customer, timestamp.
15. **No status side effects** (§7.11) — before/after snapshots of all three statuses are identical.
16. **Risk data absent from customer-facing payloads** (§2.9.6, §4.16) — asserted against every public projection, as a regression guard on the most consequential leak in this slice.

## Open questions / assumptions

1. **Provider API specifics.** §7.3 states the endpoint, authentication method, request format, and response schema "must be taken from the current official BD Courier API documentation at implementation time — they must not be guessed or assumed from this document," and CLAUDE.md §6 repeats the rule. *Assumption:* the implementing session fetches the current documentation at `https://bdcourier.com/api-docs#endpoints` and writes `bdCourierProvider.ts` against it. **This spec deliberately specifies no provider payload.**
2. **Risk-level derivation.** §7.5 lists "Risk score" and "Risk level/status" as fields the API may return, while §7.7 shows five display labels. *Assumption:* if the provider returns a level, map it directly; if it returns only a score, map it to LOW/MEDIUM/HIGH using **documented** provider thresholds, and fall back to `UNKNOWN` if the documentation defines none. **Flagged:** inventing thresholds would be inventing a risk classification the provider did not make, which the "risk indicator, not proof" framing argues against.
3. **Fresh-check rate limit thresholds.** §7.6 points at §2.5's approach without giving numbers. *Assumption:* 3 fresh checks per customer per 15 minutes, matching §2.5's OTP-request figures, env-configurable.
4. **Cache staleness.** §7.6 describes reuse without a TTL, saying only that a fresh check is manually triggerable. The `backend` and `security` skills both refer to "the documented TTL," but §7.6 documents none. *Assumption:* no automatic expiry — the cached row is shown indefinitely with its `checked_at` date, and the Admin/Manager decides whether it is stale enough to refresh. The panel displays "Last Checked" prominently (§7.7) precisely so that judgement is possible. **Flagged as a skill-vs-PRD wording mismatch**; adding an automatic TTL-driven refresh would contradict the "never run automatically" wording of §7.2.
5. **Multiple providers.** §7.4 hedges with "or whatever variable names and authentication scheme the current API documentation actually requires," and §7.6 stores a `provider` column. *Assumption:* one configured provider in v1, behind the `RiskCheckProvider` interface so a second can be added without touching the service or the panel.
6. **Where the check sits relative to shipment creation.** §7.11 places it between confirmation and courier selection, but §7.2's workflow ends with "Admin/Manager reviews and decides whether to proceed." *Assumption:* the check is **advisory and not mandatory** — shipment creation (spec 14) does not require a prior risk check, because no PRD says it does and §7.11 explicitly states the check "does not automatically create a shipment" and introduces no new order status (making it a hard prerequisite would add a gate the requirements never specify).
