# 04 — Rate Limiting, Abuse Protection, and Cross-Cutting Security Hardening

## Goal

After this slice the backend has one configurable rate-limiting mechanism, keyed per endpoint by account/identifier plus source IP, returning `429` with `Retry-After` and a message that never reveals whether an identifier exists; every rejection is logged for review. The named limiters required by the §11.3 matrix exist and are mounted where their endpoints already exist (admin login, admin refresh, plus the general authenticated and public ceilings); limiters for endpoints not yet built are defined here by name so later specs mount them instead of inventing their own. This slice also completes the transport/header/validation hardening baseline so no later spec has to re-derive it.

## Requirement references

- `11-security-hardening.md` §11.2 — server-side in Express only; a store that works across multiple backend instances; keyed by account/customer identifier **plus** source IP, not IP alone; `429` + `Retry-After`; response body must not leak whether the identifier exists; all rejections logged with identifier, IP, endpoint, timestamp.
- `11-security-hardening.md` §11.3 — the endpoint rate-limit matrix (login; OTP request; OTP verify; guest order lookup; public Track Order; risk-check trigger; coupon apply; registration; admin/manager login; general authenticated per-account ceiling ~100 req/min; general public per-IP ceiling ~60 req/min), all env-configurable.
- `11-security-hardening.md` §11.4 — request body size limits; timeouts; no synchronous heavy work in the request path; **pagination mandatory on every list endpoint**; CDN/WAF at the edge (deployment, not application code).
- `11-security-hardening.md` §11.5 — HTTPS/HSTS, `helmet` headers, CORS allowlist, cookie flags and CSRF.
- `11-security-hardening.md` §11.6 — explicit input schema on every endpoint; parameterized DB access; upload content-type validation; output escaping/sanitization on both layers.
- `11-security-hardening.md` §11.9 — `npm audit`/dependency updates; secrets only in env; centralized logging of auth failures, rate-limit rejections, and 4xx/5xx spikes with alerting; regular backups with a tested restore before launch.
- `02-customer.md` §2.5 — the reference thresholds this file's matrix points at: OTP expires in 10 minutes, single-use, max 3 OTP requests per account per 15 minutes, max 5 incorrect attempts per issued OTP; §2.4 reuses this approach for login; these are configurable business parameters.
- `02-customer.md` §2.9.7 — guest order lookup rate-limited per Order Number and per source IP with temporary lockout.
- `04-courier-shipment.md` §4.16 — Track Order is separately, independently rate-limited from guest order lookup.
- `09-fraud-risk-check.md` §7.6 — fresh risk checks limited using the same OTP-style approach, keyed per customer.
- `10-coupon-discount.md` §8.28 — `POST /api/coupons/validate` rate-limited per source IP and, where available, per customer, to block coupon-code brute-forcing.
- `06-rbac.md` §5.15 rule 10 — rate-limit rejections logged consistently with the audit-logging approach.
- Skills: `security` §9 (rate limiting & abuse resistance), §6 (input validation & injection), §10 (headers/CORS/cookies); `backend` §9; `database` §6 (pagination).

## Depends on

- **01** — Express app with the reserved rate-limiter mount point, error taxonomy (`RateLimitError` → 429 `RATE_LIMITED`), `validate()` middleware, pagination helper, logger, env loader, `helmet`/CORS/body-limit baseline.
- **02** — `audit_logs` for security-event logging; `normalizeBdPhone` for identifier keying.
- **03** — admin login/refresh routes to mount the first named limiters on; `requireAuth` supplying `req.actor.userId` for per-account keying.

## Scope

**In scope**

- A single rate-limiting module exposing named, env-configurable limiters and one `rateLimit(name)` middleware factory.
- Key-derivation helper producing the documented composite keys (identifier + IP) per limiter.
- `429` responses with `Retry-After`, a generic body, and structured rejection logging.
- Mounting the limiters that have endpoints today: admin login, admin refresh, the general authenticated ceiling, the general public ceiling.
- Defining — by name, key, and default threshold — the limiters for endpoints built later, so specs 08, 10, 11, 13, 15, and 16 mount an existing limiter rather than authoring one.
- A `security` middleware audit: confirming and completing helmet/CSP, HSTS, HTTPS redirect, CORS allowlist, cookie flags, body limits, and request timeouts.
- A reusable upload-validation helper (content-sniffed MIME + size + extension allowlist) that specs 06 and 11 use.
- A reusable HTML/rich-text sanitizer used by specs 05, 13, and 17.
- An SSRF-safe outbound fetch wrapper used by every external-provider call in specs 14, 16, and 18.
- Security logging + a `security_events` view over `audit_logs` for the operational alerting §11.9 requires.
- Dependency hygiene: `npm audit` in CI, lockfile committed.

