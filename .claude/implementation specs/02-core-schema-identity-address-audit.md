# 02 — Core Schema: Identity, Role Enum, Bangladesh Address Model, Audit Log

## Goal

After this slice the database holds the identity and audit foundation every later slice depends on: one `users` table covering Admin, Manager, and registered Customer accounts under a database-constrained role enum; one `customers` table that stores registered customers and guest customer references identically; the shared Bangladesh address model with its rural/metropolitan discriminators; the permission catalogue and per-user permission grants; and an append-only audit log. No endpoint is added — this is schema plus repository/type layer only, so that specs 03 onward have a single, correct place to read and write identity, address, and audit data.

## Requirement references

- `06-rbac.md` §5.19 — role field is a fixed, database-constrained set of exactly `ADMIN`, `MANAGER`, `CUSTOMER`; `SUPER_ADMIN`/`STAFF` must not be insertable; customer auth domain stays distinct from back-office roles; a guest customer reference holds no role at all.
- `06-rbac.md` §5.12.3 — the seeded Admin carries a system-level designation (`is_system_admin`) marking it protected.
- `06-rbac.md` §5.16 — the authoritative permission-key list (`payment.verify`, `payment.reject`, `payment.review`, `order.confirm`, `order.cancel`, `shipment.create`, `courier.manage`, `courier.select`, `user.manager.create`, `user.manager.update`, `user.manager.delete`, `role.manage`, `permission.assign`).
- `06-rbac.md` §5.18 — the complete permission matrix and its `Yes` / `Assigned` / `No` values, which this slice stores as seed data.
- `06-rbac.md` §5.15 rule 10, §5.21.11 (`07-order-state-machine.md`) — every status change and permission-changing action is audited with previous value, new value, timestamp, acting user, and reason.
- `02-customer.md` §2.1 — registered customers identified by unique mobile phone number; password hashed, never plaintext.
- `02-customer.md` §2.2 — required profile fields: full name, mobile, email (optional), Division, District, Upazila/Thana, Union/Ward, detailed address, postal code (optional). Upazila/Thana and Union/Ward are **one field each with a type discriminator**, not two fields each.
- `02-customer.md` §2.9.4 — a guest order creates or reuses a customer record keyed by phone number, holding name/phone/email/address, marked `GUEST` vs `REGISTERED`, with no password or auth identity.
- `05-admin-operations.md` §5.7 — registered customers and guest references are the same kind of record, distinguished by an account-type field.
- `09-fraud-risk-check.md` §7.6 — risk-check cache is keyed by the phone-number-keyed customer record, which must resolve identically for guest and registered.
- `10-coupon-discount.md` §8.8 — per-customer coupon limits key off the same customer record for both guest and registered.
- `11-security-hardening.md` §11.7 — passwords hashed with `bcrypt` or `argon2`.
- Skills: `database` §1 (`snake_case`, conventions), §2.2 (role constrained at database level), §2.4 (audit tables append-only), §3 (shared address model; one field each with a discriminator), §5 (migrations).

## Depends on

- **01** — migration runner, `pgcrypto`, repository layering, `snake_case`/`numeric(12,2)`/`id`/`created_at`/`updated_at` conventions, the Supabase service-role client.

## Scope

**In scope**

- `user_role` Postgres enum and the `users` table (Admin/Manager/registered-Customer login identities).
- `customers` table (registered customers **and** guest references) with the shared address columns and discriminators.
- `permissions` catalogue table seeded from the §5.16 key list and §5.18 matrix defaults.
- `user_permissions` grant table for the `Assigned`-tier permissions.
- `audit_logs` append-only table.
- TypeScript enums/types mirroring every database enum, in one shared location.
- Repository functions for reading/writing users, customers, permission grants, and appending audit entries.
- A reusable `withTransaction` helper so later slices' multi-statement atomic operations have one mechanism.

**Out of scope / deferred**

- The seed script and admin/customer login endpoints — deferred to spec **03**.
- Permission *enforcement* middleware — deferred to spec **03**.
- Manager account management endpoints — deferred to spec **03**.
- Customer registration/login/profile endpoints — deferred to spec **08**.
- Orders, payments, shipments, products, coupons, CMS — deferred to their own specs.
- `customer_risk_checks` — deferred to spec **16**.

## Database changes

