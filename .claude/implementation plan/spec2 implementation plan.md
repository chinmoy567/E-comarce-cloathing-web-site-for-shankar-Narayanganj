# Spec 02 — Core Schema: Identity, Role Enum, Bangladesh Address Model, Audit Log

## Context

Spec 01 delivered the scaffold: Express app shell, error taxonomy, validation middleware, pagination helpers, logger, env loader, Supabase service-role client and a forward-only migration runner. `0001_baseline.sql` creates only `pgcrypto` and `schema_migrations` — there is no application schema yet.

Spec 02 lays the identity and audit foundation that **every** later slice reads and writes: one `users` table covering Admin, Manager and registered Customer under a database-constrained role enum; one `customers` table holding registered customers **and** guest references identically; the shared Bangladesh address model with its rural/metropolitan discriminators; the permission catalogue and per-user grants; and an append-only audit log.

It also ships the four shared helpers later specs assume by name — `normalizeBdPhone`, `hashPassword`/`verifyPassword`, and `withTransaction`. Specs 03 and 08 already name these in their "Depends on" sections, so the signatures are fixed, not negotiable.

**No HTTP routes are added.** This slice is schema + types + repositories only, so specs 03 onward have a single correct place to read and write identity, address and audit data.

### Decisions confirmed with the user

- **Password hashing uses `bcrypt` at cost 12.** The spec permits argon2id or bcrypt ≥ 12; bcrypt was chosen. A prebuilt binary resolved on this machine, so no build toolchain is required.
- **Permission matrix verified before writing.** All 47 rows of `06-rbac.md` §5.18 were read and transcribed; the spec's own transcription was confirmed accurate rather than trusted.

---

## Approach

Follow `.claude/implementation specs/02-core-schema-identity-address-audit.md` as written — like spec 01 it is prescriptive (exact columns, exact constraints, the full 47-row seed). Build in six steps.

### Step 1 — Dependency

`bcrypt` (dependency) and `@types/bcrypt` (devDependency) added to `backend/package.json`. `pg` and `zod` were already present from spec 01; nothing else is new. No new database and no new framework — CLAUDE.md §2 holds.

### Step 2 — Migration (`backend/migrations/0002_identity_address_audit.sql`)

Forward-only, one file, applied by spec 01's runner — which already wraps each file in `BEGIN`/`COMMIT`, so the file opens no transaction of its own. `0001_baseline.sql` is not edited.

Statement order (dictated by the FK graph):

1. **Enums** — `user_role`, `account_type`, `area_unit_type`, `ward_unit_type`, `permission_tier`. Postgres enums rather than CHECK-on-text: this is what makes §5.19's "whether by application error or direct database access" true. `SUPER_ADMIN` and `STAFF` are absent by construction.
2. **`customers`** — before `users`, since `users.customer_id` references it. Paired discriminators `area_unit_type`/`area_unit_name` and `ward_unit_type`/`ward_unit_name` — one field each with a naming convention, not four columns. `UNIQUE (phone_number)`, `CHECK (phone_number ~ '^01[3-9][0-9]{8}$')`, index on `account_type`. **No separate guest address table** (§2.9.2).
3. **`users`** — three partial UNIQUE indexes (`user_identifier`, `phone_number`, `customer_id`, each `WHERE … IS NOT NULL`); the `users_role_shape` CHECK expressing the customer/back-office split; `users_system_admin_is_admin`; and the single-row partial unique index `ON users ((true)) WHERE is_system_admin` that spec 03's `ON CONFLICT DO NOTHING` seed targets.
4. **`permissions`** — seeded in the same migration with all 47 §5.18 rows via `ON CONFLICT (key) DO NOTHING`. `admin_tier` is `YES` throughout; `manager_tier` verbatim from the matrix; `is_administrative` true for the eight §5.17 administrative keys.
5. **`user_permissions`** — `UNIQUE (user_id, permission_key)` makes a repeated grant a no-op.
6. **`audit_logs`** — plus the `(entity_type, entity_id, created_at DESC)` index.

Constraint names are pinned explicitly so the error mapper in Step 5 can key on them rather than on Postgres's default naming.

### Step 3 — Shared types (`backend/src/types/`)

- **`enums.ts`** — `AccountType`, `AreaUnitType`, `WardUnitType`, `PermissionTier`, `ActorType` as `const` tuples with derived types and guards, matching spec 01's `role.ts` style.
- **`permissions.ts`** — `PERMISSION_KEYS` plus `PermissionKey`. Specs 03+ import this instead of typing permission strings inline, so a typo in `requirePermission(...)` is a compile error rather than a check that silently never passes.
- **`customer.ts`** — `CustomerAddress` and `CustomerRecord` exactly as the spec declares (camelCase at the TS boundary, `snake_case` in SQL).
- **`role.ts`** — reused. A `UserRole` alias is appended rather than creating a second source of truth for the same three values.