**Out of scope / deferred**

- The endpoints being limited that do not exist yet — each is mounted by its own spec.
- CDN/WAF, reverse-proxy timeouts, TLS termination, backups and restore rehearsal — §11.4 and §11.9 explicitly classify these as infrastructure/deployment requirements, not application code. They are listed here as a deployment checklist item, not implemented.
- Queueing of heavy work (§11.4) — no endpoint in the planned build does synchronous heavy work; the rule is recorded as a constraint later specs must respect, not a component built here.

## Database changes

Migration file: `backend/migrations/0004_security_events.sql`

No new table for rate-limit counters — those live in the limiter store (see Open questions 1). One read-only view for operations:

```sql
CREATE VIEW security_events AS
SELECT id, action, entity_type, entity_id, actor_user_id, actor_type, new_value, request_id, created_at
FROM audit_logs
WHERE action IN ('auth_failure', 'rate_limit_rejected', 'csrf_failure', 'permission_denied');
```

This gives §11.9's "centralized logging captures authentication failures, rate-limit rejections, and 4xx/5xx spikes" a queryable surface without a second logging store. The underlying rows are appended through spec 02's append-only audit repository.

## Backend work

### Rate-limit module (`src/middleware/rateLimit.ts`, `src/config/rateLimits.ts`)

One registry maps a limiter name to its key strategy, window, and maximum. Every value is read from env with the documented default, per §11.3's "configurable business/operational parameters (env-driven), not fixed architecture."

| Limiter name | Applies to | Key | Default | Env | PRD |
| --- | --- | --- | --- | --- | --- |
| `customerLogin` | `POST /api/auth/login` (spec 08) | phone + IP | 5 / 15 min, exponential backoff after repeated failures | `RL_CUSTOMER_LOGIN_*` | §2.4/2.5, §11.3 |
| `adminLogin` | `POST /api/admin/auth/login` (spec 03) | userIdentifier + IP | 5 / 15 min, same mechanism, **no back-office exemption** | `RL_ADMIN_LOGIN_*` | §11.3 |
| `otpRequest` | `POST /api/auth/forgot-password` (spec 08) | account + IP | **3 / 15 min** | `RL_OTP_REQUEST_*` | §2.5 (explicit) |
| `otpVerify` | `POST /api/auth/verify-otp` (spec 08) | issued OTP id + IP | **5 incorrect attempts per issued OTP**, then the OTP is invalidated | `RL_OTP_VERIFY_*` | §2.5 (explicit) |
| `registration` | `POST /api/auth/register` (spec 08) | IP | 5 / hour | `RL_REGISTRATION_*` | §11.3 (new in that file) |
| `guestOrderLookup` | `POST /api/orders/lookup` (spec 15) | order number + IP, temporary lockout | 5 / 15 min, 30 min lockout | `RL_GUEST_LOOKUP_*` | §2.9.7 |
| `trackOrder` | `POST /api/track-order` (spec 15) | tracking identifier + IP | 10 / 15 min — **a separate limiter instance** from `guestOrderLookup` | `RL_TRACK_ORDER_*` | §4.16 (explicitly separate) |
| `couponValidate` | `POST /api/coupons/validate` (spec 10) | customer-or-session + IP | 10 / 10 min | `RL_COUPON_VALIDATE_*` | §8.28 |
| `riskCheck` | `POST /api/admin/orders/:id/risk-check` (spec 16) | customer id + actor | 3 / 15 min | `RL_RISK_CHECK_*` | §7.6 |
| `authenticatedCeiling` | every authenticated route | `actor.userId` | **100 req/min** | `RL_AUTH_CEILING_*` | §11.3 |
| `publicCeiling` | every public route | IP | **60 req/min** | `RL_PUBLIC_CEILING_*` | §11.3 |

The three bolded values (3 per 15 min, 5 attempts, 100/min, 60/min) are the ones the PRDs state numerically; the rest are defaults chosen to match the stated *approach*, and §11.1 makes the feature file authoritative for its own thresholds — so when spec 08 or 15 mounts a limiter, it uses the value its own PRD section gives.

**Key derivation.** §11.2 requires "account/customer identifier + source IP, not IP alone, so a single attacker can't rotate IPs to bypass a per-account limit, and a shared IP doesn't lock out unrelated legitimate customers." Each composite limiter therefore maintains **two** counters and rejects if *either* is exceeded: one keyed on the identifier alone (survives IP rotation) and one on the IP alone (bounds a single source). A limiter keyed only on IP (`registration`, `publicCeiling`) has one counter.

