---
name: test
description: Testing strategy, repo test mechanics, and required coverage for Fabrillke, this Bangladesh e-commerce platform — the vitest + real-Postgres schema-fixture patterns this repo actually uses, the per-slice "Tests required" contract in .claude/implementation specs/, and proven techniques for the high-risk rules in .claude/project requirment documents/ (order/payment/shipment state machine, RBAC matrix, coupon/checkout money, rate limiting, non-enumeration, external-provider isolation).
when_to_use: Use before writing, extending, auditing, or debugging any test in backend/tests or frontend/tests; when a spec slice (01–21) needs its Tests-required list implemented or checked; when a fix needs a regression test; when a suite fails, skips, or flakes. Invoke as /test <spec-number | area | test-file>, e.g. /test 12, /test coupon, /test tests/users.repository.test.ts.
argument-hint: "[spec-number | area | test-file]"
type: skill
version: 3.0
priority: high
---

# Test Skill

**For**: Fabrillke (fabrillke.com) — Bangladesh fashion & clothing e-commerce.
**Purpose**: tests that would actually catch a spec violation in business-rule code, written the way this repo already writes tests, and run for real.

| File | Read it when |
| --- | --- |
| `SKILL.md` (this file) | Always — mechanics (Part A), workflow (Part B), rules every slice inherits (Part C) |
| [`recipes.md`](recipes.md) | Before using a technique: concurrency, deadlock, failure injection, time, money, key-set leak guards, non-enumeration, rate limits, RBAC and state-machine harnesses, idempotency, provider stubs, source-scan invariants, sabotage check |
| [`coverage.md`](coverage.md) | Before testing a risk area or a spec slice: per-area checklists and the spec 01–21 map of traps and must-not-miss cases |

**Invoked with arguments** (an `ARGUMENTS:` line at the end of this skill): treat them as the target. A spec number (`12`) → run the Part B workflow for `.claude/implementation specs/12-*.md`. An area (`coupon`, `rbac`, `state machine`) → the matching `coverage.md` section. A test file → extend or triage that file. With no argument, take the target from the conversation.

---

## 0. What a test is checked against

1. **PRDs** — `.claude/project requirment documents/`. `07-order-state-machine.md` §5.21 outranks every other file for order/payment/shipment states; `06-rbac.md` §5.18 is the permission matrix. The narrative diagrams in `03-payment-order.md` §3.3/§3.11 and `04-courier-shipment.md` §4.12/§4.13 are illustrative — never test against them.
2. **The slice's implementation spec** — `.claude/implementation specs/NN-*.md`. Its numbered `## Tests required` list plus its `## Acceptance criteria` list are the slice's test contract: every item gets at least one test, or an explicit gap with a reason. Where a spec and a PRD disagree, the PRD wins — flag the spec.
3. **The code is what is under test, never the oracle.** Expected values — matrix tiers, transition tables, error messages, worked money examples — are transcribed into the test from the PRD, not imported from `src/`. `permissions.seed.test.ts` is the model: *"That duplication is the point."*

---

# Part A — How this repo tests

## A.1 Runner and layout

| | Backend | Frontend |
| --- | --- | --- |
| Config | `backend/vitest.config.ts` (+ per-slice configs) | `frontend/vitest.config.ts` (minimal) |
| Files | `backend/tests/*.test.ts`; helpers in `tests/helpers/` | `frontend/tests/*.test.ts` |
| Environment | `node`, `setupFiles: ['./tests/setup.ts']` | `node`, no setup file, **no DOM** |
| Globals / mocks | `globals: false`, `restoreMocks: true` | `globals: false`, no `restoreMocks` — restore spies and `vi.unstubAllGlobals()` in `afterEach` yourself |
| Relative imports | **`.js` extension** — `'../src/lib/phone.js'` (backend is `"type": "module"`) | **extensionless** — `'../src/lib/apiClient'`; the `@/` alias is **not** configured for vitest |
| Command | `npm run test --workspace backend` | `npm run test --workspace frontend` |

