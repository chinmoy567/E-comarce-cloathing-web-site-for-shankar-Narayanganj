---
name: backend
description: Backend implementation strategy for this Bangladesh e-commerce platform — Express/TypeScript layering, the order/payment/shipment state machine, RBAC enforcement, courier abstraction, and cross-cutting business rules that must be checked before any backend feature ships, per .claude/project requirment documents/
type: skill
version: 1.0
priority: high
---

# Backend Skill

**For**: Bangladesh Fashion & Clothing E-Commerce Platform
**Purpose**: A checklist of the backend rules that keep recurring across the spec, so `backend-builder` and reviewers check the same list every time instead of re-deriving it per feature. This skill is "what to verify before calling backend work done" — `backend-builder.md` (the agent) owns the how-to-implement instructions; this skill is the cross-cutting review layer that sits alongside it, close in spirit to how `test` sits alongside `backend-builder`/`frontend-builder`.

Read the matching numbered doc in `.claude/project requirment documents/` for the feature area before building or reviewing; this skill is the index, not a replacement for reading the actual spec section.

---

## 1. Fixed Stack (Section 1.1)

Node.js, Express.js, **TypeScript only**, REST API, PostgreSQL via Supabase accessed **only** through the Express layer with the service-role key. No second database, no second backend framework, no direct client-to-Supabase access. See the `database` skill for schema-level conventions and the `security` skill for why RLS is not the authorization mechanism here.

## 2. Layering

- Routes → controllers → services → data access — don't collapse layers (business logic in a route handler) or skip layers (a controller reaching directly into raw SQL when a service should own that).
- Business logic lives on the backend, always — the frontend never independently computes prices, totals, discounts, or stock availability as an authoritative value (this is enforced from the frontend side too, per the `frontend` skill, but the backend must never assume the frontend already validated something).

## 3. Order/Payment/Shipment State Machine (`07-order-state-machine.md`, Section 5.21) — highest priority

- Payment, order, and shipment status are **three independent fields** — never conflate them or derive one implicitly from another (5.21.11).
- Every status change is validated against the explicit transition tables (5.21.1–5.21.9) before touching the DB — invalid transitions are rejected with a clear error, never silently coerced.
- The narrative diagrams in Sections 3/4 (`Shipped`/`In Transit`/`Out for Delivery` alongside order progress) describe **shipment** status, not order status — `07-order-state-machine.md` is the only source of truth for the order-status enum.
- Courier/payment failures never cascade: a failed courier call must never auto-reject a verified bKash payment, auto-cancel a confirmed order, or mark a shipment `Shipped` (Section 3.5, 4.11, 5.6) — failures are recorded and retryable, not silently absorbed into unrelated state.
- Stock decrements at `CONFIRMED`, not at order placement (Section 5.1), and is restored on later cancellation.
- Courier status sync is idempotent — duplicate or out-of-order webhook/poll updates must not corrupt state (Section 4.6).
- Every status change and permission-changing action is audited: previous status, new status, timestamp, triggering user/system, reason where applicable (5.21.11, 5.15 rule 10).

## 4. RBAC (`06-rbac.md`, Section 5.18) — highest priority

- Every protected endpoint checks the required permission (e.g. `payment.verify`, `order.confirm`, `shipment.create`) against the Section 5.18 matrix on the backend, always — frontend hiding a button is never sufficient authorization (Section 5.17).
- Role hierarchy is Admin/Manager only — no "Staff"/"Super Admin." Self-escalation is banned (5.15 rules 4/7); a grantor can't grant a permission they don't hold themselves, enforced at grant time (5.15 rule 6).

## 5. Courier Integration (`04-courier-shipment.md`, Section 4.8–4.9)

- Courier API credentials stay server-side only, never exposed to the frontend.
- All courier calls go through the courier service abstraction so providers are swappable without touching order-management logic — a one-off integration that bypasses the shared interface is a structural violation even if it "works" (hand this specific work to `courier-integration`, not general backend code).
- Concurrent-creation lock: a second `Create Shipment` request for the same order while one is already `CREATING` is rejected, not dispatched concurrently.
- No duplicate shipment on retry after a transient failure — retry is an explicit Admin/Manager action, never automatic silent retry.

## 6. Coupon/Discount (`10-coupon-discount.md`, Section 8)

- Preview-time discount values are never trusted at order placement — the backend recomputes and revalidates against the real cart, eligibility, usage limits, and coupon status at submission (8.15a/b).
- Usage limits (global and per-customer) enforced with real concurrency safety, not a check-then-write race (see `database` skill).
- Final total sent to payment/courier is the server-computed value (subtotal − discount + shipping), never client-supplied (8.15c, 8.16a/b).

## 7. Fraud/Risk Check (`09-fraud-risk-check.md`, Section 7)

- Risk-check results are cached within the documented TTL (7.6), not re-fetched from the external API on every request.
- External API failure degrades gracefully per the doc (7.8) — never crashes or blocks order processing.
- `raw_result` is stored for audit but never returned to the frontend verbatim beyond what 7.5 defines as displayable.

## 8. Analytics / Meta CAPI (`08-analytics-meta.md`, Section 6)

- A failure to send an event to CAPI (network error, API error, rate limit) must never block, delay, fail, or roll back the underlying customer action (order placement, payment submission, confirmation) — log and move on, don't retry in a way that risks duplicate order side-effects (Section 6.9).
- Customer-identifying fields sent to Meta are limited to hashed values where required (Section 6.5) — never plain-text PII.
- Same `event_id` shared between the client-side Pixel call and the corresponding server-side CAPI call for deduplication (Section 6.4).

## 9. Security Cross-Cutting Rules

See the `security` skill for the full list — the backend-specific highlights: every endpoint validates input against an explicit schema before touching business logic (Section 11.6), rate limiting on auth/OTP/payment/checkout endpoints (Section 11.3), secrets never logged or returned in API responses, SQL injection prevented even via the Supabase client (no raw string concatenation).

## 10. Track Order / Public Endpoints (`04-courier-shipment.md`, Section 4.14–4.16)

- Guest checkout, guest order lookup, and public Track Order are unauthenticated by design — validated by submitted fields (Order Number + Phone, or courier tracking ID), not a login gate.
- Response hygiene: only the normalized customer-safe model — never raw courier responses, internal DB primary keys, admin notes, fraud/risk data, or full addresses beyond a delivery-area summary. Unresolved and resolved-but-foreign identifiers return the same generic "not found" (no enumeration oracle).
- Don't conflate the internal store Order Number with courier-provided Order ID/Parcel ID/Tracking ID (Section 4.15) — they're different fields already defined by the existing schema.

---

## General rules for this project

- **Write only what's needed for the requested feature** — no speculative abstractions, no scaffolding for features not yet requested.
- **Follow existing project conventions once code exists** — grep for the existing pattern before assuming there isn't one; don't introduce a second way of doing something the codebase already does one way.
- **Validate inputs and enforce business rules at the service/controller layer, not just the DB** — but don't add defensive checks for cases the spec rules out.
- **A backend feature touching order/payment/shipment status, RBAC, or coupon math ships with tests** (see the `test` skill) — treat it as incomplete otherwise, the same way an unvalidated status transition is incomplete.
