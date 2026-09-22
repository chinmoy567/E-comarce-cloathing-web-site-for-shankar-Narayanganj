# 00 — Implementation Spec Index

Twenty-one sequential, independently buildable slices covering the full requirement set in `.claude/project requirment documents/`. Each spec file is self-contained: a future session opens exactly one of them, reads only the PRD sections it cites, and implements that slice end to end.

Spec **21** is the one slice with no PRD of its own: it implements shipping-fee computation, which every PRD total assumes exists but none defines. It is numbered last but **built before 11**.

These files describe **how to build**, in the order it must be built. The PRDs remain authoritative for **what** the system must do. Where a spec and a PRD disagree, the PRD wins (CLAUDE.md §1), and `07-order-state-machine.md` §5.21 outranks every other PRD for order, payment, and shipment states.

---

## Spec table

| # | Title | PRD sections covered | Depends on | Summary |
| --- | --- | --- | --- | --- |
| 01 | Repository Foundation, Express Bootstrap, and Shared API Conventions | 01-overview §1, §1.1; 11-security §11.4–11.6, §11.9 | — | Workspace, Express + Next.js bootstrap, Supabase service-role client, error taxonomy, validation and pagination conventions, Tailwind design tokens, migration runner. |
| 02 | Core Schema: Identity, Role Enum, Address Model, Audit Log | 02-customer §2.1, §2.2, §2.9.4; 05-admin §5.7; 06-rbac §5.12.3, §5.16, §5.18, §5.19; 07-state-machine §5.21.11; 11-security §11.7 | 01 | `users`, `customers` (registered + guest, one row per phone), the Bangladesh address model with its two discriminators, the seeded permission catalogue, grants, and the append-only audit log. |
| 03 | Admin Seed, Back-office Auth, RBAC Middleware, Manager Accounts | 02-customer §2.4, §2.7, §2.8; 06-rbac §5.10–5.19; 11-security §11.3, §11.5, §11.7 | 01, 02 | Idempotent system-Admin seed, scoped admin sessions, `requirePermission`, Manager CRUD and permission grants under the full hierarchy rules, all audited. |
| 04 | Rate Limiting, Abuse Protection, Security Hardening | 11-security §11.2–11.6, §11.9; 02-customer §2.5, §2.9.7; 04-courier §4.16; 09-fraud §7.6; 10-coupon §8.28 | 01–03 | One configurable limiter registry keyed by identifier + IP, 429 + `Retry-After`, plus the shared upload validator, HTML sanitizer, and SSRF-guarded fetch every later slice uses. |
| 05 | Catalogue Schema and Admin Catalogue Management | 05-admin §5.1; 06-rbac §5.18; 01-overview §1.1; 13-cms §13.5, §13.6, §13.9; 10-coupon §8.12, §8.14 | 01–04 | Categories, products, attributes, variants, slugs, visibility and Featured flags, and the atomic `decrementStock`/`restoreStock` primitives spec 12 calls. |
| 06 | Supabase Storage and Image Uploads | 01-overview §1.1; 05-admin §5.1; 11-security §11.4, §11.6; 13-cms §13.11 | 01–05 | Public product-image and private payment-proof buckets, content-sniffed validation with re-encoding, and the permission-gated signed-URL pattern specs 11 and 17 reuse. |
| 07 | Storefront Catalogue Browsing and SEO Foundation | 01-overview §1.1; 02-customer §2; 05-admin §5.1; 13-cms §13.9, §13.15; 12-whatsapp §12.3 | 01, 04–06 | Public catalogue endpoints with a customer-safe projection, category/product/search pages, the shared `<ProductCard />`, and the full SEO contract (metadata, canonicals, JSON-LD, sitemap, robots). |
| 08 | Customer Accounts: Registration, Login, Recovery, Profile | 02-customer §2.1–2.6, §2.9.4, §2.9.8; 06-rbac §5.19; 11-security §11.3, §11.7 | 01–04, 07 | Optional registration from the profile icon, scoped customer sessions, the §2.5 OTP rules exactly, profile completeness evaluation, and the phone-verified guest-account claim. |
| 09 | Shopping Cart and Wishlist | 02-customer §2, §2.9.1, §2.9.3; 03-payment §3; 05-admin §5.1; 10-coupon §8.15a, §8.16 | 01–05, 07, 08 | Server-side cart with no stored prices, `resolveCartForPricing()` (the single pricing source for specs 10 and 11), guest→account merge, and the wishlist. |
| 10 | Coupon Engine and Admin Coupon Management | 10-coupon §8.1–8.31; 06-rbac §5.18 | 01–05, 09 | The seven ordered validation checks, the calculation chain, the public validate endpoint, admin CRUD with delete-vs-archive, and the transaction-safe `recordCouponUsage()` spec 11 calls. |
| 11 | Checkout and the Order-Creation Transaction | 02-customer §2, §2.3, §2.9.1–2.9.4; 03-payment §3, §3.1, §3.2, §3.9; 07-state-machine §5.21; 10-coupon §8.15b–8.16b, §8.23, §8.25, §8.26; 04-courier §4.15 | 01–06, 08–10 | Guest-default checkout, one order-creation transaction (validate → re-price → revalidate coupon → insert → record usage), idempotency keys, initial statuses, and bKash submission with global Transaction ID uniqueness. |
| 12 | The Order/Payment/Shipment State Machine Service | **07-state-machine §5.21 in full**; 05-admin §5.1; 04-courier §4.6; 08-analytics §6.3, §6.8; 10-coupon §8.27; 06-rbac §5.16, §5.18 | 01–03, 05, 11 | The only writer of any status column: three transition tables, permission and actor checks, stock decrement/restore, the atomic `DELIVERED`/`RETURNED` cascades, idempotent courier sync, and a database trigger blocking direct writes. |
| 13 | Admin Order Panel and Customer Management | 05-admin §5.2–5.4, §5.7; 03-payment §3.4; 07-state-machine §5.21.2, §5.21.3, §5.21.9; 06-rbac §5.18; 10-coupon §8.23 | 01–04, 06, 11, 12 | Order list and detail with three separate statuses, bKash verify/reject with reasons, COD confirmation, cancellation, COD collection resolution, and customer management. |
| 14 | Courier Abstraction and Shipment Creation | 04-courier §4.1–4.5, §4.8–4.11, §4.15; 05-admin §5.5, §5.6; 07-state-machine §5.21.5, §5.21.7; 06-rbac §5.16; 10-coupon §8.21 | 01–04, 11, 12, 13 | Data-driven courier registry, one adapter contract for Pathao and Steadfast with status normalization, the `CREATING` concurrency lock, retry/change-courier, and the Cancel Shipment port spec 12 needs. |
| 15 | Status Sync, Track Order, Guest Lookup, Order History | 04-courier §4.6, §4.7, §4.14–4.16; 02-customer §2.6, §2.9.5–2.9.7; 03-payment §3.6–3.8 | 01, 04, 08, 11, 12, 14 | Idempotent webhook and polling ingestion, the public Track Order page, the Order Number + phone guest lookup, and account order history — three deliberately separate features. |
| 16 | Courier Fraud / Customer Risk Check | 09-fraud §7.1–7.11; 06-rbac §5.18 | 01–04, 11, 13 | Explicitly triggered, customer-keyed cached risk checks with graceful failure, displayable fields only, and no automatic adverse action. |
| 17 | CMS-Driven Homepage and Campaigns | 13-cms §13.1–13.17; 05-admin §5.8; 06-rbac §5.18 | 01–07, 10 | Homepage sections and campaigns with server-evaluated scheduling, automatic/manual product selection, the single homepage endpoint, the Homepage Builder, and authenticated preview. |
| 18 | Meta Pixel and Conversions API | 08-analytics §6.1–6.9; 10-coupon §8.31; 13-cms §13.16 | 01, 04, 07, 09, 11, 12 | Dual-channel events with a shared `event_id`, `Purchase` firing exactly once on the `CONFIRMED` transition with the discounted total, hashed identifiers, and full failure isolation. |
| 19 | WhatsApp Click-to-Chat Button | 12-whatsapp §12.1–12.8 | 07, 09 | One helper and one component building a `wa.me` link from the canonical product URL, stock-driven button pairing, fail-closed config — no backend, no dependency. |
| 20 | Analytics and Business Reports | 05-admin §5.9; 06-rbac §5.18; 10-coupon §8.29, §8.30; 11-security §11.4 | 01–05, 10–14 | All seven §5.9 report groups, bounded and paginated, with one stated revenue-recognition rule, aggregate-only customer data, and asynchronous CSV export. |
| 21 | Shipping Fee Computation | *(no PRD defines it)* — implements the charge assumed by 10-coupon §8.14c, §8.15c, §8.16a/b; 03-payment §3.9; 02-customer §2.2; 04-courier §4.2 | 01, 02, 03, 09 | The one authority for `shipping_amount`: an admin-managed zone/rate table (district + metropolitan discriminator), free-shipping thresholds, and `computeShipping()`. Built **before 11**, which calls it. |