`vitest` + `supertest` + `vi` is the whole toolkit. Never add a second test framework, assertion library, mocking library, or HTTP-mocking server. Import `describe`/`it`/`expect`/`vi` from `vitest`.

**Frontend specifics** (verified against the current config):

- `src/app/*` imports through `@/…`. Before a test imports such a module, add `resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }` to `frontend/vitest.config.ts` — no new dependency.
- Components can be server-rendered in the `node` environment with `react-dom/server`'s `renderToStaticMarkup(createElement(Component, props))`, which is enough for markup assertions: attributes, which buttons render, and that no customer data appears. This needs `esbuild: { jsx: 'automatic' }` in `frontend/vitest.config.ts`. Without it, `.tsx` modules compile to the classic runtime and throw `React is not defined`, because `tsconfig`'s `jsx: preserve` is meant for Next's compiler. Interaction tests (clicks, state) need a DOM library (jsdom/happy-dom + @testing-library) — **ask the user before adding any dependency**.
- `site.ts` computes `SITE_URL` from `NEXT_PUBLIC_SITE_URL` **at import time**. To test an override: set the env var, `vi.resetModules()`, then `await import(...)`.

## A.2 The test database — where it is, and how not to damage it

`TEST_DATABASE_URL` (exported by `tests/helpers/schemaFixture.ts`) is `liveDatabaseUrl()` from `tests/setup.ts`: `process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL`, rejecting any URL containing `@localhost:5432` — that is the placeholder `applyTestEnv()` installs.

- `backend/.env` sets no `TEST_DATABASE_URL`, so **by default every database suite runs against the live Supabase project in `DATABASE_URL`**, creating and dropping its own schemas there. The suites are verified against that project's session-mode connection on port 5432. Don't point them at the transaction-mode pooler (6543): `scopedUrl()` depends on the `options=-c search_path=…` startup parameter, which is untested there.
- A local Postgres works as `TEST_DATABASE_URL` only if the URL does **not** contain `@localhost:5432`. Use `127.0.0.1` or another port.
- `resetSchema()` runs `DROP SCHEMA … CASCADE`. **A wrong `SCHEMA` literal destroys data.** `SCHEMA` is a hard-coded lowercase literal named `specNN_<area>`. It is never `public`, never an application schema, and never computed. Before adding one, check uniqueness (this must print nothing):
  `grep -rhoE "const (SCHEMA|TEST_SCHEMA) = '[^']+'" backend/tests | sort | uniq -d`
  Names already taken: `migtest`, `spec02_{identity,enum_parity,transaction,users_repo,customers_repo,permissions,permissions_repo,audit}`, `geography_repo_test`, `geography_api_test`, `courier_mapping_test`.
- `withAdminClient(sql)` is **unscoped** (default `search_path`, i.e. `public`). Use it only to create or drop your schema. Everything else goes through `connect(SCHEMA)` or `withTransaction` after the env swap.
- Only the `pg` pool honours the scoped URL. `getSupabase()` (PostgREST) ignores it and reads/writes the live project's exposed schema. Today only `health.repository.ts` uses the Supabase client. A business repository that uses it cannot be tested in a disposable schema — flag that rather than testing against `public`.
- Supabase Storage tests (spec 06) are gated on `hasLiveSupabase()`, write only under a unique per-run prefix (`test/<suite>/<uuid>/`), and delete it in `afterAll`.
- Killed runs leave schemas behind; the next `resetSchema` of the same name drops them. To list strays, run `SELECT nspname FROM pg_namespace WHERE nspname ~ '^(spec[0-9]{2}_|migtest$|geography_|courier_mapping_test$)'` via `connect`. Report them to the user; don't bulk-drop them yourself.

## A.3 Suite shapes — pick one, don't invent a fifth

| Shape | Use for | Reference |
| --- | --- | --- |
| **S1** DB service/repository | repository contracts, service business rules | `permissions.repository.test.ts`, `users.repository.test.ts` |
| **S2** HTTP + DB | routes: validation, RBAC, rate limits, status codes, response shape | skeleton below (no suite yet — first needed by spec 03) |
| **S3** Raw-SQL constraint | CHECKs, enums, unique/partial indexes, FKs, triggers — bypassing repositories | `schema.identity.test.ts` (one `pg.Client`, `BEGIN`/`ROLLBACK` per case), `enums.parity.test.ts` |
| **S4** No database | pure functions, middleware with a stubbed repository, env parsing, source scans | `phone.test.ts`, `app.test.ts`, `env.test.ts`, `password.test.ts` |

