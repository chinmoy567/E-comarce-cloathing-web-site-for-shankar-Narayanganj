---
name: test
description: Testing strategy and required coverage for this Bangladesh e-commerce platform — how to test the order/payment/shipment state machine, RBAC permission matrix, coupon engine, and other business-rule-heavy areas defined in .claude/project requirment documents/
type: skill
version: 1.0
priority: high
---

# Test Skill

**For**: Bangladesh Fashion & Clothing E-Commerce Platform
**Purpose**: Make sure the areas of this codebase that encode business rules — not just CRUD — are covered by tests that would actually catch a spec violation.

This skill is a testing *strategy* document: what must be tested, at what level, and why, so coverage isn't decided ad hoc per feature. It complements `backend-builder`/`frontend-builder` (who implement features) and `architect-reviewer`/`security-reviewer` (who review after the fact) — this skill is what to reach for when writing or reviewing tests specifically.

---

## Priority order (highest risk first)

The project's own docs already identify which areas are riskiest if they silently break. Test in this order, not file-by-file as code happens to be written:

1. **Order/payment/shipment state machine** (`07-order-state-machine.md`, Section 5.21) — the single most load-bearing piece of business logic in the system. It is explicitly called "Authoritative" in the doc index.
2. **RBAC permission matrix and hierarchy rules** (`06-rbac.md`, Sections 5.10–5.19) — every protected endpoint depends on this being correct; a gap here is a security hole, not just a bug.
3. **Coupon/discount engine** (`10-coupon-discount.md`, Section 8) — directly affects money charged to real customers (bKash amount, COD amount).
4. **Fraud/risk check** (`09-fraud-risk-check.md`) and **security hardening / rate limiting** (`11-security-hardening.md`) — abuse-resistance, not just happy-path correctness.
5. Everything else (catalogue CRUD, CMS, analytics/Meta Pixel, WhatsApp link) — standard coverage, lower priority.

If time is limited, 1–3 are the areas where an untested regression would cause real financial or security harm; don't spend equal effort everywhere.

---

## 1. Order/Payment/Shipment State Machine

Read `07-order-state-machine.md` in full before writing these tests — do not test against the narrative diagrams in `03-payment-order.md`/`04-courier-shipment.md`, which are illustrative only. Section 5.21 is the only authoritative source for enum values and transitions.

**What must be covered:**

- **Every valid transition** listed in 5.21.1 (bKash), 5.21.3 (COD), 5.21.4 (shipment/order relationship), 5.21.7 (cancellation) — one test per transition edge, asserting the resulting status and that it was written via the transition mechanism (not a direct field write).
- **Every explicitly invalid transition** (5.21.10) — assert the backend rejects it with a clear error and the status is unchanged. Don't only test the happy path; the spec calls out invalid transitions by name because they're the attack surface.
- **Payment, order, and shipment status independence** (5.21.11) — a test that changes one status and asserts the other two are untouched. This is the rule most likely to be silently violated by a future refactor that "simplifies" status handling.
- **bKash payment rejection and resubmission loop** (5.21.2) — including repeated rejection/resubmission cycles, not just one round trip.
- **Shipment creation failure** (5.21.5) and **delivery failure / retry / return-to-store** (5.21.6) — assert these do **not** cascade into auto-rejecting a verified payment or auto-cancelling a confirmed order (this exact anti-pattern is called out in `backend-builder.md` — write a regression test for it explicitly).
- **Idempotent courier status sync** (Section 4.6, `04-courier-shipment.md`) — send the same webhook/poll update twice (and out of order) and assert state doesn't corrupt or double-apply.
- **Stock decrement/restore** — decrements at `CONFIRMED` (Section 5.1), restores on cancellation; test both directions plus a cancellation-after-partial-shipment edge case if the spec allows it.
- **Audit trail** (5.21.11, 5.15 rule 10) — every status change test should also assert an audit record was written with previous status, new status, timestamp, and triggering actor.
- **Transition authorization** (5.21.9) — a transition attempted by a caller without the matching permission (e.g. `order.confirm`, `payment.verify`) must be rejected even if the transition would otherwise be structurally valid. Pair this with the RBAC tests below rather than duplicating permission logic.

**Level:** integration tests against the real state-transition service/function with a real (test) database — this logic is exactly what mocking would hide. Unit tests for pure transition-validity functions are a fine addition, not a replacement.

---

## 2. RBAC (Roles and Permissions)

Read `06-rbac.md` Sections 5.10–5.19 in full. The permission matrix in 5.18 is authoritative; the permission-key table in 5.16 maps human actions to enum values the backend implements.

**What must be covered:**

