# Test Recipes — Fabrillke

Techniques for the claims this project's specs keep asking for. Every recipe keeps the database real (`SKILL.md` B.3). Code is a skeleton: table, route, and function names are **illustrative**. Read the migration and the module under test first, and use their real names and error codes.

| # | Recipe | Typical specs |
| --- | --- | --- |
| R1 | Concurrency — exactly one winner | 02, 05, 08, 09, 10, 11, 13, 14 |
| R2 | Deadlock-free lock ordering | 05 |
| R3 | Atomicity — injecting a failure into a real transaction | 05, 06, 08, 09, 11, 12, 15 |
| R4 | Time — server clock, expiry, windows | 06, 08, 10, 13, 17 |
| R5 | Money — exact decimals and the PRD's worked examples | 09, 10, 11, 18, 20, 21 |
| R6 | Leak guards — exact key sets | 07, 15, 16, 17, 18, 20 |
| R7 | Non-enumeration — indistinguishable responses | 03, 04, 08, 10, 11, 15 |
| R8 | Rate limits — the under/over pair, keying, `Retry-After` | 04, 07, 08, 10, 15, 16 |
| R9 | RBAC matrix harness | 03, 05, 06, 10, 13, 14, 16, 17, 20, 21 |
| R10 | State-machine harness | 11, 12, 13, 14, 15 |
| R11 | Idempotency and replay | 03, 11, 14, 15, 20 |
| R12 | External providers — boundary stubs and recorded fixtures | 14, 15, 16, 18 |
| R13 | Post-commit side effects and failure isolation | 12, 18 |
| R14 | Source-scan architecture invariants | 01, 07, 12, 18, 19 |
| R15 | Compile-time negative tests | any |
| R16 | Log and error-message hygiene | 01, 04, 14, 16 |
| R17 | Keeping transcribed oracles and enum mirrors in step | 02, 03, 12 |
| R18 | Sabotage check — proving a test can fail | tiers 1–2 |

Useful SQLSTATEs (`err.code` from `pg`): `23505` unique violation, `23503` foreign key, `23514` check, `22P02` invalid enum/text input, `40P01` deadlock, `40001` serialization failure, `55P03` lock not available.

---

## R1 Concurrency — exactly one winner

```ts
const results = await Promise.allSettled([
  checkout.placeOrder(orderInput({ couponCode: 'LASTONE' })),
  checkout.placeOrder(orderInput({ couponCode: 'LASTONE', phone: '01812345678' })),
]);
const won = results.filter((r) => r.status === 'fulfilled');
const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

expect(won).toHaveLength(1);
expect(lost[0]!.reason).toMatchObject({ status: 409 }); // the spec's exact code, not just "threw"
// Persisted truth, not just return values:
expect(await count('coupon_usages', couponId)).toBe(1);
expect(await usageCount(couponId)).toBe(1); // never above usage_limit
```

- Use `Promise.allSettled` whenever losers are expected. `Promise.all` rejects on the first failure and hides the other outcomes.
- Fan-out is capped by the pool (`PG_POOL_MAX` is 10 in `applyTestEnv()` and `.env.example`). Keep it ≤ 8 so calls genuinely overlap instead of queueing — `customers.repository.test.ts` uses 8.
- After the race, always assert the database: the counter never exceeds its limit, exactly one row exists, stock never goes negative, and exactly one side effect happened (stock decremented once, one adapter call).

**Deterministic interleaving.** To prove the implementation's locking statement really serializes access, drive two explicit connections instead of hoping `allSettled` interleaves:

```ts
const a = await connect(SCHEMA);
const b = await connect(SCHEMA);
try {
  await a.query('BEGIN');
  await a.query('SELECT stock FROM product_variants WHERE id = $1 FOR UPDATE', [variantId]);
  await b.query('BEGIN');
  await b.query(`SET LOCAL lock_timeout = '500ms'`);
  await expect(
    b.query('SELECT stock FROM product_variants WHERE id = $1 FOR UPDATE', [variantId]),
  ).rejects.toMatchObject({ code: '55P03' }); // B really waited on A's row lock
} finally {
  await a.query('ROLLBACK').catch(() => {});
  await b.query('ROLLBACK').catch(() => {});
  await Promise.all([a.end(), b.end()]);
}
```

Use this to check that the statement the service issues takes the lock it claims to. Don't re-implement the service inside the test.

## R2 Deadlock-free lock ordering (spec 05 test 15)

```ts
it('two decrements over the same variants in opposite order never deadlock (spec 05 test 15)', async () => {
  for (let round = 0; round < 10; round += 1) {
    await resetStock({ [v1]: 5, [v2]: 5 });
    const results = await Promise.allSettled([
      stock.decrementStock([{ variantId: v1, quantity: 1 }, { variantId: v2, quantity: 1 }]),
      stock.decrementStock([{ variantId: v2, quantity: 1 }, { variantId: v1, quantity: 1 }]),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason?.code ?? r.reason?.cause?.code).not.toBe('40P01');
    }
  }
});
```

A deadlock needs an unlucky interleaving, so one pass can succeed by chance. Loop it. This is the test that fails if the implementation's `variant_id` sort is ever dropped.

## R3 Atomicity — injecting a failure into a real transaction