**S1 skeleton** — every line is load-bearing:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from './helpers/schemaFixture.js';
import { resetEnvCache } from '../src/config/env.js';

const SCHEMA = 'spec12_order_transitions';

describe.skipIf(!TEST_DATABASE_URL)('order state machine', () => {
  let withTransaction: typeof import('../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../src/lib/transaction.js').resetTransactionPool;
  let orders: typeof import('../src/repositories/orders.repository.js');

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../src/lib/transaction.js'));
    await resetTransactionPool();
    orders = await import('../src/repositories/orders.repository.js');
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(async () => {
    await withTransaction(async (c) => {
      await c.query('DELETE FROM orders'); // children before parents
    });
  });
});
```

The five rules it encodes:

1. **`describe.skipIf(!TEST_DATABASE_URL)`** — without it the suite fails, instead of skipping, where no database is configured.
2. **Env swap before import**: `process.env.DATABASE_URL = scopedUrl(SCHEMA)` and `resetEnvCache()` *before* any module that reads env is imported. `env.ts` memoizes, so a static import binds to the wrong database and the test runs against the default schema without complaint.
3. **Therefore, dynamic `await import(...)` inside `beforeAll`**, typed via `typeof import('...')` on a `let`. Static imports are safe only for pure helpers that never touch env or a pool.
4. **`resetTransactionPool()` after the swap and again in `afterAll`**, plus `dropSchema`. The pool caches its connection string, and an unclosed pool leaks connections into the next file.
5. **`SCHEMA` is a unique hard-coded literal** (A.2) — identifiers can't be parameterized, so this is also the injection boundary.

**S2 skeleton** — the same five rules, plus one ordering trap:

```ts
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from './helpers/schemaFixture.js';
import { applyTestEnv } from './helpers/testEnv.js';
import { resetEnvCache } from '../src/config/env.js';

const SCHEMA = 'spec03_manager_api';

describe.skipIf(!TEST_DATABASE_URL)('manager accounts API', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../src/lib/transaction.js').resetTransactionPool;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();                               // fake Supabase, LOG_LEVEL=fatal, test CORS list …
    process.env.DATABASE_URL = scopedUrl(SCHEMA); // … then override its localhost DATABASE_URL — never the reverse
    resetEnvCache();

    ({ resetTransactionPool } = await import('../src/lib/transaction.js'));
    await resetTransactionPool();
    const { createApp } = await import('../src/app.js');
    app = createApp();
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });
});
```

**Legacy idiom — don't copy.** `geography.repository.test.ts`, `geography.api.test.ts` and `courierLocationMapping.test.ts` use `const describeDb = TEST_DATABASE_URL ? describe : describe.skip`, static imports, and never reset the env cache or close the pool. They work only because nothing reads env before `beforeAll`, and they leave pooled connections open. New suites use S1/S2.

Clean state per test with `DELETE FROM` (children first) inside `withTransaction`, not by re-running migrations. Use `SAMPLE_CUSTOMER` whenever a test needs a customer but not its details.

## A.4 Guards check values, not presence

`applyTestEnv()` (`tests/helpers/testEnv.ts`) installs a **deliberately fake** `SUPABASE_URL` (`https://example.supabase.co`), service key, and localhost `DATABASE_URL`. A presence check passes against these placeholders and fires requests at hosts that don't exist. Guard with the value checks from `tests/setup.ts`: `TEST_DATABASE_URL`/`liveDatabaseUrl()` for Postgres, `hasLiveSupabase()` for a real Supabase project. `setup.ts` loads `backend/.env` with `override: false`, so an explicit `TEST_DATABASE_URL=… vitest` or a CI secret always wins.

## A.5 Timeouts and parallelism