---

## Recommended build order

Build strictly in numeric order. The numbering is dependency order, not PRD order.

**Foundation (01–04)** — nothing else can start. 01 fixes the layering and error/validation conventions every later route follows; 02 fixes the identity, address, and audit schema; 03 makes the back-office reachable and gated; 04 makes every endpoint abuse-resistant and supplies the shared upload, sanitization, and outbound-fetch helpers.

**Catalogue and storefront (05–07)** — the product data everything downstream prices, ships, and reports on, plus a browsable, indexable storefront.

**Customer-side prerequisites (08–09)** — accounts (never required for checkout) and the server-side cart that becomes the single pricing input.

**Money and orders (10, 21, 11–13)** — the highest-risk sequence. 10 builds the coupon engine; **21 builds shipping-fee computation, which 11's totals depend on**; 11 builds the one order-creation transaction; 12 builds the one state-machine service; 13 gives operators the panel to run it. **Do not reorder these.** (21 is numbered last only because it was specified after the original twenty; its place in the build order is here.)

**Fulfilment and customer visibility (14–16)** — shipping, tracking, and the pre-shipment risk review.

**Presentation and reporting (17–20)** — the CMS homepage, analytics events, the WhatsApp button, and back-office reports. These four are largely independent of each other and could be parallelized across sessions if needed.