### Step 4 — Libraries (`backend/src/lib/`)

- **`phone.ts`** — `normalizeBdPhone` / `isValidBdPhone`. Accepts `+880…`, `880…`, `01…` with separators; normalizes to canonical `01[3-9]XXXXXXXX`; throws `ValidationError` otherwise. Deliberately the **only** normalizer in the system: customer-record reuse (§2.9.4), the risk-check cache key (§7.6) and the per-customer coupon limit (§8.8) all silently depend on two phone strings comparing equal, so a second normalizer anywhere would split one person into two identities.
- **`password.ts`** — `hashPassword` / `verifyPassword` over bcrypt at `BCRYPT_COST = 12`. The only module importing bcrypt; nothing logs the plaintext or the hash. `verifyPassword` returns false on a malformed stored hash rather than throwing, so a corrupt row reads as "wrong password" instead of a 500 that distinguishes that account.
- **`transaction.ts`** — `withTransaction(fn)` over a lazily-created `pg.Pool` sized by `PG_POOL_MAX`. `BEGIN` → `SET LOCAL statement_timeout` → run → `COMMIT`, `ROLLBACK` and rethrow on failure, `release()` in `finally`. A pool-level `error` handler prevents a dropped idle connection becoming an unhandled event. `resetTransactionPool()` is the test seam, mirroring spec 01's `resetSupabaseClient()`.

Spec 02 assumption 3 is a **decision, not an open question**: the Supabase JS client cannot express interactive transactions, so this helper uses a direct `pg` connection to the same Supabase Postgres instance. Non-transactional reads continue through the Supabase client. The pool cap is explicit because both paths draw on one instance connection limit, and an unbounded pool under checkout load would exhaust it — failing order creation, the one path that must not fail.

### Step 5 — Repositories (`backend/src/repositories/`)

- **`db.ts`** — `Db` type and `run(db, fn)`. Every repository function takes an optional `pg.PoolClient`: pass one and the write joins the caller's transaction, omit it and the repository runs its own. This is what lets spec 11's order creation compose several repository calls atomically without any repository knowing about it.
- **`users.repository.ts`** — `findByUserIdentifier`, `findByPhoneNumber`, `findById`, `create`, `update`, `listManagers`. `password_hash` is returned **only** by the two `findBy*` lookups auth calls; every other function uses a projection that omits it. `role`, `customer_id` and `is_system_admin` are not updatable — the first two would let an account cross the boundary `users_role_shape` exists to enforce, the third is seed-only.
- **`customers.repository.ts`** — `findByPhoneNumber`, `findById`, `createGuestReference`, `upsertByPhoneNumber`, `promoteToRegistered`, `updateAddress`, `list`. The upsert is a single `ON CONFLICT (phone_number) DO UPDATE`, never check-then-insert.
- **`permissions.repository.ts`** — `listAll`, `listGrantsForUser`, `grant`, `revoke`. Storage only; resolving role tier + grants into an effective permission set is spec 03's service.
- **`audit.repository.ts`** — `append` and `listForEntity`. **No update, no delete.** The append-only guarantee is the absence of the code path, not a convention.
- **`pgErrors.ts`** — maps `23505`/`23503` on a named constraint to the spec's error table: `CUSTOMER_PHONE_EXISTS`, `USER_IDENTIFIER_EXISTS`, `USER_PHONE_EXISTS`, `SYSTEM_ADMIN_EXISTS`, `UNKNOWN_PERMISSION`. Translating here keeps a lost race a clean 409 instead of a 500, with no repository re-reading to "check first".

### Step 6 — Tests (`backend/tests/`)

Following spec 01's `migrate.test.ts` pattern: real PostgreSQL via `liveDatabaseUrl()`, `describe.skipIf(!TEST_DATABASE_URL)`, each suite in its own disposable schema created and dropped around the run. `public` is never touched. These are database constraints — a mock would assert nothing.

1. `schema.identity.test.ts` — the enum rejects `SUPER_ADMIN` and `STAFF`; duplicate `users.phone_number`; both directions of the role-shape CHECK; the second `is_system_admin` row; the 9-digit phone CHECK; discriminator round-trip; the `actor_type` CHECK.
2. `permissions.seed.test.ts` — 47 rows; every key's tier asserted against a MATRIX transcribed **independently** from §5.18, so drift fails a test rather than shipping; `courier.manage` ≠ `courier.select`; the `PermissionKey` union matches the seeded catalogue.
3. `phone.test.ts` — pure unit. All three accepted forms collapse to one string; every valid operator prefix; invalid inputs rejected; the rejected value never appears in the error message.
4. `transaction.test.ts` — commit, rollback, all-statements-rollback, original error preserved, connection released across more iterations than `PG_POOL_MAX`.
5. `customers.repository.test.ts` — eight concurrent upserts yield one row; format-independent reuse; REGISTERED never downgraded.
6. `audit.repository.test.ts` — exports are exactly `['append', 'listForEntity']`; payload round-trip; newest-first ordering.