Schema-building suites run every migration in `beforeAll` (geography also seeds 579 rows). The root config sets `testTimeout: 120_000`, `hookTimeout: 180_000`, and **`fileParallelism: false`**, because the suites share one Supabase connection cap. Never lower these, never re-enable file parallelism, never add `retry`.

## A.6 Per-slice configs and naming

- Finishing a slice adds `backend/vitest.specNN.config.ts` and the script `"test:specNN": "vitest run --config vitest.specNN.config.ts"`. **Copy `vitest.geography.config.ts`**, which has the full timeouts and `fileParallelism: false`. `vitest.spec02.config.ts` predates that rule. List files explicitly, never with a glob — a pattern silently absorbs a later slice's similarly named tests. Add a header comment saying why the slice is worth isolating.
- Test files are named `<area>.<layer>.test.ts`, with layer ∈ `schema` (S3), `seed`, `parity`, `repository`, `service`, `api` (S2), `middleware`, `invariants` (source scans). Examples: `orderStateMachine.service.test.ts`, `admin.managers.api.test.ts`.
- Shared helpers go in `tests/helpers/<name>.ts`, created only when a second suite needs them. Provider fixtures go in `tests/fixtures/<provider>/`, with a `SOURCE.md` naming where each file came from (recipes R12).

## A.7 Running and reporting

| Goal | Command |
| --- | --- |
| Whole backend | `npm run test --workspace backend` |
| One slice | `npm run test:spec02 --workspace backend` (existing: `test:spec02`, `test:spec08geo`) |
| One file (from `backend/`) | `npx vitest run tests/<file>.test.ts` |
| One test | add `-t "<name substring>"` |
| Per-test listing, incl. skips | add `--reporter=verbose` |
| Typecheck (required) | `npm run typecheck --workspace backend` (and `--workspace frontend`) |

Typecheck is part of the test run, not an extra: it is what makes `@ts-expect-error` negative tests (recipes R15) bite. **Report what really happened.** A suite skipped for want of a database is *unverified*, never *passing* — say "skipped: no test database" in the verdict. A database-backed suite that has only ever skipped is unverified work.

## A.8 Style

- Each suite opens with a block comment giving the spec, the item numbers, and the PRD sections under test, plus a sentence on *why this level* (usually: a mock would assert nothing).
- Test names state the rule and cite the item: `it('rejects PENDING_CONFIRMATION → PROCESSING (§5.21.10, spec 12 test 2)')`.
- **`it.each` over a transcribed table is the house style** for matrix rows and transition edges. Each row becomes its own named test (`'%s matches the §5.18 matrix'`). What's banned is looping over rows inside one `it`, which stops at the first failure and names nothing.
- **Assert the actual claim, not an incidental count** that later slices legitimately change. Spec 02 had to fix `migrate.test.ts`, which asserted exactly one migration. Spec-fixed numbers (47 permissions, 8 divisions) are fine.
- **Assert specific error identity**: `rejects.toMatchObject({ code: 'INVALID_TRANSITION', status: 409 })`, or a constraint name (`/customers_phone_number_key/`, `{ constraint: '…' }`), never a bare `.rejects.toThrow()`. Codes live in `src/lib/errors.ts` and `repositories/pgErrors.ts`. Error bodies are `{ error: { code, message, details? }, requestId }`.
- **Negative assertions must not pass vacuously**: for "unchanged", read before *and* after and compare; for "nothing written", count rows scoped to the fixture's ids.
- No comments restating an assertion. Comment only a non-obvious setup step or a spec citation.
- **Test data**: Bangladesh mobiles `01[3-9]XXXXXXXX`, distinct per test; `SAMPLE_CUSTOMER` when details don't matter; `@example.com` emails; RFC 5737 IPs (`192.0.2.x`, `198.51.100.x`, `203.0.113.x`); unknown-but-well-formed UUID `00000000-0000-4000-8000-000000000000`; provider ids `TEST-ONLY-…`. bcrypt cost is 12 (~¼ s per hash), so hash fixture passwords once in `beforeAll`.

---

# Part B — Workflow

## B.1 Steps

