---
name: security
description: Security implementation and review strategy for this Bangladesh e-commerce platform — what must be enforced where (Express middleware, never RLS, never frontend), rate limiting, input validation, secrets handling, and the highest-risk business-logic abuse paths defined in .claude/project requirment documents/
type: skill
version: 1.0
priority: high
---

# Security Skill

**For**: Bangladesh Fashion & Clothing E-Commerce Platform
**Purpose**: Define what "secure" means for this specific codebase, so security work (implementation via `security-agent`, review via `security-reviewer`) is checked against the same concrete list every time instead of generic OWASP advice.

This skill complements `security-agent` (implements fixes/hardening) and `security-reviewer` (audits and reports) — read it before either kind of work. It is not a replacement for reading `11-security-hardening.md` and the RBAC/state-machine docs in full; it's the index of what matters and why.

---

## 0. The one fact that overrides generic Supabase advice

Per `01-overview.md` Section 1.1: **all database access goes through the Express backend using the Supabase service-role key. The browser/Next.js client never talks to Supabase directly, and Supabase Row Level Security is explicitly NOT relied upon as the authorization mechanism under this access pattern.** Authorization is enforced in the Express layer only (Section 5.15).

This means:
- Don't ask "does an RLS policy exist" as a security check for this project — there may be none, and that is correct, not a gap, as long as every table is only ever reached via the service-role key from trusted backend code.
- The real question is always: **does this Express route independently verify the caller's identity and permission before touching the database**, not "does a client-side control exist."
- If you ever find a code path where the Next.js frontend calls Supabase directly (any Supabase client, anon key, or service-role key reachable from browser code), that is a **Critical** finding regardless of what RLS says — it bypasses the entire authorization model, not just one policy.

---

## Priority order (highest risk first)

1. **Authorization bypass on any Express route** — a protected action reachable without the matching permission check (Section 5.18 matrix). This is the most direct path to real financial/data harm.
2. **Order/payment/shipment state manipulation** — any way to write status directly instead of through the transition mechanism (`07-order-state-machine.md`), or to spoof a `Paid/Verified` payment.
3. **Price/coupon manipulation** — trusting a client-supplied discount or total instead of backend revalidation (`10-coupon-discount.md` Section 8.15–8.16).
4. **Secrets exposure** — courier credentials, Supabase service-role key, Meta CAPI token, or any credential reaching frontend code, logs, or API responses.
5. **Injection and abuse-resistance** — SQL/XSS/SSRF/command injection, rate limiting gaps, brute-force resistance on auth/OTP.
6. Everything else in the Section 11 hardening checklist (headers, CORS, dependency hygiene) — real but lower urgency than the above.

---

## 1. Authentication & Session

- Passwords hashed with a modern algorithm (never plaintext/reversible/weak hash).
- OTP: bounded expiry, rate-limited attempts, not guessable/sequential, invalidated after use.
- Session/JWT: strong secret held server-side only, no `alg: none`, sane expiry, refresh-token rotation if used, logout actually invalidates server-side state where the design calls for it.
- Login endpoint rate-limited per Section 11.3's matrix — credential stuffing and brute force must not be free.

## 2. Authorization / RBAC (`06-rbac.md`, Sections 5.10–5.19)

- Every protected Express route independently checks the caller's permission against the Section 5.18 matrix — never inferred from what the frontend shows or hides (Section 5.17).
- Role hierarchy is Admin/Manager only — no "Staff" or "Super Admin"; a lower role can never act on a higher one.
- Self-escalation is banned (5.15 rules 4 and 7) — a Manager cannot grant themselves a permission, and no actor can set a role above their own management scope, at creation or later change.
- A grantor cannot grant a permission they don't themselves hold (5.15 rule 6), enforced at grant time.
- The seeded system Admin account (5.12.3) cannot be deleted/disabled/role-changed via any path, including generic account-management endpoints.
- `courier.manage` and `courier.select` are separate checks (5.16) — verify independently, don't assume one implies the other.

## 3. Payment Security (bKash / COD)