---

## Critical files created

| Path | Why it matters downstream |
| --- | --- |
| `backend/migrations/0002_identity_address_audit.sql` | Every later table FKs into `users`/`customers`; the seeded catalogue is what spec 03 enforces |
| `backend/src/lib/transaction.ts` | The single atomic mechanism for specs 11–15; no later slice opens its own connection |
| `backend/src/lib/phone.ts` | Record reuse, risk-check cache key and coupon per-customer key all depend on this one normalizer |
| `backend/src/lib/password.ts` | The only hashing site (§11.7) |
| `backend/src/types/permissions.ts` | `PermissionKey` — specs 03+ import it instead of inline strings |
| `backend/src/repositories/db.ts` | The optional-transaction-client seam that makes repository calls composable |
| `backend/src/repositories/audit.repository.ts` | Append-only by construction — the shape every later status change audits through |
| `backend/src/repositories/pgErrors.ts` | Constraint → domain error, so races surface as 409 not 500 |

## Out of scope (deferred, per spec)

Seed script, admin/customer login endpoints, permission-enforcement middleware and Manager account management → **03**. Customer registration/login/profile endpoints → **08**. `customer_risk_checks` → **16**. Orders, payments, shipments, products, coupons, CMS → their own specs. **No frontend work.**

## Carried-forward assumptions

- **Division/District/Upazila** stored as free text with presence validation only. No PRD supplies a geography dataset, so hierarchical consistency cannot be enforced beyond non-empty strings; deferred until a source is chosen (spec 08 / 14, which may need the courier's own dataset).
- **`users.email` stays nullable.** Admin/Manager have no self-service password recovery in v1; an Admin resets a Manager's password via Manager Update (spec 03). The PRDs define no recovery path for a locked-out Admin — spec 03 closes this with an out-of-band CLI.

---

## Verification

**All twelve acceptance criteria verified. `npm run typecheck`, `npm run build` and `npm test` (132 tests, 11 files) all pass.**

Run against the live Supabase project:

- `npm run migrate` applied `0002_identity_address_audit.sql`; the second run applied nothing and exited 0 (criterion 1).
- Direct `INSERT … VALUES ('SUPER_ADMIN', …)` → `invalid input value for enum user_role`; same for `'STAFF'` (criterion 2).
- `SELECT count(*) FROM permissions` → **47**; `cms.manage` → ASSIGNED, `order.confirm` → YES, `user.manager.create` → NO (criterion 7).
- `courier.manage` → ASSIGNED and `courier.select` → YES, two distinct rows (criterion 8).
- Criteria 3–6 (duplicate phone, phone-format CHECK, second system admin, role-shape CHECK both directions) — `schema.identity.test.ts`.
- Criterion 9 (three phone forms → one string) — `phone.test.ts`.
- Criterion 10 (concurrent upsert → one row) — `customers.repository.test.ts`.
- Criterion 11 (audit exports no mutation path) — `audit.repository.test.ts`.
- Criterion 12 (rollback leaves no partial write) — `transaction.test.ts`.

### Deviations from the plan as approved

1. **`upsertByPhoneNumber` never downgrades REGISTERED → GUEST.** The spec says "create or reuse" but is silent on what happens when someone who already holds an account checks out as a guest. Downgrading would silently strip their account type, so the upsert preserves it and refreshes the rest. Covered by a test.
2. **A spec-01 test was corrected.** `tests/migrate.test.ts` asserted `rows).toHaveLength(1)` against `schema_migrations` — an assumption that only one migration would ever exist, which adding 0002 legitimately invalidates. It now asserts each migration is recorded exactly once, which is the actual claim and survives specs 03–21.
3. **`pgErrors.ts` extends `AppError` directly.** Spec 01's `ConflictError`/`ValidationError` narrow `code` to a literal, so per-constraint codes cannot be carried by subclassing them. Same status codes, same handler path; an `ApiErrorDetailInput` alias was exported from `lib/errors.ts` for the constructor signature.

### Outstanding, unrelated to this slice

`backend/.env.example` is committed and its `DATABASE_URL` sample contains what appears to be a **real Supabase password** rather than a placeholder. Flagged, not changed — swapping it is a separate commit, and the credential needs rotating on Supabase's side regardless.