- **Every row of the Section 5.18 matrix** — for each permission, a test asserting Admin can perform it, Manager can/cannot per the `Yes`/`Assigned`/`No` value, and (for `Assigned` rows) that an unassigned Manager is rejected while an explicitly-assigned Manager succeeds.
- **Manager cannot manage Admin** — attempt every action in 5.11 ("Manager must not...") as a Manager actor and assert rejection: delete/modify Admin account, create/delete/modify another Manager, modify own role/permissions, modify system-wide RBAC config.
- **Self-escalation ban** (5.15 rules 4 and 7) — a Manager attempting to grant themselves a permission they don't have, and any actor attempting to set a role above their own management scope (creation *and* later role change — rule 7 explicitly covers both paths).
- **Grantor-can't-exceed-own-permissions** (5.15 rule 6) — Admin attempting to grant a Manager a permission the Admin itself doesn't hold; assert this is enforced **at grant time**, not only when the permission is later used — write the test to confirm the grant call itself fails, not just that the granted permission doesn't work.
- **Protected system Admin account** (5.12.3) — a Manager (or any non-privileged path) attempting to delete/disable/modify-role the seeded `is_system_admin` account must be rejected, including via generic account-management endpoints that aren't explicitly Admin-account-aware.
- **Idempotent Admin seed** (5.12.2) — run the seed process twice (or concurrently) and assert exactly one Admin account exists, no duplicate, no error on second run.
- **Role enum constraint** (5.19) — attempt to write `SUPER_ADMIN` or `STAFF` (or any value outside `ADMIN`/`MANAGER`/`CUSTOMER`) directly at the data layer and assert the database-level constraint rejects it, not just application-level validation.
- **`courier.manage` vs `courier.select` are separate checks** (5.16) — a Manager with default permissions can select a courier per order but is rejected from courier provider/API configuration unless separately assigned `courier.manage`. Test both independently; don't assume one implies the other.
- **Audit logging for permission-changing actions** (5.15 rule 10) — every grant/revoke/role-change test should also assert an audit record was written.
- **Frontend-hiding is not a security boundary** (5.15, 5.17) — for at least the highest-risk endpoints (payment verify/reject, order confirm/cancel, Manager create/delete, permission assign), write a test that calls the backend endpoint directly with an unauthorized actor, bypassing any UI — the point is proving the backend rejects it independent of what the frontend would have hidden.

**Level:** integration tests hitting real Express middleware + real permission-check logic against a test database with seeded Admin/Manager fixtures at varying permission grants. Don't mock the permission-check layer — that's the thing under test.

---

## 3. Coupon / Discount System

Read `10-coupon-discount.md` Section 8 in full, especially 8.14–8.16 (calculation and security).

**What must be covered:**

- **Discount calculation correctness** (8.14a percentage, 8.14b fixed-amount, 8.14c shipping not discounted by default) — test each type against known inputs/outputs.
- **Minimum order amount / maximum discount cap** (8.10) — boundary tests at exactly the minimum, just below it, and at/above the max-discount cap.
- **Product/category and customer eligibility** (8.12, 8.13) — a coupon restricted to a category/customer segment must be rejected for an ineligible cart/customer, not just silently discount $0.
- **Usage limits** (8.8) — global usage cap and per-customer usage cap, including a concurrency test (two near-simultaneous redemptions against a coupon with one use left) to catch a race condition on the counter.
- **Coupon lifecycle / status** (8.6) — expired, not-yet-active, deactivated, and archived coupons must all be rejected at validation, with distinct/clear reasons where the spec calls for them.
- **Preview vs. mandatory revalidation** (8.15a, 8.15b) — the critical security test: apply a coupon at preview time, then mutate the cart or attempt to submit a stale/tampered discount value at order placement, and assert the backend **revalidates and recomputes** rather than trusting the client-supplied discount (8.16a bKash amount, 8.16b COD amount). This is the single highest-value test in this section — it directly defends against price manipulation.
- **Multiple coupons** (8.17) — whatever the spec's stacking rule is (likely one-at-a-time unless stated otherwise) — test that the rule is enforced, not assumed.
- **Order total composition** (8.15c) — assert the final total sent to payment (bKash amount) or recorded for COD exactly matches subtotal − discount + shipping (or whatever the documented formula is), computed server-side.

**Level:** integration tests against the real coupon validation/apply/revalidate service. The revalidation tests specifically should simulate a malicious client (tampered request body), not just a well-behaved one.

---

## 4. Fraud/Risk Check and Security Hardening

Read `09-fraud-risk-check.md` and `11-security-hardening.md`.

- **Risk check caching** (Section 7.6) — assert cached results are actually reused within the documented TTL and refreshed after it, rather than hitting the external API every time.
- **Risk check failure handling** (7.8) — external API failure must degrade gracefully (per whatever the doc specifies), not crash order processing.
- **Rate limiting** (11.2, 11.3) — for each endpoint in the 11.3 matrix, a test that exceeds the documented limit and asserts a 429/throttle response, and a test just under the limit that succeeds.
- **Input validation / injection** (11.6) — at minimum, regression tests for any injection vector the security-reviewer agent has previously flagged; don't rely solely on manual review to catch these going forward.

**Level:** integration tests; rate-limit tests may need a test-only lower threshold or time-manipulation to run quickly.

---

## General rules for this project

- **Don't mock the database or the permission-check layer in the tests listed above.** These are exactly the pieces of code the project's own docs identify as high-risk — a mocked test can pass while the real transition/permission logic is broken. Use a real test database (a Supabase/Postgres test instance or local Postgres), not an in-memory fake with different semantics.
- **Test against `07-order-state-machine.md` and `06-rbac.md` directly, not against other docs' narrative diagrams** — if a test and one of the narrative docs (02–05, 08) disagree, the state-machine/RBAC doc wins; flag the narrative doc as needing a correction rather than testing to match it.
- **One test per matrix row/transition edge**, not one big parameterized "smoke test" — when a single row breaks, the failure should name exactly which permission or transition broke.
- **New backend features must ship with tests for their state/permission/coupon-money surface before being considered done** — a feature that touches order/payment/shipment status, RBAC, or coupon math without tests should be treated as incomplete, the same way `backend-builder` treats an unvalidated status transition as incomplete.
- **When `security-reviewer` or `architect-reviewer` flags a bug that already shipped**, add a regression test reproducing it as part of the fix — don't just patch the code.
</content>