Identifiers are normalized before keying — phone via `normalizeBdPhone`, user identifier lower-cased, order number upper-cased — so casing or formatting variants cannot multiply an attacker's budget.

**Source IP** is taken from the first entry of `X-Forwarded-For` only when `TRUST_PROXY_HOPS` is configured, since the production deployment sits behind a CDN/WAF (§11.4). With no proxy configured, the socket address is used. A spoofable client header is never trusted as the key.

**Response.** On rejection:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 900
```
```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Please try again later." }, "requestId": "…" }
```

The same body is returned regardless of whether the account, order number, or identifier exists (§11.2). No remaining-attempt count, no window detail, and no identifier echo appears in the body.

**Logging.** Every rejection appends an `audit_logs` row with `action = 'rate_limit_rejected'`, `actor_type = 'SYSTEM'`, and `new_value = { limiter, identifierHash, ip, endpoint }`. The identifier is stored **hashed**, not in plaintext — §11.2 requires the rejection be logged for review, while `database` skill §4 forbids duplicating PII into logs; hashing satisfies both, since operations can still group repeated attempts on one identifier.

### Hardening middleware completion

- **HTTPS/HSTS (§11.5).** In production, a redirect middleware ahead of everything sends `http` → `https`, and `helmet.hsts` sets a one-year max-age with `includeSubDomains`. Disabled in development.
- **CSP (§11.5).** An explicit policy rather than helmet's default: `default-src 'self'`; `img-src 'self' data: <SUPABASE_STORAGE_HOST>`; `connect-src 'self' <API_ORIGIN>`; `script-src 'self' https://connect.facebook.net` (Meta Pixel, spec 18); `frame-ancestors 'none'`; `object-src 'none'`. Any later spec needing a new origin edits this one policy.
- **Request timeout (§11.4).** `REQUEST_TIMEOUT_MS` (default 30 s) aborts a request that exceeds it with 503 rather than holding the connection. The reverse-proxy-level timeout remains a deployment requirement.
- **Body limits (§11.4).** Global `100kb` stays; `createUploadLimit(maxBytes)` produces the separately-bounded parser used only by upload routes in specs 06 and 11.

### Reusable security helpers

**`lib/uploadValidation.ts`** (§11.6, used by specs 06 and 11):

```ts
validateUpload(file: Buffer, opts: {
  allowedMimeTypes: string[];   // e.g. ['image/jpeg','image/png','image/webp']
  maxBytes: number;
}): { mimeType: string; extension: string };
```
Sniffs the actual content (magic bytes) and rejects when it disagrees with the declared `Content-Type` or the extension — §11.6 requires validation "by actual content/MIME type (not just file extension)." SVG and HTML are never in an allowlist, since `security` skill §6 flags uploaded SVG/HTML as a stored-XSS vector. Filenames are replaced with a generated UUID before storage; the caller's filename is never used as a storage path.

**`lib/sanitizeHtml.ts`** (§11.6, used by specs 05, 13, 17): sanitizes rich text server-side **before storage** on a strict allowlist of tags and attributes, stripping `script`, `style`, event handlers, and `javascript:` URLs. §11.6 requires both layers treat input as untrusted, so the frontend also escapes at render — neither layer assumes the other did it.

**`lib/safeFetch.ts`** (`security` skill §6 SSRF, used by specs 14, 16, 18): wraps outbound HTTP to external providers. Only `https:`; only hosts on a configured allowlist built from the providers' base-URL env vars; resolved addresses rejected if private/loopback/link-local; fixed connect and total timeouts; a bounded response size; no redirect following to an off-allowlist host. Provider credentials are attached by the caller and are never logged by the wrapper.

**`lib/urlValidation.ts`** (§13.13, used by spec 17): validates a `cta_url` as either a relative storefront path or an `https:` URL on an allowed host.

### Mounting in this slice

```text
requestId → httpsRedirect → helmet(+CSP,HSTS) → cors → timeout
  → express.json({limit:'100kb'}) → requestLogger
  → publicCeiling (all routes)
  → routes:
       POST /api/admin/auth/login    + rateLimit('adminLogin')
       POST /api/admin/auth/refresh  + rateLimit('authenticatedCeiling')
       every requireAuth route       + rateLimit('authenticatedCeiling')
  → notFound → errorHandler
```

`publicCeiling` runs before routing so it also bounds unmatched paths — §11.4's "baseline DoS backstop."

