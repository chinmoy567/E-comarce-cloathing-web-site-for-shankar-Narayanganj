# Coverage Map — Fabrillke

What must be tested, by risk area (Part 1) and by implementation spec (Part 2).

A slice's own `## Tests required` and `## Acceptance criteria` lists in `.claude/implementation specs/NN-*.md` are the contract — read them in full. This file adds the cross-slice checklists and, per spec, the items most often skipped or done wrong. `R#` refers to `recipes.md`.

The build order is **01–10, 21, 11–20**: spec 21 (shipping) is built before 11, which calls it.

---

## Part 1 — By risk area

### 1. Order / payment / shipment state machine — tier 1

Read `07-order-state-machine.md` §5.21 in full first. Specs 11 (initial states), 12 (the service), 13 (panel actions), 14 (shipment creation) and 15 (sync) each test a part of it. Harness: R10.

- **Initial triples** (spec 11): bKash is `PENDING_CONFIRMATION` / `PENDING_VERIFICATION` / `NOT_CREATED`; COD is `COD_VERIFICATION_PENDING` / `PENDING_COLLECTION` / `NOT_CREATED`. Three history rows are written at creation.
- **Edges**: every valid edge is one named case, and the method-specific complement is invalid. Terminal states are closed; there is no `DELIVERED → RETURNED` in v1.
- **Status independence** for all three kinds (§5.21.11). This is the rule most likely to be silently violated by a refactor that "simplifies" status handling.
- **bKash rejection/resubmission loop** (§5.21.2), over repeated cycles:
  - the order stays `PENDING_CONFIRMATION` and is never auto-cancelled;
  - every submission is retained;
  - the rejection reason, timestamp and rejecting user are stored.
- **No cascade from failure** (§5.21.5, §5.21.6):
  - shipment `CREATION_FAILED` never rejects a verified payment or cancels a confirmed order;
  - `DELIVERY_FAILED` leaves the order `PROCESSING`.

  Write this regression test explicitly — `backend-builder` names the anti-pattern.
- **Atomic cascades** (§5.21.4, §5.21.6): shipment `DELIVERED`/`RETURNED` moves the order in the same transaction. A forced failure leaves both unchanged (R3).
- **Stock** (§5.1):
  - decremented at `CONFIRMED` — not at placement, not at add-to-cart;
  - restored on `CANCELLED`/`RETURNED` from `CONFIRMED` or `PROCESSING`, and never from pre-`CONFIRMED` states;
  - insufficient stock blocks confirmation with a named shortfall;
  - concurrent confirms decrement once.
- **Coupon usage** is recorded at creation and never restored — not on payment rejection, cancel, or return (§8.26, §8.27).
- **Cancellation with a live shipment** (§5.21.7): the courier's Cancel Shipment is called. Cancellation is blocked or escalated when the courier can't cancel, and fails closed when no cancellation port exists.
- **COD discrepancy** (§5.21.3) is computed, not stored. Manual resolution to `PAID_COLLECTED` or `REJECTED` keeps `DELIVERED`.
- **Authorization and enforcement**: the §5.21.9 permission and the actor type (user vs system) are both enforced. Direct status writes are blocked by a trigger (S3).
- **Courier sync is idempotent**, for both duplicate and out-of-order updates (§4.6; R11).
- **History row per transition**: previous, new, timestamp, actor, and reason where applicable (§5.21.11).
- **`Purchase` fires exactly once on `CONFIRMED`** (§6.3; R13), and guest and registered orders behave identically.

### 2. RBAC — tier 2

Read `06-rbac.md` §5.10–5.19; the §5.18 matrix is authoritative, and §5.16 maps actions to keys. Harness: R9.

- **Matrix rows**: every §5.18 row (47) × {Admin, Manager} × tier. `ASSIGNED` rows are tested ungranted → granted → revoked.
- **Hierarchy — Manager actions refused** (each attempt its own test):
  - **Manager vs the Admin** (§5.11): delete, modify, deactivate, or change the Admin's permissions.
  - **Manager vs another Manager** (§5.11, §5.14 rule 2): create, update, delete, or set permissions.
