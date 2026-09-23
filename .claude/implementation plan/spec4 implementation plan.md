# Implementation Plan — Spec 04: Rate Limiting, Abuse Protection, Security Hardening

Source spec: `.claude/implementation specs/04-rate-limiting-and-security-hardening.md`
Related PRD: `.claude/project requirment documents/11-security-hardening.md`
Status: **Planned — not yet implemented**

---

## Confirmed against current repo state

- `backend/src/app.ts` already has the reserved mount point (`// Rate limiters mount point — reserved for spec 04`), helmet/CSP/HSTS/CORS baseline, `trust proxy` set, and `express.json({limit: '100kb'})`.
- `backend/src/lib/errors.ts` already defines `RateLimitError` → 429.
- Migrations go up to `0004_admin_sessions.sql`, so this slice's migration becomes **`0005_security_events.sql`** (the spec doc's own `0004` reference is stale — use the next free number).
- No `rate-limiter-flexible` or similar package installed yet.

---

## 1. Dependencies

Add:
- `rate-limiter-flexible` — store-agnostic limiter engine, covers both memory and Redis backends.
- `ioredis` — only exercised if `RATE_LIMIT_STORE=redis`; otherwise the memory store path is used.
- MIME-sniffing library (e.g. `file-type`) for magic-byte detection in `uploadValidation` — check `package.json` first, may not be present.
- HTML sanitizer (e.g. `sanitize-html`) — check `package.json` first, may not be present.

## 2. Migration

`backend/migrations/0005_security_events.sql` — read-only view over `audit_logs`:

```sql
CREATE VIEW security_events AS
SELECT id, action, entity_type, entity_id, actor_user_id, actor_type, new_value, request_id, created_at
FROM audit_logs
WHERE action IN ('auth_failure', 'rate_limit_rejected', 'csrf_failure', 'permission_denied');
```

## 3. Config