### Which slices unblock the most downstream work

1. **02 — Core schema.** Fourteen later specs read `customers`, `audit_logs`, or `withTransaction`. The phone-unique `customers` row is the single join point behind guest order history, risk-check caching, and per-customer coupon limits (§2.9.4, §7.6, §8.8) — three features that silently break if this row is modelled as three things.
2. **12 — State machine.** Every order-touching slice after it (13, 14, 15, 18) calls it and none may write a status column directly. It is also where the stock rules, the `Purchase` timing, and the atomic cascades are actually enforced (§5.1, §6.3, §5.21.6).
3. **01 — Foundation.** Every route in the system inherits its error shape, validation mechanism, pagination helper, and layering.
4. **11 — Order creation.** Specs 12–16, 18, and 20 all read the tables it creates; it is also where the PRDs' strongest security rule — never trust a client-supplied price or total — is first enforced end to end.
5. **04 — Security hardening.** Eight later slices mount a limiter it defines, and three use its upload validator, sanitizer, or SSRF-guarded fetch rather than writing their own.

---

## Coverage

Every PRD file and every numbered section is covered by at least one spec. Sections deliberately deferred, each with the PRD's own reason:

| Deferred | Reason |
| --- | --- |
| 10-coupon §8.12 product/category eligibility *(enforcement)* | §8.12 explicitly makes it "optional to implement in the first release"; schema and join tables are built (spec 10), enforcement is skipped and the admin controls hidden, exactly as §8.12 instructs. |
| 10-coupon §8.13 `SPECIFIC_CUSTOMER` eligibility *(enforcement)* | §8.13 calls it "optional/future scope"; modelled, not enforced (spec 10). |
| 07-state-machine §5.21.7 post-delivery returns / RMA | §5.21.7: "There is no `DELIVERED → RETURNED` state transition in v1." |
| 08-analytics §6.3 reversal/refund events | §6.3: "no reversal or refund event is sent… This is an accepted scoping decision." |
| 13-cms §13.17 page builder, personalization, A/B testing, multi-language | §13.17's explicit v1 exclusions. |
| 11-security §11.4 CDN/WAF, proxy timeouts; §11.9 backups and restore rehearsal | Both files classify these as infrastructure/deployment requirements, not application code; recorded as a pre-launch checklist in spec 04. |
| 11-security §11.6 upload *scanning* | §11.6 says "re-encoded **or** scanned"; re-encoding is implemented (spec 06), which satisfies the clause for image uploads. |

Nothing else is deferred. Ten section numbers are not cited verbatim by any spec, because they carry no independent requirement; each is covered through the section it defers to:

| Not cited verbatim | Why |
| --- | --- |
| `10-coupon` §8.7, §8.11 | Empty placeholder headings in the PRD itself — §8.7 reads "(reserved — see 8.6)" and §8.11 reads "(see 8.13)". There is nothing to implement. |
| `10-coupon` §8.32 | The PRD's own acceptance-criteria checklist for the coupon feature. Every line is reproduced as a numbered acceptance criterion in spec 10 and, for the order-integration lines, spec 11. |
| `10-coupon` §8.33 | "Explicitly Unchanged" — a list of what the coupon feature must **not** modify. Honoured as a constraint throughout specs 10–12 (the state machine, courier adapters, and RBAC hierarchy are untouched by the coupon work). |
| `05-admin` §5.8a | A one-paragraph pointer placing Coupon Management in the back-office module list; it states outright that it "does not duplicate those rules here." Implemented as spec 10's admin module under Marketing / Discounts. |
| `03-payment` §3.3, §3.11, `04-courier` §4.12, §4.13 | UI-facing narrative diagrams of the status lifecycle (§3.3 labels itself "a UI-facing narrative" and defers explicitly to §5.21; its bKash/COD confirmation paths are implemented across specs 11, 12, and 13). `01-overview`'s closing note designates `07-state-machine` §5.21 as the sole enforced source for these values, and spec 12 implements §5.21 directly — per the `test` skill, tests are written against §5.21, not against these diagrams. |