- A customer can never set their own payment status to `Paid`/`Verified` — that transition requires `payment.verify` and is unreachable from customer-facing routes.
- Transaction ID / screenshot submission is not spoofable, and a valid Transaction ID cannot be replayed against a different order.
- The amount sent to payment/courier is always the server-computed final total (post-coupon), never a client-supplied value (Section 4.2, 8.16b).

## 4. Order/Payment/Shipment State Machine (`07-order-state-machine.md`)

- All status changes go through the one transition mechanism — a direct field write to order/payment/shipment status bypassing validation is both an architecture and a security violation (it's how a customer would fake a paid/confirmed order).
- Payment, order, and shipment status are independent fields (5.21.11) — a change to one must never leak into another.
- Courier/payment failures never cascade (Section 3.5, 4.11, 5.6): a failed courier call must never auto-reject a verified payment or auto-cancel a confirmed order — that would be both a bug and an availability-abuse vector.

## 5. Coupon / Price Integrity (`10-coupon-discount.md`)

- Preview-time discount values are never trusted at order placement — the backend must recompute and revalidate (8.15a/b) against the actual cart, eligibility, usage limits, and coupon status at submission time, not accept a client-supplied discount.
- Usage limits (global and per-customer) enforced with real concurrency safety, not a check-then-write race.

## 6. Input Validation & Injection (Section 11.6)

- Every API endpoint validates input against an explicit schema (e.g. zod/joi) before touching business logic — unknown/malformed fields rejected, not passed through.
- SQL injection: even via the Supabase client/PostgREST, no raw string concatenation into queries.
- XSS: stored/rendered content (product descriptions, reviews, CMS `content_config`/`CUSTOM_CONTENT`, Section 13) sanitized server-side before storage, not just escaped at render.
- SSRF: any server-side fetch (courier webhooks, image/URL fetching) validates the target rather than fetching arbitrary caller-supplied URLs.
- File uploads (product images, bKash screenshots) validated for MIME/type/size before reaching Supabase Storage; uploaded SVG/HTML can't become stored XSS.

## 7. Secrets & Credentials

- Courier API credentials (Pathao/Steadfast) and Meta CAPI access token: server-side env/config only, never returned in any API response (including Track Order, Section 4.16) or logged in plaintext (Section 4.8, 5.5, 8.6 Meta doc).
- Supabase service-role key: backend-only, never in `NEXT_PUBLIC_*` vars or any client bundle.
- `.env*` files git-ignored; no hardcoded secrets in source.

## 8. Public/Unauthenticated Endpoints

- Guest checkout, guest order lookup, and public Track Order (Section 2.9, 4.14, 4.16) are intentionally unauthenticated — don't "fix" this by adding a login gate — but they must return only the customer-safe, normalized model: no raw courier API responses, internal DB primary keys, admin notes, fraud/risk data, or full addresses beyond a delivery-area summary. An unresolved identifier and a resolved-but-foreign identifier must produce the same generic "not found" response (no enumeration oracle).

## 9. Rate Limiting & Abuse Resistance (Section 11.2–11.3)

- Login, OTP, password reset, payment-verification, search/checkout endpoints each rate-limited per the documented matrix.
- Fraud/risk-check external API calls cached within the documented TTL (Section 7.6) — not re-hit per request — and degrade gracefully on provider failure (7.8) without blocking order processing.

## 10. Headers, CORS, Cookies

- CSP, HSTS, X-Frame-Options (or equivalent clickjacking protection) set.
- CORS allowed origins scoped, not wildcard-with-credentials.
- Cookies: `HttpOnly`, `Secure`, `SameSite` set appropriately for session cookies.

---

## General rules for this project

- **Check the Express layer first, always** — this stack does not use RLS as an authorization control, so "is there a permission check on this route" is the question, not "is there a database policy."
- **A vulnerability with no plausible attack path from an unprivileged/unauthenticated client is not worth flagging as a finding** — but a theoretical gap in a payment/RBAC/state-machine path is worth flagging even without a fully worked exploit, because the blast radius is real money.
- **Cite `file:line` and the exact spec section violated** — a security finding tied to a documented rule (RBAC matrix, state-machine transition table, coupon revalidation rule) is not a style nit, it's a spec violation.
- **Never fix a security gap by weakening a control elsewhere** (loosening CORS, disabling validation) to unblock a legitimate flow — find the fix that keeps both intact.