1. **Pin the target**: a spec slice, feature, bug, or failing file. To find the slice for a keyword: `grep -l "<keyword>" ".claude/implementation specs/"*.md`.
2. **Read** the slice's `## Tests required` and `## Acceptance criteria`, then every PRD section they cite (§5.21 or §5.18 in full whenever touched), then the slice's entry and area section in `coverage.md`.
3. **Read the implementation**: the function or route under test, the errors it throws, the tables it writes, and the migration's constraint names. If something isn't implemented yet, that item is a gap ("blocked: not implemented") — never invent the API.
4. **Write the traceability plan before any test**: each numbered item → test file → shape (S1–S4) → recipe (R#). This becomes the report table.
5. **Write the tests in risk order** (C.1), reading each recipe you use.
6. **Run** each new file, then the slice config, then the whole workspace (which catches env or pool leakage between files).
7. **Sabotage-check** each tier-1/2 guard a suite exists to protect (recipes R18): break it, watch the test fail, restore byte-identically.
8. **Typecheck** every workspace you touched.
9. **Report** in the B.5 format.

## B.2 Choosing the level

| Claim | Level | Shape |
| --- | --- | --- |
| A DB constraint / enum / trigger / partial index exists and bites | raw SQL, bypassing repositories | S3 |
| A repository's contract | real DB | S1 |
| A business rule in a service (transition, stock, coupon, pricing, cascade) | real DB, call the service; external ports stubbed | S1 |
| HTTP contract: validation, RBAC, rate limit, non-enumeration, key-set, status codes | `supertest` on `createApp()` + real DB | S2 |
| A pure function (phone, rounding, link/metadata/JSON-LD builders) | plain unit | S4 |
| Middleware in isolation (headers, CORS, error hygiene) | app with the repository stubbed | S4 |
| Architecture invariant (single writer, single import site) | source scan (R14) | S4 |
| A field must not even be accepted by the type | `@ts-expect-error` + typecheck (R15) | any |

When the PRD says a rule must hold at the database — role enum (§5.19), stock `CHECK`, Transaction ID uniqueness, the direct-status-write trigger — test it at **both** levels: S3 at the data layer, and S1/S2 through the app.

## B.3 Mocking policy

- **Never mock**: Postgres; `withTransaction`; repositories under a business-rule test; the permission/RBAC and session layer; the state-machine service; the coupon engine; pricing (`resolveCartForPricing`, `computeShipping`); validation middleware. A mocked test here passes while the real logic is broken.
- **Always stub at the module boundary**: Pathao, Steadfast, the risk provider, Meta CAPI, email/SMS/OTP channels, any outbound HTTP — a test never makes a real network call. Supabase Storage is also stubbed, except in the gated storage suite.
- **Allowed**: a repository stub when the database isn't the subject (`app.test.ts` stubs the health repository to test middleware); `vi.useFakeTimers({ toFake: ['Date'] })` for JS-evaluated time (R4).
- **Failure injection is not mocking**: R3 forces a real transaction to fail at a chosen step while everything stays real.

## B.4 When a test fails or flakes

1. Re-read the rule. Decide whether the test or the implementation is wrong.
2. **If the implementation is wrong**, keep the test asserting the documented behaviour and report file:line plus the section. Don't fix `src/` unless the user asked — that is `backend-builder`'s job. Never bend, `.skip`, `.fails`, `.todo`, or delete the test to get green.
3. **If the test is wrong**, fix it and say what was wrong.
4. **If the spec is ambiguous**, take the most conservative documented reading and name the ambiguity in the report.
5. **If the environment is the cause** (no database, connection cap, stray schema, placeholder env), report it as environment, never as pass or fail.
6. **If it flakes**, find the cause: shared state across tests, a missing `await`, env or pool not reset, dependence on `Date` or `now()`, or a `SELECT` without `ORDER BY`. Never hide it with retries, sleeps, or longer timeouts.

A new Postgres enum without its TypeScript mirror fails `enums.parity.test.ts` ("declares no database enum without a TypeScript mirror") **by design**. The fix is the mirror plus a `MIRRORS` row, never a skip.

## B.5 Report format

1. **Verdict**: one line, including "unverified — no test database" when that is the case.
2. **Traceability table**: item # | required test (short) | test (`file › name`) | PASS / FAIL (impl bug) / SKIPPED (why) / GAP (why).
3. **Commands run**, with the real passed/failed/skipped counts and whether a database was reachable.
4. **Typecheck** result per workspace.
5. **Implementation bugs found**: file:line, the rule violated (section), and the reproducing test.
6. **Ambiguities** and the interpretation taken.
7. **Sabotage checks**: file, guard, and the test that caught it.
8. **Files added/changed**: tests, helpers, fixtures, configs, scripts, test seams.

---

# Part C — Rules every slice inherits

## C.1 Priority (risk order)

1. **State machine** — `07` §5.21; specs 11–15.
2. **RBAC** — `06` §5.10–5.19; spec 03, plus the matrix rows in every admin slice.
3. **Money** — coupon engine, cart pricing, shipping, order totals: `10` §8; specs 09, 10, 21, 11.
4. **Abuse resistance** — rate limits, auth/OTP, non-enumeration, uploads, risk check: `11`, `02` §2.5, `09`; specs 04, 06, 08, 15, 16.
5. **Everything else** — catalogue CRUD, SEO, CMS, Meta, WhatsApp, reports. Standard coverage, except that `Purchase` timing (spec 18) rides on tier 1.

When time is limited, tiers 1–3 are where an untested regression causes real financial or security harm.

## C.2 Cross-cutting assertions — apply every one that fits

- **Status independence** (§5.21.11): any change to one of order, payment, or shipment status asserts the other two unchanged, unless the edge is a documented cascade.
- **Audit trail** (§5.15 rule 10, §5.21.11): every status change, grant/revoke, and admin mutation asserts its history/audit row — previous value, new value, actor (type and user), reason where required, timestamp.
- **Server authority** (CLAUDE.md §3, §8.16, §11.8): a client-supplied price, subtotal, discount, total, shipping, status, `now`, or permission field is **rejected with 400** by the `.strict()` schema, not silently ignored. Test with a tampered body.
- **Non-enumeration** (§2.5, §2.9.7, §4.16, §8.22, §11.2): exists and not-exists responses are identical in status and body (R7).
- **Leak guards**: public and customer payloads are asserted by exact key set (R6), never by a `not.toHaveProperty` list.
- **Admin endpoints**: one test per §5.18 row the endpoint gates. `ASSIGNED` rows are tested both ungranted (403) and granted. Unauthenticated gets 401; a customer-scope token is rejected (R9).
- **Rate-limited endpoints**: the under-limit / over-limit pair (R8).
- **List endpoints**: bounded pagination — `pageSize` over 100 → 400, default 20.
- **Idempotency** where the PRD requires it: same input twice, and out of order (R11).
- **Concurrency** wherever a counter, status, or unique row is contended (R1). **Atomicity** wherever the PRD says "single transaction": forced failure at each step leaves nothing (R3).
- **Brand**: customer-facing output — titles, metadata, canonical URLs, email — says **Fabrillke** / `https://fabrillke.com`, read from `frontend/src/lib/site.ts` or `backend/src/config/constants.ts`, never a placeholder name.

## C.3 General rules

- **Do not mock the database or the permission-check layer** in tiers 1–3. Use the real test database via S1/S2, not an in-memory fake with different semantics.
- **Test against §5.21 and §5.18 directly.** If a narrative doc disagrees, §5.21/§5.18 wins — flag the narrative doc rather than testing to match it.
- **A backend feature touching status, RBAC, or money is not done** until these tests exist and pass, the same way `backend-builder` treats an unvalidated status transition as incomplete.
- **When `security-reviewer` or `architect-reviewer` flags a shipped bug**, add a regression test that reproduces it as part of the fix.
- **Keep transcribed oracles in step**: MATRIX ↔ §5.18, MIRRORS ↔ every Postgres enum, transition tables ↔ §5.21 (R17). When the PRD changes, update the transcription; never edit it to match the code.
- **A test that has never run — or never failed — is not coverage.** Run it, sabotage-check the guards that matter, and report the real result.