### Pagination audit (§11.4)

A test asserts that every registered route whose response is an array uses `ApiListSuccess` and the shared pagination schema. §11.4 states pagination is mandatory on *every* list endpoint (products, orders, customers, coupons); this check is added now so a later spec cannot ship an unbounded list.

### Dependency hygiene (§11.9)

- Lockfiles committed; `npm audit --audit-level=high` runs in CI and fails the build on a high/critical advisory.
- A documented Dependabot (or equivalent) configuration for both workspaces.

## Frontend work

Minimal, and only what the backend behaviour forces:

- The `apiClient` (spec 01) recognizes `429` / `RATE_LIMITED` and surfaces a single English message — "Too many attempts. Please wait a few minutes and try again." — using `Retry-After` for a countdown where a form is involved. It never displays a raw backend error (`frontend` skill §10).
- Forms whose endpoints are rate-limited (admin login now; customer login, OTP, order lookup, Track Order, coupon apply later) disable their submit button while a `Retry-After` countdown is active, so the UI does not encourage hammering a locked endpoint. This is UX only — the backend limiter is the control.
- No frontend rate limiting is implemented; §11.2 is explicit that limiting is "never in the Next.js frontend or relied upon as client-side validation only."

## Security requirements

This slice *is* the cross-cutting security slice; the requirements it enforces are listed above. The points that later specs must not undo:

- Rate limiting lives in Express only, never in Next.js, and never as client-side validation (§11.2).
- The limiter store must be shared across instances if the deployment is multi-instance; an in-memory store is acceptable **only** for a confirmed single-instance deployment and must not silently under-protect a scaled-out one (§11.2). The store is selected by env (`RATE_LIMIT_STORE=memory|redis`) and the app logs a startup warning when `memory` is used with `NODE_ENV=production`.
- Limits are composite (identifier + IP), never IP alone, for account-scoped flows (§11.2).
- A `429` body never differentiates an existing from a non-existent identifier (§11.2) — this is the same non-enumeration rule §2.9.7, §4.16, and §8.22 apply to their own responses.
- CORS stays an explicit allowlist; no wildcard on any authenticated endpoint (§11.5).
- Upload validation is content-based, never extension-based (§11.6).
- Rich text is sanitized server-side before storage, not only escaped at render (§11.6).
- Outbound provider calls go through `safeFetch`; no handler fetches a caller-supplied URL directly (`security` skill §6).
- No endpoint returns an unbounded list (§11.4).

## Data integrity / idempotency

Rate limiting does not write business data, but two properties matter downstream:

- A `429` is returned **before** the route handler runs, so a rejected request performs no partial write — an attacker cannot use limiter rejection to leave half-applied state.
- Limiter counters are advisory and independent of business idempotency: specs 11 (order idempotency key) and 14 (the `CREATING` shipment lock) must not rely on rate limiting to prevent duplicates. Rate limiting bounds volume; idempotency keys and state locks prevent duplication. Both are required.

## Acceptance criteria