"A forced failure at step N leaves nothing" (spec 11 test 5, spec 08 test 11, spec 09 test 10, spec 15 test 5, spec 12's cascades) needs a failure *inside* the real transaction.

**Option A — database-level (preferred when step N writes a table):** a trigger in the suite's own schema.

```ts
/** `table` and `event` are hard-coded literals from the test — identifiers can't be parameterized. */
async function failWritesTo(table: string, event: 'INSERT' | 'UPDATE' | 'DELETE'): Promise<() => Promise<void>> {
  const c = await connect(SCHEMA);
  await c.query(`
    CREATE OR REPLACE FUNCTION test_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected failure'; END $$;
    CREATE TRIGGER test_injected_failure BEFORE ${event} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION test_injected_failure();`);
  return async () => {
    await c.query(`DROP TRIGGER IF EXISTS test_injected_failure ON ${table}`);
    await c.end();
  };
}

it.each([
  ['orders', 'INSERT'],
  ['coupon_usages', 'INSERT'],
  ['coupons', 'UPDATE'],
] as const)('a failure writing %s (%s) leaves no order, item, usage or cart conversion (spec 11 test 5)', async (table, event) => {
  const before = await snapshotCounts(); // orders, order_items, coupon_usages, carts converted…
  const undo = await failWritesTo(table, event);
  try {
    await expect(checkout.placeOrder(validInput())).rejects.toThrow();
  } finally {
    await undo();
  }
  expect(await snapshotCounts()).toEqual(before);
});
```

- Map each step in the spec's transaction outline to the table and statement it writes. The rows above are placeholders.
- The trigger fires for **every** writer in the schema, including your fixture setup. Arrange first, install the trigger, act, remove it in `finally`. The trigger dies with the schema anyway.
- If the service catches the error internally (a `SAVEPOINT`) and still commits, that is a finding: the test asserts the documented outcome.

**Option B — module-level (for steps that aren't table writes: a courier call, a storage upload, publishing an event):** wrap the real module behind a switch.

```ts
const inject = vi.hoisted(() => ({ fail: false }));

vi.mock('../src/services/storage/storage.service.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/storage/storage.service.js')>();
  return {
    ...real,
    uploadObject: async (...args: Parameters<typeof real.uploadObject>) => {
      if (inject.fail) throw new Error('injected upload failure');
      return real.uploadObject(...args);
    },
  };
});

afterEach(() => {
  inject.fail = false;
});
```

`vi.mock` is hoisted and applies to every importer in the file, including modules loaded later with `await import()` in `beforeAll`. Prefer it over `vi.spyOn(moduleNamespace, …)`, whose behaviour depends on how vitest transformed the module.

## R4 Time — server clock, expiry, windows

First find where "now" is evaluated. Read the implementation.

- **In SQL** (`now()`, `CURRENT_TIMESTAMP`, a `DEFAULT now()` column compared in a query): `vi.setSystemTime` cannot move the database clock. **Backdate the row** through the raw client instead:
  ```ts
  await db.query(`UPDATE otp_codes SET created_at = now() - interval '11 minutes' WHERE id = $1`, [otpId]);
  ```
  `now()` is fixed for the whole transaction, so two reads inside one transaction agree. That is what spec 21 test 7 (determinism) relies on. Use `clock_timestamp()` only if you need time to move within a transaction.
- **In JS** (`new Date()` inside a service): `vi.useFakeTimers({ toFake: ['Date'] })`, `vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))`, and `vi.useRealTimers()` in `afterEach`. Fake only `Date`: faking `setTimeout`/`setImmediate` as well tends to freeze timers that the pool, HTTP layer, and abort timeouts depend on, and the test hangs.
- **Mixed** (JS decides, DB stores): faking only the JS side creates a skew that production never has. Prefer backdating the rows.
- **"Server time only"** (§8.5, §13.7a): a body carrying `now`, `timestamp`, `clientTime`, or similar is rejected with 400 `VALIDATION_ERROR` naming the field (the `.strict()` schema). Then prove behaviour follows the server clock.
- **Boundaries**: test exactly at `starts_at`/`ends_at`/expiry and one unit either side, per the PRD's inclusive/exclusive wording. Read it; don't assume. If the PRD phrases a boundary as a calendar date, check how the implementation maps it to an instant (Bangladesh is UTC+6) and test both sides of that instant.
- **Durations from the PRD** (defaults): OTP expiry 10 min; OTP requests max 3 per account per 15 min; 5 wrong attempts per OTP (§2.5). Signed-URL TTLs and stale-order thresholds come from their spec's configuration. Read the configured value; don't hard-code a guess.

## R5 Money — exact decimals and the PRD's worked examples

- `pg` returns `numeric` **as a string** (and `bigint`/`count(*)` as a string; existing tests cast `::text`). Assert money as exact strings (`'500.00'`) or integer poisha. Never `toBeCloseTo`, never `Number()` compared as a float.
- Rounding is **half-up to 2 decimals, in exactly one function** (spec 10's resolution of §8.14a), so preview and placement revalidation cannot disagree by a taka.

| Case | Expected | Source / why |
| --- | --- | --- |
| 20% of ৳2,500 | discount ৳500.00 | §8.14a example |
| 20% of ৳2,500 with ৳300 cap | discount ৳300.00 | §8.14a example |
| ৳500 fixed on ৳200 subtotal | discount ৳200.00, discounted subtotal ৳0.00 | §8.14b example (clamp) |
| 10% of ৳3,000, shipping ৳100 | discount ৳300.00, total ৳2,800.00 | §8.14c — shipping added after, never discounted |
| ৳3,000 − ৳600 + ৳100 | total ৳2,500.00 | §8.15c composition |
| 7.5% of ৳1,333 | discount ৳99.98 | exact value 99.975 → half-up; `(1333 * 0.075).toFixed(2)` gives `'99.97'` |
| 3 × ৳1,299.99 | line total ৳3,899.97 | `1299.99 * 3` is `3899.9700000000003` in JS (spec 09 test 4) |

- Boundaries (§8.10): exactly at the minimum order passes; one taka below fails with the exact §8.22 message. Test the cap at and above it.
- Total composition (§8.15c, spec 11 test 11): assert every stored component and that the database `CHECK` rejects an inconsistent row inserted directly (S3). `amount_due` for bKash and the COD amount equal `total_amount` (§8.16a/b).
- Shipping (spec 21): the discount applies before shipping; shipping is never part of `eligible_subtotal` and cannot make a coupon qualify (§8.10); `FREE_OVER_THRESHOLD` is tested exactly at the threshold.

## R6 Leak guards — exact key sets

```ts
/** Sorted dotted paths of every leaf, e.g. ['items[].name', 'items[].price', 'total']. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.length ? keyPaths(value[0], `${prefix}[]`) : [prefix];
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      const leaves = keyPaths(child, path);
      return leaves.length ? leaves : [path];
    });
  }
  return prefix ? [prefix] : [];
}

// Transcribed from the spec's projection definition — not from src/.
const TRACK_ORDER_PATHS = ['courier', 'events[].at', 'events[].status', 'shipmentStatus', 'trackingNumber'];

expect(keyPaths(res.body.data).sort()).toEqual([...TRACK_ORDER_PATHS].sort());
expect(JSON.stringify(res.body)).not.toContain(fixture.phoneNumber);
```

- Use exact equality of the sorted paths, so a new field fails the test. A `not.toHaveProperty` list and `toMatchObject` both pass when an unexpected field appears. `toMatchSnapshot()` gets rubber-stamped with `-u`. Use none of these as a leak guard.
- Fill the fixture with non-null values for optional fields, so an absent-because-null key can't hide a leak.
- Add value checks for the specific sensitive fixture values: phone, Transaction ID, `raw_result` marker, admin note text.
- Move `keyPaths` to `tests/helpers/` when a second suite needs it.

## R7 Non-enumeration — indistinguishable responses

```ts
function comparable(res: request.Response) {
  const { requestId: _requestId, ...body } = res.body;
  return { status: res.status, body, retryAfter: res.headers['retry-after'] };
}

const unknown = await request(app).post(LOOKUP).send({ orderNumber: 'ORD-2026-999999', phone: '01711111111' });
const mismatched = await request(app).post(LOOKUP).send({ orderNumber: realOrderNumber, phone: '01822222222' });

expect(comparable(mismatched)).toEqual(comparable(unknown));
```

- Write one test per surface the specs list, because each is an independent leak: forgot-password, login (unknown vs guest vs wrong password), claim-request, coupon validate (nonexistent vs disabled vs archived), Track Order (unknown, foreign, malformed-but-valid-shaped), guest lookup, payment submission with the wrong phone (spec 11 test 22), and 429 bodies.
- Give each case its own rate-limit budget (a different `X-Forwarded-For`, or a fresh app). Otherwise one side gets 429 and the comparison is meaningless.
- Don't assert timing equality (it's flaky). If a spec requires uniform work (e.g. a dummy bcrypt compare for unknown users), test that mechanism instead.

## R8 Rate limits — the under/over pair, keying, `Retry-After`

- Thresholds are env-driven (§11.3; spec 04 mandates "a test-only lowered threshold rather than real-time waits"). Set a small limit (e.g. 2) in `process.env` **before** `resetEnvCache()` and `createApp()`, using the variable names spec 04's implementation reads. Never loop hundreds of requests or wait out a real window.
- **Client IP**: today `createApp()` sets `trust proxy` to 1, so `X-Forwarded-For` is honoured. Spec 04 makes that conditional on `TRUST_PROXY_HOPS` ("a spoofable client header is never trusted as the key"). Set it in the test env for IP-varying tests, and add the inverse test: with it unset, changing `X-Forwarded-For` does **not** reset the budget. Vary RFC 5737 addresses: `request(app).post(url).set('X-Forwarded-For', '203.0.113.7')`.
- **The pair per limiter**: the limit-th request succeeds; the next returns 429 `RATE_LIMITED` with a `Retry-After` consistent with the configured window.
- **Composite keying** (§11.2): one identifier from rotating IPs is still limited; one IP cycling identifiers is still bounded by the IP budget; a second legitimate user behind the same IP isn't locked out by the first user's per-account exhaustion.
- A 429 body is identical for existing and non-existent identifiers (R7). A 429ed request writes no business row (count before/after).
- The rejection is recorded with limiter, endpoint, and IP, and the identifier is **hashed**. Assert the plaintext identifier is absent from the stored row.
- Limiter state lives in the limiter store. Build a fresh `createApp()` (or call the store's reset seam) per test so budgets don't bleed between tests. Independent limiters (Track Order vs guest lookup, §4.16): exhausting one leaves the other usable.

## R9 RBAC matrix harness

- **Oracle**: the §5.18 transcription `MATRIX` lives in `permissions.seed.test.ts`. When a second suite needs it (spec 03 onward), move it with its comment to `tests/helpers/rbacMatrix.ts` and import it from both. The independence that matters is test-vs-src, not test-vs-test; a third copy just drifts.
- **Route table**: map each permission key to a route it gates, transcribed from the spec's route list, e.g. ``{ key: 'order.confirm', method: 'post', path: (id) => `/api/admin/orders/${id}/confirm` }``.
- **Actors**, created once per suite through the real login: Admin; a default Manager (no grants); a Manager granted the one `ASSIGNED` key under test (grant and revoke per test through the real grant path); a customer-scope token; no token.
- **Sessions** (spec 03): admin auth rides on httpOnly cookies (`admin_at`/`admin_rt`), and state-changing requests need `X-CSRF-Token`. Give each actor its own `request.agent(app)` so cookies persist, and read from spec 03 how the CSRF token is issued. Fixture accounts must not be left in `must_change_password`, or every call returns 403 `PASSWORD_CHANGE_REQUIRED`.
- **A denial must be denied for the right reason**: assert the 403's `code`, not just the status. A 403 caused by `PASSWORD_CHANGE_REQUIRED` or `CSRF_FAILED` makes a permission test pass vacuously. Missing CSRF → 403 `CSRF_FAILED` gets its own test per state-changing route family.
- **Per row** (`it.each(Object.entries(MATRIX))`):
  - Admin is allowed.
  - Manager `YES` is allowed.
  - Manager `NO` gets 403 — **even after a `user_permissions` row is inserted directly** at the data layer (spec 03 test 14: stray grants are ignored).
  - Manager `ASSIGNED` gets 403 ungranted, is allowed once granted, and gets 403 again after revoke.
  - "Allowed" means *not* 401/403: `expect([401, 403]).not.toContain(res.status)`. The handler may legitimately 400/404 on a minimal body, so each route also needs one fully valid happy-path test elsewhere.
- Unauthenticated gets 401. A customer-scope token on `/api/admin/*` is rejected with spec 03's status (spec 03 test 11, spec 08 test 12, both directions).
- **Hierarchy rules** (§5.11, §5.14, §5.15 rules 4/6/7, §5.12.3) get one test per attempted action. Assert the response, **and** that nothing changed (no `user_permissions` row, account untouched), **and** the audit row the spec requires. The protected system Admin must be tested through every Manager-management endpoint, including as Admin (spec 03 test 6).
- Never stub `requirePermission`, the session, or token verification — real login, real token.

## R10 State-machine harness

**Transcribe §5.21 into the test as data**: each order edge with its method and its §5.21.9 actor (user or system), plus the payment and shipment edges. Cross-check your transcription against these counts:

| Table | Source | Edges |
| --- | --- | --- |
| bKash order | §5.21.1 | 7 |
| COD order | §5.21.3 | 7 |
| bKash payment | §5.21.2 | 3 (`PENDING_VERIFICATION → REJECTED`, `REJECTED → PENDING_VERIFICATION`, `PENDING_VERIFICATION → PAID_VERIFIED`) |
| COD payment | §5.21.3 | 2 (`PENDING_COLLECTION → PAID_COLLECTED`, `PENDING_COLLECTION → REJECTED`, manual) |
| Shipment | §5.21.4–5.21.6 | 11, including `CREATION_FAILED → CREATING` and `DELIVERY_FAILED → IN_TRANSIT` |

The PRD's labels `PAID / VERIFIED` and `PAID / COLLECTED` are the enum values `PAID_VERIFIED` and `PAID_COLLECTED` (spec 11). The counts are a check on your transcription, not a substitute for reading the sections.

- **Invalid transitions are the complement.** §5.21.10's list is examples, not the full set. For each method, every `(from, to)` where `from` is reachable for that method and `to` is any order status, minus the valid edges and minus self-pairs, is its own named case asserting `INVALID_TRANSITION` with all three statuses unchanged. Also include targets that aren't order statuses at all (`SHIPPED`, `IN_TRANSIT`), which must be rejected. Terminal states (`DELIVERED`, `CANCELLED`, `RETURNED`) have no outgoing order edges in v1; there is no `DELIVERED → RETURNED` (§5.21.7).
- **Self-pairs are covered separately**: a repeated user action is `INVALID_TRANSITION` (two rapid confirms: spec 13 test 12), while a repeated courier-sync update is a silent no-op (§4.6, R11).
- **Reaching a state**: spec 12 installs a trigger that blocks direct status writes (spec 12 test 14), and a direct `UPDATE` would skip the side effects a real state carries (stock, history). Write `driveTo(orderId, target)`: BFS over the transcribed table from the method's initial status, applying each hop through the real service with a permitted actor. It re-exercises the valid path on every call, which is a feature.
- **Per valid edge, assert**:
  - the new status;
  - the other two statuses unchanged, unless the edge is a documented cascade;
  - exactly one new history row (previous, new, actor type and user, timestamp, reason where required);
  - its side effects — stock decremented at `CONFIRMED`; restored on `CANCELLED`/`RETURNED` from `CONFIRMED` or `PROCESSING`, and **never** from pre-`CONFIRMED` states; coupon usage never restored (§8.27).
- **Cascades** (shipment `DELIVERED` → order `DELIVERED`; shipment `RETURNED` → order `RETURNED`) are atomic. Inject a failure into the order-status write (R3) and assert the shipment status didn't move either.
- **Non-cascades**: shipment `CREATION_FAILED` or `DELIVERY_FAILED`, and bKash payment `REJECTED`, leave the order status and a verified payment untouched (§5.21.2, §5.21.5, §5.21.6). No order is auto-cancelled.
- **Actor type**: a user cannot perform a system-only transition (`PROCESSING → DELIVERED`, sync-driven shipment edges), and the system cannot perform a user-only one.
- **Authorization** (§5.21.9): a structurally valid transition by a caller without the matching permission is rejected. Pair it with R9 rather than re-deriving permission logic.
- **Parity**: run a representative edge set for guest and registered customers (`describe.each`); results must be identical (§5.21).
- **COD discrepancy** (§5.21.3) is computed from `DELIVERED` + `PENDING_COLLECTION` and stored nowhere. Assert no column holds it (`information_schema.columns`), and that manual resolution to `PAID_COLLECTED` or `REJECTED` keeps `DELIVERED`.

## R11 Idempotency and replay

- **Same input twice**: the state after the second call equals the state after the first, with no duplicate history, usage, shipment, or event rows. Count them.
- **Out of order**: a newer courier status then an older one → no regression, and no history row for the stale event (§4.6). Webhook plus polling delivering the same transition → applied once (spec 15 test 3).
- **Idempotency key** (spec 11 test 4; the CORS allowlist already admits the `Idempotency-Key` header): a replay returns the same order id and creates one order; concurrent duplicates (R1) create one order; the same key with a different body is rejected with the spec's error. These are three separate tests.
- **Seeds and migrations**: run twice, and concurrently for the Admin seed (§5.12.2) → exactly one row, no error on the second run. Existing models: `migrate.test.ts`; `geography.repository.test.ts` (ids stable across a re-seed); `permissions.repository.test.ts` (concurrent grants).

## R12 External providers — boundary stubs and recorded fixtures

- **CLAUDE.md §6: never invent a provider's API.** Adapter tests use recorded fixtures of real provider responses, taken from the provider's official documentation or a sandbox. Store them in `backend/tests/fixtures/<provider>/` with a `SOURCE.md` giving the URL and date for each file. If no real fixture is available, the test is a **gap** in the report, not a made-up payload.
- Identifiers that must look like a provider's (zone, consignment, merchant) are synthetic `TEST-ONLY-…` values, as in `courierLocationMapping.test.ts`.
- **Stub at the boundary the service depends on**: the adapter/port interface, or spec 04's SSRF-guarded fetch module. Not deeper (the service under test must run for real) and never at `pg`. The stub **records every call**, so tests can assert count (exactly one call; no automatic retry, spec 14 test 4) and payload.
- **Outbound payloads**:
  - Assert minimality by exact key set (R6) — the risk check sends only the normalized phone (§7.9).
  - Meta identifiers are hashed after Meta's normalization (§6.5).
  - No password, OTP, token, Transaction ID, or payment proof is sent (§6.6).
- **Failure modes per provider**: HTTP 500, timeout, malformed body, unknown status value. Each has a documented outcome (`CHECK_FAILED`, `CREATION_FAILED`, `SKIPPED`, "ignored, not guessed"). Simulate a timeout the way the implementation detects one (usually an `AbortError`), or lower the timeout via env. Never wait out a production-length timeout.
- **Contract suite** (spec 14 test 10): `describe.each(registeredAdapters)` runs the same contract assertions against every adapter, so a third courier inherits the suite.

## R13 Post-commit side effects and failure isolation

- **`Purchase` fires on `CONFIRMED` exactly once** (§6.3). Count the events or outbox rows at each stage:
  - after placement: 0;
  - after payment verification: 0;
  - after confirm: 1;
  - after a rejected re-confirm: still 1;
  - after cancel or return: still 1 — no reversal event.
- **A throwing or hanging subscriber must neither roll back nor delay the transition** (§6.8; spec 12 test 16, spec 18 test 11). Make the stub throw, and separately time out. Then assert the transition committed, stock decremented, history was written, and the failure was recorded as the spec says. Run it for both a 500 and a timeout.
- **Duplicate emission is blocked by the unique index**: insert the same event key twice at the data layer and expect `23505`.

## R14 Source-scan architecture invariants

The model is `password.test.ts` ("hashing is centralized"): walk the tree, filter, match, and assert `offenders` equals `[]`, so a failure names the files.

| Invariant | Source | Add with |
| --- | --- | --- |
| Only `lib/password.ts` imports bcrypt/argon2 | §11.7 | exists |
| No module logs a password field | §5.12.1 | exists |
| Only `repositories/` import `lib/supabase.ts` | spec 01, `backend` skill §2 | any slice |
| No `supabase` / `SERVICE_ROLE` reference under `frontend/` | CLAUDE.md §3, spec 01 criterion 10 | any slice |
| Only the state-machine service writes status columns | spec 12 | 12 |
| `wa.me` and the WhatsApp env var each appear in exactly one module; nothing in `backend/` references WhatsApp | spec 19 tests 11–12 | 19 |
| No placeholder brand ("Fashion Store", "Clothing Store", "E-commerce Platform") in customer-facing code or email templates | CLAUDE.md §0 | 07 |
| Meta event names limited to the seven | spec 18 test 15 | 18 |
| Category, search, related-products, and homepage carousels render the one shared `<ProductCard />` | spec 07 test 15, spec 17 test 17 | 07, 17 |

- **Paths**: backend suites run with `cwd` = `backend/` (`join(process.cwd(), 'src')`, as `password.test.ts` does). Reach other trees relative to the test file: `fileURLToPath(new URL('../../frontend/src', import.meta.url))`.
- Regex scans are heuristics. Keep patterns specific, put the rule in the assertion message, and pair the scan with a behavioural test where one is possible.

## R15 Compile-time negative tests

```ts
const user = await repo.create({
  role: 'ADMIN',
  userIdentifier: 'admin03',
  passwordHash: 'hash',
  // @ts-expect-error — the input type must not admit this field.
  isSystemAdmin: true,
});
expect(user.isSystemAdmin).toBe(false);
```

This proves both halves: the type rejects the field (typecheck fails if the directive ever becomes unused), and the runtime ignores it anyway. It only means something because `npm run typecheck` is part of "done". Use it for fields a caller must never set — `role`, `isSystemAdmin`, statuses, prices, totals — and for `PermissionKey` typos (`permissions.repository.test.ts`).

## R16 Log and error-message hygiene

- Error messages never echo the rejected value (`phone.test.ts`: "never leaks the rejected value"). An unexpected 500 returns only `GENERIC_ERROR_MESSAGE` (`app.test.ts`).
- **Capturing logs** (verified in this repo):
  - `vi.spyOn(logger, 'warn')` **throws** `warn does not exist`, because `src/lib/logger.ts` exports a lazy `Proxy` with no own properties.
  - Spying `process.stdout.write` **does** receive pino's lines.
  - The pino instance is memoized per module graph and its level can't be changed through the proxy. `applyTestEnv()` sets `LOG_LEVEL=fatal`, so a log-asserting file must set the level before anything logs:

  ```ts
  applyTestEnv();
  process.env.LOG_LEVEL = 'info';
  resetEnvCache();
  const stdoutSpy = vi.spyOn(process.stdout, 'write'); // restored by restoreMocks
  // … act …
  const out = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
  expect(out).not.toContain(fixture.plaintextPassword);
  expect(out).toContain('[REDACTED]');
  ```

- Prefer asserting a stored audit row over log text where the spec defines one. Spec 04's rate-limit rejection record is an audit row.

## R17 Keeping transcribed oracles and enum mirrors in step

- `permissions.seed.test.ts` MATRIX ↔ §5.18. `enums.parity.test.ts` MIRRORS ↔ every Postgres enum. The state-machine tables in your spec 12 suite ↔ §5.21.
- **A migration that adds a Postgres enum** must add its TypeScript mirror and a `MIRRORS` row. The "declares no database enum without a TypeScript mirror" test fails until you do; that is the design, not a flake.
- **When the PRD changes** (e.g. the COD cancellation edges added to §5.21.3/§5.21.8), update the transcription in the test together with the implementation. Never edit a transcription to match the code.

## R18 Sabotage check — proving a test can fail

A test that has never failed hasn't shown it can. For each tier-1/2 guard a suite exists to protect, do one check. Guards include a permission check, a transition-table entry, the coupon `usage_count < usage_limit` condition, a revalidation call, and a `FOR UPDATE`.

1. **Record the file's state**: `git diff --stat -- <file>`, and `bak=$(mktemp) && cp <file> "$bak"`.
2. **Break it**: make one minimal edit that disables the guard — delete the check, add the illegal edge, or drop `FOR UPDATE`.
3. **Run only the protecting tests**: `npx vitest run tests/<file>.test.ts -t "<name>"`. They **must fail**. If they pass, the test doesn't exercise the guard; fix the test.
4. **Restore**: `cp "$bak" <file> && cmp "$bak" <file> && rm "$bak"`, then confirm `git diff --stat -- <file>` matches step 1.
5. **Never restore with** `git checkout`, `git restore`, `git stash`, or `git reset`: they also discard the user's uncommitted work in that file. Don't sabotage a file another agent may be editing concurrently.

Report each check: the file, the guard, and the test that caught it.