- `backend/src/config/rateLimits.ts` — full named-limiter registry (11 limiters from the spec's §11.3 matrix), env-driven thresholds/defaults, including limiters whose routes don't exist yet (`customerLogin`, `otpRequest`, `otpVerify`, `registration`, `guestOrderLookup`, `trackOrder`, `couponValidate`, `riskCheck` — defined but unmounted, for later specs to consume by name).
- Extend `backend/src/config/env.ts` with the `RL_*` variables and `RATE_LIMIT_STORE`.

## 4. Rate-limit middleware

`backend/src/middleware/rateLimit.ts`:

- `rateLimit(name)` factory producing Express middleware from the registry.
- Composite key derivation (identifier + IP, two independent counters, reject if either trips) vs. single IP-only counters (`registration`, `publicCeiling`).
- Identifier normalization hooks (phone via existing `normalizeBdPhone`, uppercase order numbers, lowercase user identifiers).
- IP extraction respecting `TRUST_PROXY_HOPS` / Express's `trust proxy` setting already configured.
- 429 response: generic body, `Retry-After` header, no identifier/window leakage.
- Rejection logging into `audit_logs` via the existing audit repository, identifier **hashed** (SHA-256 or similar fast deterministic hash — not bcrypt — since this is a grouping key, not a security hash).
- Store selection: `memory` (development default) vs `redis`; production + `memory` logs a startup warning naming the multi-instance risk.

## 5. Mounting in `app.ts`

Replace the reserved comment block with:

- `publicCeiling` globally, before routing (so it also bounds unmatched paths).
- `rateLimit('adminLogin')` on the existing admin login route.
- `rateLimit('authenticatedCeiling')` on `requireAuth`-protected routes.
- `rateLimit('authenticatedCeiling')` on admin refresh.

## 6. Hardening completions

- HTTPS redirect middleware (production-only), ahead of everything else.
- Verify/extend existing helmet CSP against the spec's exact directive list (adds `img-src` Supabase Storage host, `connect-src` API origin, `script-src` Meta Pixel origin — deferred, hosts not known until specs 06/18).
- Request timeout middleware (`REQUEST_TIMEOUT_MS`, default 30s) → 503, connection released.
- `createUploadLimit(maxBytes)` helper for later upload routes (specs 06, 11).

## 7. Reusable security helpers (new files)

- `backend/src/lib/uploadValidation.ts` — `validateUpload()`: magic-byte sniffing, extension/MIME cross-check, SVG/HTML always rejected, UUID filename generation (never the caller's filename).
- `backend/src/lib/sanitizeHtml.ts` — strict allowlist sanitizer, strips `script`, `style`, event handlers, `javascript:` URLs.
- `backend/src/lib/safeFetch.ts` — SSRF-guarded outbound fetch: https-only, host allowlist from provider base-URL env vars, private/loopback/link-local rejection, fixed connect/total timeouts, bounded response size, no redirect to off-allowlist host.
- `backend/src/lib/urlValidation.ts` — `cta_url` validator for spec 17 (relative storefront path or allowlisted `https:` host).

## 8. Pagination registry audit

A test (not app code) that introspects the mounted route table and asserts every array-returning endpoint uses the existing `ApiListSuccess`/pagination schema from spec 01.

## 9. Frontend (minimal)

- Extend the existing `apiClient` 429/`RATE_LIMITED` handling with the fixed English message ("Too many attempts. Please wait a few minutes and try again.") and a `Retry-After`-based countdown, if not already stubbed from spec 01.
- No new pages; this is cross-cutting client behavior, fully exercised once spec 08+ forms exist.
- No frontend rate limiting is implemented — backend is the sole control (§11.2).

## 10. Tests (hand off to `testing-agent`)

Per spec's "Tests required" (13 items):

1. Under-limit succeeds / over-limit 429 for `adminLogin`, `authenticatedCeiling`, `publicCeiling`.
2. Composite keying — identifier survives IP rotation; IP bounds identifier cycling; shared-IP legitimate user not locked out by another's exhaustion.
3. Non-enumeration on 429 — identical body for existing vs. non-existent identifier.
4. `Retry-After` present and consistent with configured window.
5. Rejection logging — audit row exists with limiter/endpoint/IP, identifier stored hashed.
6. Env-configurability — changing env value changes enforced threshold, no code change.
7. Track Order and guest lookup are independent limiters (registry-level now; functional check in spec 15).
8. No partial write on rejection — 429'd request leaves no business-table row.
9. Upload validation — content/extension mismatch rejected, SVG rejected, oversize rejected, valid image accepted.
10. HTML sanitization — script tags, event handlers, `javascript:` URLs stripped.
11. SSRF guard — private/loopback/link-local and non-allowlisted hosts rejected; off-allowlist redirect not followed.
12. Security headers — CSP, HSTS, nosniff, Referrer-Policy present; CORS rejects non-allowlisted origin.
13. Pagination registry — no route returns an unbounded array.

---

## Open decisions to confirm before implementation

1. **Redis vs memory-only for now.** No deployment topology confirmed yet. Recommendation: implement both behind `RATE_LIMIT_STORE`, default `memory`, don't mandate Redis infra today — just wire the switch and the production warning.
2. **CSP additions for not-yet-built hosts** (Supabase Storage, Meta Pixel). Plan: leave CSP as-is now, comment that specs 06/18 extend it, rather than guessing hostnames.

---

## Implementation order

1. Migration (`0005_security_events.sql`)
2. Config/env (`rateLimits.ts`, `env.ts` additions)
3. `rateLimit` middleware
4. `app.ts` mounting
5. Security helpers (`uploadValidation`, `sanitizeHtml`, `safeFetch`, `urlValidation`)
6. Hardening completions (HTTPS redirect, CSP review, request timeout, upload body-limit helper)
7. Hand off to `testing-agent` for spec 04's test list