1. Six failed `POST /api/admin/auth/login` attempts for the same `userIdentifier` return `429` on the sixth with a `Retry-After` header.
2. The `429` body is byte-identical whether the `userIdentifier` exists or not.
3. After exhausting the per-identifier budget, the same identifier from a **different** IP is still rejected (identifier counter survives IP rotation).
4. After exhausting the per-IP budget with several identifiers, a fresh identifier from that IP is rejected, while the same fresh identifier from a different IP succeeds (§11.2's shared-IP and rotation cases both hold).
5. Each `429` appends one `audit_logs` row with `action = 'rate_limit_rejected'`, and `SELECT * FROM security_events` returns it. The stored identifier is a hash, not the raw phone/user ID.
6. Exceeding 60 requests/minute from one IP to a public route returns `429`, including on a path that matches no route.
7. Exceeding 100 requests/minute as one authenticated user returns `429`.
8. Booting with `RATE_LIMIT_STORE=memory` and `NODE_ENV=production` logs an explicit warning naming the multi-instance risk.
9. Every threshold above changes behaviour when its env var changes, with no code edit.
10. A production-mode `http` request is redirected to `https`; responses carry `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy`.
11. `validateUpload` rejects a `.png`-named file whose bytes are a PHP script, rejects an SVG, and accepts a real JPEG under the size cap.
12. `sanitizeHtml('<p onclick="x()">hi</p><script>y()</script>')` returns `<p>hi</p>`.
13. `safeFetch('http://169.254.169.254/…')` is rejected; `safeFetch` against a non-allowlisted host is rejected; an allowlisted `https` host succeeds.
14. A request held open past `REQUEST_TIMEOUT_MS` is terminated with `503` and the connection is released.
15. The route-registry test passes: every array-returning route uses the shared pagination schema.
16. `npm audit --audit-level=high` passes in CI.
17. A rate-limited login attempt performs no database write other than the rejection audit row — the failed-attempt path never reaches the user repository.

## Tests required

Per the `test` skill §4 ("for each endpoint in the 11.3 matrix, a test that exceeds the documented limit and asserts a 429, and a test just under the limit that succeeds"). Tests use a test-only lowered threshold rather than real-time waits.

1. **Under-limit succeeds / over-limit 429** for each limiter that has an endpoint in this slice (`adminLogin`, `authenticatedCeiling`, `publicCeiling`). Each later spec adds the same pair for the limiter it mounts.
2. **Composite keying** (§11.2) — identifier budget survives IP rotation; IP budget bounds an attacker cycling identifiers; a legitimate second user behind the same NAT IP is not locked out by another user's per-account exhaustion.
3. **Non-enumeration on 429** (§11.2) — identical body for existing vs. non-existent identifier. This is the rule most likely to regress when someone adds a "helpful" error message.
4. **`Retry-After` present and consistent** with the configured window.
5. **Rejection logging** (§11.2, §5.15 rule 10) — the audit row exists, contains limiter/endpoint/IP, and stores the identifier hashed rather than in plaintext.
6. **Env-configurability** (§11.3) — changing the env value changes the enforced threshold with no code change.
7. **Track Order and guest lookup are independent limiters** (§4.16) — exhausting one does not affect the other. Asserted at the registry level now, and again functionally in spec 15.
8. **No partial write on rejection** — a `429`ed request leaves no business-table row.
9. **Upload validation** (§11.6) — content/extension mismatch rejected; SVG rejected; oversize rejected; valid image accepted.
10. **HTML sanitization** (§11.6) — script tags, event handlers, and `javascript:` URLs stripped before storage.
11. **SSRF guard** — private/loopback/link-local targets and non-allowlisted hosts rejected; redirect to an off-allowlist host not followed.
12. **Security headers** (§11.5) — CSP, HSTS, nosniff, Referrer-Policy present; CORS rejects a non-allowlisted origin.
13. **Pagination registry** (§11.4) — the assertion that no route returns an unbounded array.

## Open questions / assumptions

1. **Limiter store.** §11.2 names Redis via `rate-limiter-flexible` as an example and permits an in-memory store only for a confirmed single-instance deployment. No PRD states the deployment topology. *Assumption:* implement against `rate-limiter-flexible` with a store selected by `RATE_LIMIT_STORE`, defaulting to `memory` in development and **requiring** an explicit setting in production with a startup warning when `memory` is chosen there. **Flagged:** if the deployment is multi-instance, Redis is mandatory and becomes an infrastructure dependency — it is a limiter store, not a second database, so it does not violate the fixed-stack rule, but the client must confirm it is available.
2. **Undefined thresholds.** §11.3 gives exact numbers only for OTP (3 per 15 min), OTP verify (5 attempts), and the general ceilings (100/min, 60/min). Login, guest lookup, Track Order, coupon validate, registration, and risk check are described by approach only. *Assumption:* the defaults tabulated above, all env-overridable per §11.3's "configurable… may be tuned after launch."
3. **"Exponential backoff after repeated failures"** (§11.3, login row) is named but not parameterized. *Assumption:* after the window limit is hit, the lockout doubles per consecutive exhausted window up to a configured maximum (default 60 min), reset on a successful login. The mechanism is env-configurable.
4. **Trusted-proxy configuration.** §11.4 places a CDN/WAF in front of the origin, which makes the socket IP the CDN's. *Assumption:* `TRUST_PROXY_HOPS` is set to match the actual deployment; a misconfiguration would let a client spoof its key via `X-Forwarded-For`. **Flagged as a deployment-time correctness requirement**, not something application code can verify on its own.
5. **`security_events` as a view.** §11.9 asks for centralized logging with alerting. *Assumption:* structured logs to stdout (consumed by the platform's log aggregator) plus the database view above, with alerting configured at the platform layer. A dedicated log-shipping component would be speculative infrastructure beyond what §11.10 scopes.
6. **Backups and restore rehearsal** (§11.9). Supabase provides managed backups; "restore is tested at least once before launch" is an operational task. *Assumption:* recorded as a pre-launch checklist item in this spec, not implemented as code.