Migration file: `backend/migrations/0002_identity_address_audit.sql`

### Enums

```sql
CREATE TYPE user_role AS ENUM ('ADMIN', 'MANAGER', 'CUSTOMER');
CREATE TYPE account_type AS ENUM ('GUEST', 'REGISTERED');
CREATE TYPE area_unit_type AS ENUM ('UPAZILA', 'THANA');
CREATE TYPE ward_unit_type AS ENUM ('UNION', 'WARD');
CREATE TYPE permission_tier AS ENUM ('YES', 'ASSIGNED', 'NO');
```

`user_role` being a Postgres enum satisfies `06-rbac.md` §5.19's requirement that an invalid role value cannot be inserted "whether by application error or direct database access." `SUPER_ADMIN` and `STAFF` are absent by construction.

### `users`

Back-office and registered-customer login identities.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `role` | `user_role` | NOT NULL | — | §5.19 |
| `user_identifier` | `text` | NULL | — | Admin/Manager login User ID (§2.8); NULL for customers |
| `phone_number` | `text` | NULL | — | Registered-customer login identity (§2.1, §2.4); NULL for Admin/Manager |
| `email` | `text` | NULL | — | Used for password recovery (§2.5) |
| `password_hash` | `text` | NOT NULL | — | bcrypt/argon2 only (§11.7) |
| `customer_id` | `uuid` | NULL | — | FK → `customers(id)` ON DELETE RESTRICT; set only when `role = 'CUSTOMER'` |
| `is_system_admin` | `boolean` | NOT NULL | `false` | §5.12.3 protected seeded Admin |
| `is_active` | `boolean` | NOT NULL | `true` | Deactivation (§5.14 Rule 2) |
| `must_change_password` | `boolean` | NOT NULL | `false` | §2.7 "password must be changed on first login" |
| `last_login_at` | `timestamptz` | NULL | — | |
| `created_by` | `uuid` | NULL | — | FK → `users(id)` |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

Constraints and indexes:

- `UNIQUE (user_identifier)` (partial, `WHERE user_identifier IS NOT NULL`).
- `UNIQUE (phone_number)` (partial, `WHERE phone_number IS NOT NULL`) — enforces §2.1 "cannot create multiple accounts using the same mobile phone number."
- `UNIQUE (customer_id)` (partial, `WHERE customer_id IS NOT NULL`) — one login identity per customer record, which is what makes §2.9.8's guest→registered association single-valued.
- `CHECK` — an `ADMIN`/`MANAGER` row has `user_identifier IS NOT NULL` and `customer_id IS NULL`; a `CUSTOMER` row has `phone_number IS NOT NULL` and `customer_id IS NOT NULL`. This is the schema-level expression of §5.19's "a customer role value must never grant access to any Admin/Manager back-office function."
- `CHECK (NOT is_system_admin OR role = 'ADMIN')`.
- Unique partial index enforcing at most one `is_system_admin` row: `CREATE UNIQUE INDEX ON users ((true)) WHERE is_system_admin` — this is what makes §5.12.2's idempotent seed safe under concurrency.
- Index on `role`.

### `customers`

Holds registered customers **and** guest references (§2.9.4, §5.7). One row per phone number.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `account_type` | `account_type` | NOT NULL | `'GUEST'` | §2.9.4 discriminator |
| `full_name` | `text` | NOT NULL | — | §2.2 |
| `phone_number` | `text` | NOT NULL | — | Bangladesh mobile, normalized (see below) |
| `email` | `text` | NULL | — | Optional (§2.2, §2.9.2) |
| `division` | `text` | NOT NULL | — | §2.2 |
| `district` | `text` | NOT NULL | — | §2.2 |
| `area_unit_type` | `area_unit_type` | NOT NULL | — | UPAZILA vs THANA discriminator (§2.2 note) |
| `area_unit_name` | `text` | NOT NULL | — | The Upazila/Thana value |
| `ward_unit_type` | `ward_unit_type` | NOT NULL | — | UNION vs WARD discriminator (§2.2 note) |
| `ward_unit_name` | `text` | NOT NULL | — | The Union/Ward value |
| `detailed_address` | `text` | NOT NULL | — | §2.2 |
| `postal_code` | `text` | NULL | — | Optional (§2.2) |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

Constraints and indexes:

- `UNIQUE (phone_number)` — this is the single fact that makes §2.9.4 ("reuse a customer record with the same phone number"), §7.6 (risk-check cache keyed by phone), and §8.8 (guest per-customer coupon limit keyed by phone) all work off one row.
- `CHECK (phone_number ~ '^01[3-9][0-9]{8}$')` — the normalized Bangladesh mobile format (see assumption 1).
- Index on `account_type`.

**One address, two naming conventions.** `area_unit_type`/`area_unit_name` is *one* field with a discriminator, and likewise `ward_unit_type`/`ward_unit_name` — not four independent fields (§2.2 note, `database` skill §3). The courier adapters in spec 14 map these to each provider's own schema; nothing else in the system reinterprets them.

**No separate guest address table.** §2.9.2 and the `database` skill §3 both forbid a reduced schema for guests; guest and registered orders read the same columns, so admin views and courier mapping behave identically.

### `permissions`

The authoritative catalogue, seeded in this migration from `06-rbac.md` §5.16 and §5.18.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `key` | `text` | NOT NULL | PK, e.g. `order.confirm` |
| `label` | `text` | NOT NULL | The §5.18 matrix row name |
| `admin_tier` | `permission_tier` | NOT NULL | Always `YES` in the current matrix |
| `manager_tier` | `permission_tier` | NOT NULL | `YES` / `ASSIGNED` / `NO` per §5.18 |
| `is_administrative` | `boolean` | NOT NULL | §5.17 operational vs administrative split |

Seed rows — one per §5.18 matrix row, using the §5.16 / §8.19 / §13.14 permission keys. The `manager_tier` column is a verbatim transcription of the §5.18 table; if the two ever disagree, §5.18 wins and this seed is corrected.

| key | label | manager_tier |
| --- | --- | --- |
| `dashboard.view` | Dashboard View | YES |
| `analytics.view` | Analytics View | ASSIGNED |
| `audit.view` | Audit Log View | ASSIGNED |
| `product.create` | Product Create | YES |
| `product.update` | Product Update | YES |
| `product.delete` | Product Delete | ASSIGNED |
| `category.manage` | Category Management | YES |
| `product.image.manage` | Product Image Management | YES |
| `product.attribute.manage` | Size / Colour Management | YES |
| `product.variant.manage` | Variant Management | YES |
| `product.price.manage` | Price Management | YES |
| `inventory.manage` | Inventory Management | YES |
| `product.visibility.manage` | Product Visibility | YES |
| `order.view` | Order View | YES |
| `order.update` | Order Update | ASSIGNED |
| `order.confirm` | Order Confirmation | YES |
| `order.cancel` | Order Cancellation | ASSIGNED |
| `payment.view` | bKash Payment View | YES |
| `payment.verify` | bKash Payment Verification | YES |
| `payment.reject` | bKash Payment Rejection | YES |
| `payment.review` | Payment Resubmission Review | YES |
| `order.cod.confirm` | COD Order Confirmation | YES |
| `customer.view` | Customer View | YES |
| `customer.update` | Customer Update | ASSIGNED |
| `customer.risk.check` | Customer Risk Check | YES |
| `shipment.view` | Shipment View | YES |
| `shipment.create` | Shipment Creation | YES |
| `courier.select` | Courier Selection | YES |
| `shipment.track` | Shipment Tracking | YES |
| `shipment.retry` | Shipment Retry | YES |
| `shipment.courier.change` | Change Courier | YES |
| `courier.manage` | Courier Configuration | ASSIGNED |
| `cms.manage` | CMS Management | ASSIGNED |
| `user.manager.create` | Manager Create | NO |
| `user.manager.update` | Manager Update | NO |
| `user.manager.delete` | Manager Delete | NO |
| `permission.assign` | Manager Permission Assignment | NO |
| `role.manage` | Role Management | NO |
| `permission.manage` | Permission Management | NO |
| `system.configure` | System Configuration | NO |
| `rbac.configure` | RBAC Configuration | NO |
| `coupon.view` | Coupon View | YES |
| `coupon.create` | Coupon Create | ASSIGNED |
| `coupon.update` | Coupon Update | ASSIGNED |
| `coupon.status` | Coupon Activate/Deactivate | ASSIGNED |
| `coupon.delete` | Coupon Delete/Archive | ASSIGNED |
| `coupon.usage.view` | Coupon Usage View | YES |