- **Self-escalation ban** (§5.15 rules 4, 7), at creation and at later change. No API accepts a `role` field: a body carrying one is rejected (spec 03 acceptance 16).
- **Grantor cannot exceed own permissions** (§5.15 rule 6): the grant call itself fails, and no `user_permissions` row is written.
- **Protected system Admin** (§5.12.3) is refused through every Manager-management endpoint, including when the caller is an Admin. The data-layer halves already exist: `schema.identity.test.ts` (single `is_system_admin`) and `users.repository.test.ts` (`create` can't mint one).
- **Idempotent Admin seed** (§5.12.2): run it twice, and concurrently → one Admin, no error.
- **Role enum at the data layer** (§5.19): exists in `schema.identity.test.ts` and `enums.parity.test.ts`.
- **`courier.manage` ≠ `courier.select`** (§5.16): the seed level exists in `permissions.seed.test.ts`; route level is in spec 03 test 8 and spec 14 test 15.
- **Stray `NO`-tier grant**: a row inserted directly is ignored by effective-permission resolution (spec 03 test 14).
- **Session scope** (§2.4): a customer token is rejected on `/api/admin/*`, and vice versa.
- **Session security**: login non-enumeration (§11.2); refresh rotation with reuse detection that revokes the chain (§11.7); password change invalidates sessions.
- **Audit** on every grant, revoke, create, delete and role change (§5.15 rule 10).
- **Frontend hiding is not a boundary** (§5.15, §5.17). Call the highest-risk endpoints directly with `supertest` as an unauthorized actor: payment verify/reject, order confirm/cancel, Manager create/delete, permission assign.

### 3. Money — coupons, cart pricing, shipping, totals — tier 3

Read `10-coupon-discount.md` §8, especially §8.14–8.16 and §8.25–8.27. Money assertions: R5.

**Server authority, end to end** — every money field the client could send is rejected, never trusted:
- The cart stores no prices and rejects client price fields (spec 09).
- `validate` rejects a client subtotal or discount (§8.16).
- Checkout rejects every money field (spec 11 test 14).
- Shipping comes only from `computeShipping()` (spec 21).

**Calculation and boundaries**
- §8.14a/b/c with the worked examples and the rounding case (R5).
- §8.10: exactly at the minimum order passes, one taka below fails with the exact message; the cap is tested at and above.
- **Validation order** (§8.6): a coupon failing several checks returns the earliest check's message. One test per adjacent pair (spec 10 test 6).

**Lifecycle and eligibility**
- **Lifecycle** (§8.6): `DRAFT`, `DISABLED`, archived, expired, and not-yet-started are each rejected with their §8.22 message. Nonexistent, disabled and archived codes are indistinguishable (§8.22, §8.28; R7).
- **Customer eligibility** (§8.13): `ALL_CUSTOMERS` works for a guest. `REGISTERED_CUSTOMERS_ONLY` rejects a guest with the specific "registered customers" message and accepts a registered customer.
- **Deferred in v1 — never test as enforced**: §8.12 product/category eligibility (schema only; validation skips step 6; admin controls hidden) and §8.13 `SPECIFIC_CUSTOMER`. Every coupon behaves as `ALL_PRODUCTS`. Check spec 10 for exactly what was built.

**Usage limits and concurrency**
- **Usage limits** (§8.8): total and per-customer. Per-customer is keyed by `customer_id` for registered customers and by the phone-keyed customer reference for guests. A different guest phone is unaffected — the accepted residual risk (§8.28).
- **Concurrency** (§8.25; R1):
  - last redemption → exactly one order, one usage row, counter at the limit;
  - per-customer limit 1 with two concurrent orders → exactly one succeeds.
- **Preview writes nothing** (§8.15a): `usage_count` and `coupon_usages` are unchanged after a valid preview.

**Placement and snapshots**
- **Mandatory revalidation at placement (§8.15b) — the highest-value test in this area.** Apply the coupon at preview, then:
  - (a) mutate the cart;
  - (b) disable the coupon;
  - (c) expire it;
  - (d) exhaust its limit;
  - (e) submit a tampered discount in the body.

  Each case must recompute or fail; none may create an order at a wrong price (spec 11 test 9). Simulate a malicious client with a hand-edited body, not a well-behaved one.
- **One coupon per order** (§8.17): a second code replaces the first only after passing full §8.6 validation. An invalid replacement is rejected, not swapped in.
- **Code rules** (§8.4a/b): case and whitespace variants resolve to one coupon, and the database rejects duplicates under any casing. A fixed-amount coupon can't carry a maximum — rejected by the API and by the `CHECK`.
- **Delete vs archive** (§8.9): an unused coupon is deleted, a used one archived. An archived coupon fails validation whatever its `status`.
- **Snapshots are immutable** (§8.23): editing or archiving the coupon later leaves the order's discount fields unchanged. The same holds for the address snapshot and the shipping amount (spec 11 test 20, spec 21 test 5).
- **Totals and amounts** (§8.15c, §8.16a/b): `total = subtotal − discount + shipping`, enforced by a `CHECK`. bKash `amount_due` and the COD amount equal `total_amount`. The courier receives the discounted total for COD and 0 for prepaid (spec 14 test 9).

**Controls**
- Server time only (§8.5; R4).
- The rate-limit pair on validate (§8.28; R8).
- Permission rows (§8.19) with `ASSIGNED` both ways.
- Audit on create, update, status change and delete.

### 4. Abuse resistance — tier 4

Read `11-security-hardening.md`, `02-customer.md` §2.5/§2.9, and `09-fraud-risk-check.md`.

**Rate limits** (§11.2, §11.3), per limiter (R8): the pair, composite keying, `Retry-After`, identical 429 bodies, no partial write, hashed identifier in the rejection record, and thresholds configurable by env.

**Customer auth and OTP** (§2.5, §2.9.8):
- **OTP rules**:
  - expiry after 10 min (backdate the row; R4);
  - single use;
  - the 4th request in 15 minutes issues no code but returns the same response;
  - after 5 wrong attempts the code is invalidated, so even the right code then fails;
  - codes are hashed at rest.
- **Non-enumeration** on every surface (R7).
- **Guest records**: a guest record can't log in, and registration can't absorb one.
- **Guest claim** (§2.9.8 step 5): it requires phone verification and rejects an Order Number that belongs to a different phone — the hijack the PRD names. The claim is atomic (R3).
- **Profile completeness** (§2.2): one assertion per required field.

**Uploads** (§11.6; spec 06):
- Content sniffing beats both the extension and the declared type (a PHP file named `.png`, HTML named `.jpg`, a JPEG declared `image/gif`).
- SVG and HTML are never accepted.
- Each upload route has its own size cap, while the global 100 kb limit still holds elsewhere.
- Re-encoding strips EXIF GPS.
- `../` and null bytes in a filename never reach the stored path.
- Private-bucket objects are not anonymously readable.
- Signed URLs need the mapped permission and expire.
- No orphans in either failure direction (R3 option B).

**Public lookups** (§2.9.5–2.9.7, §4.14–4.16): Track Order and guest lookup are non-enumerating (R7), return exact key sets (R6), and use separate limiters. Guest lookup requires both values and normalizes the phone. An Order Number is not a credential.

**Risk check** (§7). There is **no cache TTL**: the latest `customer_risk_checks` row is reused until an Admin/Manager explicitly re-checks (§7.6). Spec 16 resolved the TTL that the `backend`/`security` skills mention as nonexistent — never test expiry.
- **Caching**:
  - opening the order page / `GET` makes zero provider calls; `POST` makes exactly one;
  - the cache key is `customer_id`, not `order_id` — order B shows order A's check with no new call.
- **Status gate** (§7.2): enforced server-side, one test per allowed and per disallowed status.
- **Failures** (§7.8):
  - timeout and 500 → `CHECK_FAILED`, with order statuses untouched;
  - empty history → `UNKNOWN`, never high-risk;
  - absent fields stay `null`, not `0`;
  - an unknown band → `UNKNOWN`, and logged.
- **Data handling**:
  - `raw_result` never leaves the backend (key set);
  - outbound carries only the normalized phone (§7.9);
  - risk data is absent from every customer-facing projection.
- **Controls**: the limiter is per customer; the `customer.risk.check` permission; guest parity; an audit row; no status side effects.

**Injection and input** (§11.6):
- `.strict()` rejects unknown fields (exists: `app.test.ts`).
- Search terms with quotes, `%`, `--` and tsquery operators are bound as parameters.
- Sort keys come from an allowlist.
- HTML is sanitized: script tags, event handlers, `javascript:` URLs.
- The SSRF guard rejects private, loopback, link-local and non-allowlisted hosts, and does not follow an off-allowlist redirect.
- Reflected search terms render as text.

**Webhooks** (§11.8): an invalid signature processes nothing.

**Every `security-reviewer` finding** gets a regression test named after the finding.

### 5. Standard coverage — tier 5

- **Catalogue** (spec 05):
  - Active/Inactive and Featured are independent;
  - out-of-stock is derived, never stored;
  - slugs are stable and unique under concurrency;
  - deletion guards; description sanitization; audit on price and stock changes; a distinct permission per concern.
- **Storefront and SEO** (spec 07):
  - **Visibility**: each visibility leak path is tested separately; hidden returns 404, never 403.
  - **Payload**: exact key sets for `PublicProductSummary` and `PublicProductDetail`.
  - **URLs**: slug 301; one canonical on the configured domain via `absoluteUrl()` from `site.ts`, with products canonical at `/p/[slug]` even when reached through a category path.
  - **Metadata**: per-entity metadata differs; JSON-LD matches the visible price and availability; titles come from `pageTitle()` → `<Page> | Fabrillke`.
  - **Crawling**: the sitemap excludes Inactive products but keeps out-of-stock ones; robots disallows `/admin` and `/api`.
- **CMS** (spec 17):
  - **Visibility**: evaluated per state against the server clock, with `DISABLED` overriding an open window; preview isolation is the highest-value test.
  - **Input**: URL validation; sanitization; a constrained `visual_theme`; `section_type` immutable at both API and DB.
  - **Content**: atomic reorder; the `ON_SALE` rules (spec 17 test 7a); no duplicated catalogue data; the homepage product key set equals spec 07's.
- **Meta** (spec 18):
  - **`Purchase`**: timing per R13; cannot be client-initiated.
  - **Events and values**: shared `event_id` between Pixel and CAPI; discounted values; a client-submitted value is rejected; a closed seven-name taxonomy; currency `BDT`.
  - **Data**: hashing with Meta's normalization; a prohibited-data key set.
  - **Delivery**: one outbound attempt; missing config → `SKIPPED`.
- **WhatsApp** (spec 19):
  - **Link builder** (pure function): the exact template, clean omissions, an `encodeURIComponent` round trip including Bangla, and the canonical URL.
  - **Config**: fails closed when the number is unset, empty, whitespace, or malformed.
  - **Markup** via `renderToStaticMarkup` (SKILL A.1): stock-driven button pairing; `<a target="_blank" rel="noopener noreferrer">`; no `window.open`; no customer data.
  - **Scans**: single source and no backend footprint (R14).
- **Reports** (spec 20):
  - **Figures**: revenue recognition per status (delivered = revenue; pending/confirmed/processing = pipeline; cancelled/returned = neither); discounted amounts; status buckets that match the enums.
  - **Access**: `analytics.view` both ways; no PII, by key set, across every report; bounded date ranges; a sort-key allowlist.
  - **Export**: asynchronous, with a private, scoped, expiring URL; equal to the on-screen report.
  - **Integrity**: rollups are idempotent. **Reports perform no writes** — checksum each business table before and after with `SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM <table> t`.

---

## Part 2 — By implementation spec

Each entry gives the dominant shapes (SKILL A.3), the recipes, and then the **traps**: items that are easy to skip, or that pass while testing the wrong thing. Schema literals are `specNN_<area>`.

**01 Foundation** — S4, plus S3 for migrations. Suites exist: `app.test.ts`, `env.test.ts`, `pagination.test.ts`, `migrate.test.ts`, `health.repository.test.ts`, `frontend/tests/apiClient.test.ts`.
Traps:
- Test 2's "does not start listening" half is untested: `env.test.ts` covers parsing only. It needs a child process — run `src/server.ts` via `tsx` with a required variable unset, then assert exit code 1, the variable named on stderr, and no `API listening` line.

**02 Core schema** — S3 + S1; all ten required tests are in `vitest.spec02.config.ts`. These are the reference suites for S1 and S3.

**Geography** (migration 0003; pre-work for 08/14) — `test:spec08geo` runs `geography.repository.test.ts`, `geography.api.test.ts` and `courierLocationMapping.test.ts`, which use the legacy idiom (SKILL A.3). ADM4 union/ward is skipped by design: no authoritative dataset exists.

**03 Admin auth, RBAC, Manager accounts** — S2 + S1; recipes R9, R7, R1, R11, R15.
Traps:
- **Status codes are specific** (acceptance criteria):
  - the system Admin's id on Manager endpoints → **404** with the row unchanged;
  - `PERMISSION_NOT_ASSIGNABLE` (400) for `YES`/`NO` rows;
  - `CANNOT_GRANT_UNHELD_PERMISSION` (403), with no row written;
  - `CANNOT_MODIFY_SELF` (403);
  - `PASSWORD_CHANGE_REQUIRED` (403);
  - `CSRF_FAILED` (403);
  - customer token on `/api/admin/*` → **401**.
- Admin login bodies are byte-identical for a wrong password and an unknown identifier.
- The seed runs twice and concurrently.
- A reused refresh token revokes the chain.
- `npm run admin:reset-password` is a CLI, not an endpoint. Test the script's function directly: it is scoped to `is_system_admin`, forces a password change, revokes sessions, and writes an `OUT_OF_BAND_ADMIN_RESET` audit row. Also assert that no HTTP route exposes it.
- Move MATRIX to `tests/helpers/rbacMatrix.ts`.

**04 Rate limiting & hardening** — S2 + S4; recipes R8, R7, R12 (SSRF).
Traps:
- **Limiters**: lower thresholds via env; test keying three ways. `X-Forwarded-For` is trusted only with `TRUST_PROXY_HOPS` — test both settings. The limiters mounted here — `adminLogin`, `authenticatedCeiling`, `publicCeiling` — each need the pair; later slices add pairs for their own limiters.
- **Rejections**: a 429 writes no business row, and the rejection record holds the identifier hashed.
- **Headers**: HSTS is production-only in `createApp()`, so assert it on an app built with `NODE_ENV=production` and assert its absence otherwise.
- **Registries**:
  - the pagination registry proves no route returns an unbounded array;
  - the memory store plus `NODE_ENV=production` logs a warning (acceptance 8).

**05 Catalogue** — S1 + S3 + S2; recipes R1, R2, R3, R9, R6.
Traps:
- **Stock**:
  - last-unit concurrency never goes negative;
  - multi-line decrements are all-or-nothing;
  - the opposite-order deadlock loop (R2);
  - the negative-stock `CHECK` is asserted at the data layer;
  - out-of-stock has no column, and the flag flips with stock alone.
- Every Active/Featured combination is storable, but only Active+Featured appears in featured queries.
- The distinct-permission check is done per spec 05 test 9.
- Concurrent creates with the same name get distinct slugs.

**06 Storage & uploads** — S2 + the gated live-Storage suite; recipes R3 (option B), R4, R9, R1.
Traps:
- **Fixtures**: image fixtures are real bytes — generated in-test, or committed under `tests/fixtures/images/` with provenance — including a JPEG carrying EXIF GPS.
- **Bucket isolation**: objects go under a unique prefix, cleaned up in `afterAll`.
- **Access**:
  - a signed URL returns 401 unauthenticated, 403 without the permission, and fails after its TTL;
  - an unmapped object type fails closed.
- **Integrity**: exactly one primary image under concurrency; reorder is total and atomic; deleting a product cascades to its objects.

**07 Storefront & SEO** — S2 + frontend S4 (pure builders, `renderToStaticMarkup`); recipes R6, R8, R14.
Traps:
- Each visibility path × each surface (list, search, detail, sitemap) is its own test.
- Hidden returns 404, identical to a nonexistent id.
- Public projections are guarded by exact key sets, never `toMatchSnapshot`.
- The sitemap includes out-of-stock products.
- The canonical is `/p/[slug]` on `SITE_URL`.
- The shared `<ProductCard />` is checked with a scan or markup test.
- Public ceiling pair: under the limit succeeds, over it returns 429.

**08 Customer accounts** — S2 + S1; recipes R4, R7, R1, R3, R8.
Traps:
- **OTP**:
  - expiry is DB time — backdate the row;
  - the 4th request creates no new code row;
  - after 5 wrong attempts even the correct code fails;
  - no plaintext code exists in the database.
- **Accounts and claims**:
  - three separate non-enumeration surfaces;
  - concurrent registrations → exactly one account;
  - claim hijack with another phone's Order Number is rejected;
  - claim atomicity.
- **Profile**: completeness is asserted per field, with email and postal code optional.
- **Phone change**:
  - requires re-authentication;
  - collides with any customer record, guest or registered;
  - with no email on file, self-service returns 409 `NO_VERIFICATION_CHANNEL`; the Admin path is audited;
  - `phone_verified_at` is cleared.
- **Limiters**: pairs for `registration`, `customerLogin`, `otpRequest` and `otpVerify`.

**09 Cart & wishlist** — S2 + S1 + S3; recipes R5, R1, R3, R6.
Traps:
- **Pricing**:
  - client price fields → 400, not silently ignored;
  - no price column on `cart_items` (check `information_schema`);
  - variant price precedence;
  - the `1299.99 × 3` decimal case;
  - `resolveCartForPricing` agrees with `GET /api/cart`;
  - out-of-stock add reserves nothing.
- **Integrity**:
  - a concurrent double add → one row;
  - quantity bounds 0 and 100 rejected by both app and DB;
  - one active cart per customer under concurrency;
  - merge is atomic — a forced failure leaves the anonymous cart intact.
- **Privacy and isolation**:
  - hidden products return 404, identical to nonexistent;
  - anonymous carts are isolated, and a forged token yields an empty cart;
  - cart tables have no PII columns.

**10 Coupon engine** — S1 + S2 + S3; recipes R5, R1, R7, R4, R9, R8.
Traps: Part 1 §3 in full, especially:
- validation-order pairs;
- §8.22 message identity;
- the non-enumeration trio;
- guest per-customer limits keyed by phone;
- last-use and per-customer concurrency;
- preview writes nothing;
- a client `now` is rejected;
- §8.12 and `SPECIFIC_CUSTOMER` are not enforced in v1.

**21 Shipping fee** (built before 11) — S1 + S3 + S2; recipes R5, R1, R4.
Traps:
- **Zones**: unmapped district → default zone; district matching is case-insensitive.
- **Strategies**: each strategy, with `FREE_OVER_THRESHOLD` tested at exactly the threshold.
- **Ordering**:
  - the discount is applied before shipping;
  - shipping stays out of `eligible_subtotal`;
  - shipping can't make a coupon qualify.
- **Stability**:
  - a rate change after placement leaves the order unchanged;
  - two calls in one transaction agree (`now()` is fixed);
  - a concurrent rate insert can't produce an order that violates the total `CHECK`.
- **Controls**:
  - `.strict()` rejects client shipping and total fields;
  - `system.configure` is required on every admin write;
  - a second default zone is rejected structurally.

**11 Checkout & order creation** — S1 + S2 + S3; recipes R3 (one case per transaction step), R1, R10, R5, R7, R11.
Traps:
- **Creation**:
  - the initial triple per method, with three history rows;
  - three separate idempotency cases;
  - a forced failure at each transaction step leaves nothing;
  - guest validation-order pairs;
  - the profile gate is enforced server-side;
  - a guest reference is reused without overwriting a registered profile;
  - the cart becomes `CONVERTED`.
- **Money**:
  - revalidation cases (a)–(e) with tampered bodies;
  - last-redemption concurrency;
  - the total `CHECK`;
  - amounts equal the total;
  - every money field is rejected;
  - prices are re-read at placement;
  - **no stock movement at placement**.
- **Snapshots**: the coupon and address snapshots are immutable.
- **Payment**:
  - the Transaction ID is unique across orders, casing- and whitespace-insensitive, at API and DB;
  - the resubmission loop is repeated;
  - a customer can't set payment status;
  - an Order Number with the wrong phone looks exactly like an unknown one.

**12 State machine** — S1 + S3 (the trigger); recipes R10, R3, R13, R1.
Traps: Part 1 §1 in full, especially:
- invalid transitions as the full complement;
- `driveTo` through the service (the trigger blocks direct writes);
- atomic cascades and the no-cascade regressions;
- stock restored only from `CONFIRMED`/`PROCESSING`;
- actor type enforced in both directions;
- a throwing subscriber never rolls back a transition;
- the cancel port fails closed.

**13 Admin order panel** — S2; recipes R10, R9, R1, R6, R4.
Traps:
- **bKash confirm before verification is rejected** — the slice's most important rule.
- Rejection doesn't cancel, and resubmission stays possible.
- COD confirm needs no verification.
- Method mismatch is rejected in both directions.
- **Stock through the panel**: confirm decrements; cancel after confirm restores; cancel before confirm restores nothing; insufficient stock names the shortfall.
- A double-click gives one success and one `INVALID_TRANSITION`, with stock moved once.
- The `PATCH` whitelist rejects status, amounts, coupon, and line items.
- A reason is required to reject or cancel.
- No auto-cancellation when the clock passes the stale threshold.
- Payment fields are absent without `payment.view`.
- Customer history spans guest and registered orders.

**14 Courier abstraction** — S1 + S2 + a contract suite; recipes R12, R1, R3, R6, R9.
Traps:
- **Creation**:
  - a concurrent create makes exactly one adapter call (the `CREATING` lock);
  - create from `CREATED` makes no adapter call;
  - a timeout is followed by no automatic retry;
  - retry is allowed only from `CREATION_FAILED`.
- **Gating and amounts**:
  - bKash creation is blocked until `PAID_VERIFIED` + `CONFIRMED`;
  - the courier receives discounted amounts.
- **Provider boundary**:
  - an unknown provider status is ignored, not guessed;
  - no provider keys escape the service (key set);
  - the registry is data-driven.
- **Permissions**: `courier.select` and `courier.manage` are separate; `shipment.create`, `shipment.retry` and `shipment.courier.change` are each checked on their own route.
- **Data hygiene**:
  - secrets never appear in responses or logs;
  - `courier_requests` rows carry no PII;
  - address mapping keeps both discriminators.
- **Fixtures** come only from official docs or sandbox recordings.

**15 Status sync, Track Order, guest lookup** — S2 + S1; recipes R11, R7, R6, R8, R3, R12.
Traps:
- **Sync**:
  - duplicate and out-of-order updates;
  - webhook and polling converge;
  - an invalid signature processes nothing;
  - cascades are atomic under a forced failure;
  - a delivered COD order stays `PENDING_COLLECTION`.
- **Track Order**:
  - non-enumeration across unknown, foreign, and malformed-but-valid-shaped ids;
  - no fabricated tracking before a shipment exists;
  - no order-status value in the payload.
- **Guest lookup and history**:
  - both values are required;
  - account orders are scoped to their owner;
  - claimed guest orders appear.
- **Both public endpoints**: key sets; separate limiters.
- **Courier refresh caching**: this cache *does* have a TTL (spec 15 test 18) — within it, one provider call.

**16 Risk check** — S2 + S1; recipes R12, R6, R8, R9. Traps: Part 1 §4 "Risk check" in full.

**17 CMS homepage** — S2 + S1 + S3 + frontend markup; recipes R4, R3, R6, R9, R14.
Traps:
- **Visibility**:
  - evaluated with server time, one test per campaign non-visible state;
  - an empty carousel is dropped;
  - automatic rules exclude Inactive and out-of-stock products, while manual selection keeps out-of-stock ones with a badge.
- **`ON_SALE`** (spec 17 test 7a): the carousel is non-empty under ordinary catalogue data.
- **Validation**:
  - `content_config` is strict per section type;
  - `section_type` is immutable at API and DB.
- **Preview isolation**: the public endpoint has no parameter that reaches unpublished content.
- **Permissions**: `cms.manage` is tested both ways, including on preview.
- **Rendering**:
  - the homepage product key set equals spec 07's;
  - image fallback works at both breakpoints.

**18 Meta Pixel & CAPI** — S1 + S2; recipes R13, R12, R6, R5. Traps: Part 1 §5 "Meta", plus a re-confirm attempt (an invalid transition) sends nothing, and the homepage does not double-fire content views.

**19 WhatsApp** — frontend S4 + `renderToStaticMarkup` + R14.
Traps:
- **Template**: size-only and colour-only omissions are separate tests.
- **Encoding**: the round trip covers `&`, `#`, `?`, quotes, and Bangla.
- **URL**: canonical even when the page has query parameters.
- **Validation**: number validation runs once, not per call.
- **Privacy**: no customer field appears in the message, even with a logged-in session.

**20 Analytics & reports** — S2 + S1; recipes R6, R9, R5, R11.
Traps:
- One revenue-recognition test per status.
- Table checksums prove no writes.
- The export equals the on-screen report.
- A late cancellation is reflected on the next rollup refresh.
- Courier grouping is registry-driven.