---

## Conflicts and gaps flagged during specification

Each is recorded in the "Open questions / assumptions" section of the spec that hit it, except #3, which has been corrected in the PRD itself and is therefore closed at the source. **All six are now resolved — none blocks the build.** Each resolution is specified in implementable detail; what remains for the client is business input (rates, thresholds), not a design decision.

1. **Shipping-fee computation is undefined anywhere in the PRDs** — **RESOLVED: spec 21.** A shipping charge is added to the total in §8.14c, which notes there is no existing rule to change; it affects every order total, the bKash amount, and the COD amount (§8.16a, §8.16b). Given its own slice: an admin-managed zone/rate table (district + metropolitan discriminator), free-shipping threshold support, and `computeShipping()` as the sole authority, called by 11 after the discount is final. *Client input needed:* the actual rates — configuration, not code.
2. **No SMS provider exists in the fixed stack** — **RESOLVED: spec 08**, and v1 ships complete without one. §2.9.8 offers Order-Number verification as an explicit equal alternative to phone OTP, so the guest-claim flow is fully specified. §2.6 delegates to "the system's verification rules," which are now defined: password re-authentication + email OTP, and where no email exists the change is an audited Admin action rather than an unverified self-service one. `OtpChannel` leaves `SmsOtpChannel` as a drop-in. *Optional client decision:* buying SMS would improve UX; it is not required.
3. **COD cancellation edges were internally inconsistent inside the authoritative file** — **CLOSED: the PRD has been amended.** Two *reciprocal* drafting slips, not one: the COD table in §5.21.3 omitted `CONFIRMED → CANCELLED`, while the COD diagram in §5.21.8 omitted `PROCESSING → CANCELLED`. Both edges are stated method-neutrally in §5.21.7 and §5.21.9, and `05-admin` §5.1's stock-restoration rule corroborates independently. `07-order-state-machine.md` has since been corrected — both edges added, all four COD renderings now agree — so spec 12 transcribes §5.21 directly rather than reconciling it. Both edges are allowed for COD, matching bKash; no behavioural change resulted.
4. **The `ON_SALE` rule in §13.5 assumes a product-level discount concept that §8 and §13.17 do not provide** — **RESOLVED: spec 17**, and the rule is functional in v1. Resolved as the union of products with `compare_at_price > base_price` — already required by §13.9 as the ProductCard's visible discount indicator, and computing no money, so not the "second discount engine" that §13.17 forbids — and products under a product/category-restricted active coupon, which widens automatically if §8.12 ships. The earlier resolution returned an always-empty carousel.
5. **§4.14.4's honest "not available yet" message tensions with §4.16's absolute non-enumeration rule** (spec 15). Resolved narrowly: the honest message only for a real store Order Number with no shipment, where no order detail is disclosed; everything else generic. *(Unchanged — already a sound resolution.)*
6. **"Failed orders" in §5.9 has no corresponding order status in §5.21** (spec 20). Reported as failed *shipments* rather than inventing an enum value. *(Unchanged — already a sound resolution.)*

Two further gaps found and resolved during the coverage audit:

7. **No Admin password recovery** — **RESOLVED: spec 03.** §2.5's flow is customer-and-email-only and §5.12.3 makes the seeded Admin non-deletable, so a forgotten password would leave the platform unadministrable. Specified as `npm run admin:reset-password`: a server-side CLI (never an HTTP endpoint), scoped to `is_system_admin`, forcing a change at next login, revoking all sessions, and writing an `OUT_OF_BAND_ADMIN_RESET` audit entry. Adds no permission key, role or UI.
8. **Coupon rounding mode unspecified** (§8.14a) — **RESOLVED: spec 10.** Half-up, 2 decimals, decimal arithmetic, applied in exactly one function so the preview and the placement revalidation (§8.15a, §8.15b) cannot disagree by a taka; the discount is rounded, not the total, so the structural `CHECK` in spec 11 cannot fail on an artefact.

Three smaller conflicts, resolved in favour of the requirement files per CLAUDE.md §1: the design system implies a **product rating/review feature no PRD defines** (specs 05, 07 — omitted); the `seo` skill would exclude out-of-stock products from the sitemap while the PRDs treat out-of-stock as a transient state of a live product (spec 07 — included, Inactive excluded instead); and the `backend`/`security` skills refer to a **risk-check cache TTL that §7.6 never documents** (spec 16 — no automatic expiry, since §7.2 forbids automatic checks).