`is_administrative = true` for `user.manager.*`, `role.manage`, `permission.assign`, `permission.manage`, `system.configure`, `rbac.configure` (§5.17); `false` for the rest.

`courier.manage` and `courier.select` are two separate rows and must stay separate (§5.16's explicit disambiguation).

### `user_permissions`

Grants of `ASSIGNED`-tier permissions to Manager accounts.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `user_id` | `uuid` | NOT NULL | FK → `users(id)` ON DELETE CASCADE |
| `permission_key` | `text` | NOT NULL | FK → `permissions(key)` ON DELETE RESTRICT |
| `granted_by` | `uuid` | NOT NULL | FK → `users(id)` |
| `granted_at` | `timestamptz` | NOT NULL | `now()` |

- `UNIQUE (user_id, permission_key)` — a grant is idempotent by construction.

### `audit_logs`

Append-only (`database` skill §2.4).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `entity_type` | `text` | NOT NULL | e.g. `order`, `payment`, `shipment`, `user`, `coupon` |
| `entity_id` | `uuid` | NULL | Nullable for system-level events |
| `action` | `text` | NOT NULL | e.g. `status_change`, `permission_grant` |
| `previous_value` | `jsonb` | NULL | §5.21.11 "previous status" |
| `new_value` | `jsonb` | NULL | §5.21.11 "new status" |
| `reason` | `text` | NULL | §5.21.11 "reason where applicable" |
| `actor_user_id` | `uuid` | NULL | FK → `users(id)`; NULL means a system/courier-sync actor |
| `actor_type` | `text` | NOT NULL | `USER` \| `SYSTEM` |
| `request_id` | `text` | NULL | Correlates to spec 01's request ID |
| `created_at` | `timestamptz` | NOT NULL | `now()` |

- Index on `(entity_type, entity_id, created_at DESC)`.
- No `UPDATE`/`DELETE` path exists in application code. The repository exposes `append()` and read functions only — there is no update or delete function to call.

## Backend work

No HTTP routes are added in this slice.

### Shared types (`src/types/`)

One module per enum, mirroring the database exactly, exported for every later spec: `UserRole`, `AccountType`, `AreaUnitType`, `WardUnitType`, `PermissionTier`, and `PermissionKey` (a union of the 47 seeded keys above). Later specs import `PermissionKey` rather than typing permission strings inline.

```ts
export type CustomerAddress = {
  division: string;
  district: string;
  areaUnitType: AreaUnitType;   // UPAZILA | THANA
  areaUnitName: string;
  wardUnitType: WardUnitType;   // UNION | WARD
  wardUnitName: string;
  detailedAddress: string;
  postalCode: string | null;
};

export type CustomerRecord = {
  id: string;
  accountType: AccountType;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  address: CustomerAddress;
};
```

### Services and repositories

- `lib/phone.ts` — `normalizeBdPhone(input): string` and `isValidBdPhone(input): boolean`. Every phone value anywhere in the system passes through this before storage or lookup, so §2.9.4's "reuse the record with the same phone number", §7.6's cache key, and §8.8's per-customer coupon key all agree on one canonical form.
- `lib/password.ts` — `hashPassword` / `verifyPassword` using argon2id (or bcrypt cost ≥ 12). The only place hashing happens (§11.7, §2.1).
- `lib/transaction.ts` — `withTransaction(fn)`. Every later multi-statement atomic operation (order creation §3, stock decrement §5.1, coupon usage §8.25, shipment/order cascade §5.21.6) uses this one helper. If the Supabase JS client cannot express a multi-statement transaction, this helper wraps a direct `pg` connection using the same credentials — see assumption 3.
- `repositories/users.repository.ts` — `findByUserIdentifier`, `findByPhoneNumber`, `findById`, `create`, `update`, `listManagers` (paginated).
- `repositories/customers.repository.ts` — `findByPhoneNumber`, `findById`, `createGuestReference`, `upsertByPhoneNumber`, `promoteToRegistered`, `updateAddress`, `list` (paginated).
- `repositories/permissions.repository.ts` — `listAll`, `listGrantsForUser`, `grant`, `revoke`.
- `repositories/audit.repository.ts` — `append(entry)`, `listForEntity(entityType, entityId, pagination)`. No update or delete function exists.

### Error cases

| Case | Error | Status |
| --- | --- | --- |
| Insert a customer whose phone already exists | `ConflictError` `CUSTOMER_PHONE_EXISTS` | 409 |
| Insert a user whose `user_identifier` or `phone_number` already exists | `ConflictError` `USER_IDENTIFIER_EXISTS` / `USER_PHONE_EXISTS` | 409 |
| Grant a permission key not in `permissions` | `ValidationError` `UNKNOWN_PERMISSION` | 400 |
| Attempt a second `is_system_admin` row | `ConflictError` `SYSTEM_ADMIN_EXISTS` | 409 |

## Frontend work

None. This slice is schema and data-access only.

## Security requirements

- `password_hash` holds only argon2id/bcrypt output; no code path stores or logs a plaintext password, and no repository function returns `password_hash` to a caller outside `auth` services (§2.1, §11.7, §5.12.1 items 6–8).
- `users.role` is constrained by a Postgres enum, so a direct/raw write of `SUPER_ADMIN` or `STAFF` is rejected by the database, not merely by application code (§5.19, `database` skill §2.2).
- A guest `customers` row has no `users` row, therefore no role and no session — guest flows are gated by submitted-field validation, never by RBAC (§5.19 final paragraph).
- `is_system_admin` is set only by the seed script (spec 03) and by nothing else; no repository function exposes it as an updatable field.
- Audit log is append-only by construction: the repository exposes no update/delete (§5.15 rule 10, §5.21.11, `database` skill §2.4).
- No RLS policy is relied upon; every table is reached only through the service-role key from backend code (`01-overview.md` §1.1).
- PII (phone, address) is never copied into `audit_logs` payloads beyond the specific field actually changed (`database` skill §4).

## Data integrity / idempotency

- `UNIQUE (customers.phone_number)` makes "create or reuse the guest customer reference" (§2.9.4) a single upsert rather than a check-then-insert race — two concurrent guest checkouts from the same phone number cannot create two customer rows.
- `UNIQUE (users.phone_number)` enforces §2.1's one-account-per-mobile rule at the database level.
- `UNIQUE (users.customer_id)` prevents §2.9.8's guest→registered promotion from attaching two login identities to one customer record.
- The single-row partial unique index on `is_system_admin` makes the seed in spec 03 idempotent and concurrency-safe (§5.12.2) without relying on the seed script's own check.
- `UNIQUE (user_permissions.user_id, permission_key)` makes a repeated grant a no-op rather than a duplicate row.

## Acceptance criteria

1. `npm run migrate` applies `0002_identity_address_audit.sql`; re-running applies nothing.
2. `INSERT INTO users (role, ...) VALUES ('SUPER_ADMIN', ...)` executed directly against the database fails with an invalid-enum-value error. The same holds for `'STAFF'`.
3. Inserting two `customers` rows with the same `phone_number` fails on the unique constraint.
4. Inserting a `customers` row with `phone_number = '0171234567'` (9 digits) fails the `CHECK`; `'01712345678'` succeeds.
5. Inserting a second row with `is_system_admin = true` fails on the partial unique index.
6. Inserting a `users` row with `role = 'CUSTOMER'` and `customer_id IS NULL` fails the `CHECK`; a row with `role = 'ADMIN'` and a non-null `customer_id` also fails.
7. `SELECT count(*) FROM permissions` returns 47, and `SELECT manager_tier FROM permissions WHERE key = 'cms.manage'` returns `ASSIGNED`, `'order.confirm'` returns `YES`, `'user.manager.create'` returns `NO`.
8. `SELECT count(*) FROM permissions WHERE key IN ('courier.manage','courier.select')` returns 2 with different `manager_tier` values (`ASSIGNED`, `YES`).
9. `normalizeBdPhone('+8801712345678')`, `normalizeBdPhone('8801712345678')`, and `normalizeBdPhone('01712345678')` all return `'01712345678'`.
10. `customersRepository.upsertByPhoneNumber` called twice concurrently with the same phone number yields exactly one row.
11. `auditRepository` exports no function that updates or deletes a row (verified by inspecting the module's exports).
12. `withTransaction` rolls back every statement when the callback throws — verified by inserting a customer then throwing, and confirming no row exists.

## Tests required

Per the `test` skill §2 (RBAC storage) and the `database` skill §2:

1. **Role enum constraint at the data layer** (§5.19) — attempt a direct write of `SUPER_ADMIN` and of `STAFF`; assert the database rejects both, not just application validation. This is the `test` skill's explicitly named "Role enum constraint" case.
2. **One account per mobile number** (§2.1) — a second `users` row with the same `phone_number` is rejected.
3. **One customer record per phone number** (§2.9.4) — concurrent `upsertByPhoneNumber` calls produce one row; this is the rule that makes guest order history, risk-check caching, and per-customer coupon limits coherent.
4. **Customer/admin domain separation** (§5.19) — a `CUSTOMER` row cannot exist without `customer_id`; an `ADMIN`/`MANAGER` row cannot carry one.
5. **Single system admin** (§5.12.3, §5.12.2) — the partial unique index rejects a second `is_system_admin` row.
6. **Permission catalogue matches §5.18** — assert the seeded `manager_tier` for every one of the 47 rows against a table transcribed from the PRD, so a drift between code and the matrix fails a test rather than shipping.
7. **`courier.manage` ≠ `courier.select`** (§5.16) — both exist, with the documented differing tiers.
8. **Address discriminators persist** (§2.2) — a customer stored with `area_unit_type = 'THANA'` reads back as `THANA`, not coerced to `UPAZILA`.
9. **Audit append-only** (§5.15 rule 10) — the audit repository exposes no mutation path, and an appended row round-trips `previous_value`/`new_value`/`actor`/`reason`.
10. **Transaction rollback** — `withTransaction` leaves no partial writes when the callback throws. This is the helper every later atomic rule depends on, so it is tested once here rather than per feature.

## Open questions / assumptions

1. **Bangladesh phone format.** `02-customer.md` §2.9.3 step 2 requires "Bangladesh phone number format validation" but never defines the format. *Assumption:* the canonical stored form is the 11-digit local format `01[3-9]XXXXXXXX`; inputs in `+880…` or `880…` form are normalized to it before storage or lookup. This must be exactly one helper (`normalizeBdPhone`), because three separate features (§2.9.4 record reuse, §7.6 risk cache key, §8.8 coupon per-customer key) silently depend on two phone strings comparing equal.
2. **Division/District/Upazila reference data.** §2.2 and §2.9.3 step 3 require "address structure validation (Division/District/Upazila-Thana/Union-Ward consistency)" but no PRD supplies a geography dataset or says where one comes from. *Assumption:* store these as free text with presence/length validation in this slice, and treat true hierarchical consistency validation as a spec-08 concern once a geography source is chosen. **Flagged:** without a reference dataset, "consistency" cannot be enforced beyond non-empty strings, and courier address mapping (spec 14) may need the dataset the courier itself publishes.
3. **Transaction mechanism.** `01-overview.md` §1.1 fixes Supabase as the platform, and `03-payment-order.md` §3, `05-admin-operations.md` §5.1, and `10-coupon-discount.md` §8.25 all require genuine multi-statement database transactions. The Supabase JS client does not expose interactive transactions. *Assumption:* `withTransaction` uses a direct PostgreSQL connection (the `pg` driver against the same Supabase Postgres instance, credentials in env) for transactional paths, while non-transactional reads continue through the Supabase client. This introduces no new database or framework — it is the same PostgreSQL instance §1.1 already mandates. The alternative (wrapping each atomic operation in a Postgres function called via RPC) is equally acceptable; whichever is chosen must be used consistently, since specs 11–15 all assume `withTransaction` exists.
4. **Admin/Manager email.** §2.8 lists only User ID and Password for Manager accounts, and §2.5's password recovery is customer-only and email-based. *Assumption:* `users.email` stays nullable and Admin/Manager accounts have no self-service password recovery in v1; an Admin resets a Manager's password through Manager Update (spec 03). **Flagged:** the PRDs define no recovery path for a locked-out Admin.
5. **Permission count.** The 47 rows above are the §5.18 matrix rows plus §13.14's confirmation that `cms.manage` is the existing key (not a new one). §5.16 says implementation "must not invent additional permission keys beyond this table without updating both" — the extra keys here (`dashboard.view`, `product.*`, `order.view`, etc.) are not inventions: they are the §5.18 matrix rows that §5.16's shorter table did not need to disambiguate. If a reviewer wants §5.16 to list all 47, that is a PRD edit, not an implementation change.
