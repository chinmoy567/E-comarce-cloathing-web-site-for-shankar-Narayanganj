---
name: database
description: Database design and access strategy for this Bangladesh e-commerce platform — PostgreSQL/Supabase schema conventions, service-role-key-only access pattern, migrations, and the data-integrity rules behind the order/payment/shipment state machine, RBAC, and coupon systems defined in .claude/project requirment documents/
type: skill
version: 1.0
priority: high
---

# Database Skill

**For**: Bangladesh Fashion & Clothing E-Commerce Platform
**Purpose**: Keep schema design and data access consistent with the project's fixed access pattern and the data-integrity rules that the functional spec treats as non-negotiable. Complements `backend-builder` (implements schema/queries) and `architect-reviewer` (reviews structural fit) — read it before designing a table, writing a migration, or reviewing a schema change.

---

## 0. The access pattern is fixed (Section 1.1, `01-overview.md`)

- **PostgreSQL via Supabase.** Never MongoDB or a second database.
- **All access goes through the Express backend using the Supabase service-role key.** The browser/Next.js client never talks to Supabase directly with any key, anon or service-role.
- **Supabase Row Level Security is explicitly not the authorization mechanism** for this project — authorization happens in the Express layer (Section 5.15). Don't design a table assuming RLS policies will enforce access control; the Express route must, regardless of whether RLS is also present. If RLS is used at all here, treat it as defense-in-depth, never as the primary or only control — verify the same rule is enforced in Express before considering an endpoint safe.

## 1. Naming Conventions

- `snake_case` for table and column names, consistent with the PostgreSQL/Supabase stack (explicitly called out in `09-fraud-risk-check.md` Section 7's schema notes) — apply this project-wide, not just to that one table.
- Check existing tables before creating a new one; match the established naming pattern (singular vs. plural table names, `id`/`created_at`/`updated_at` conventions, foreign key naming) rather than introducing a second convention.

## 2. Schema Design Priorities (highest risk first)

Mirrors the same priority order as the `test` and `security` skills — these are the areas where a schema mistake causes real financial or data-integrity harm, not just an inconvenience.

1. **Order/payment/shipment status** (`07-order-state-machine.md`, Section 5.21) — the authoritative enum values live here, not in the narrative diagrams of `02`–`05`/`08`. Payment, order, and shipment status are **three independent columns** (5.21.11) — never derive one from another, never collapse them into a single "status" field.
2. **RBAC role/permission storage** (`06-rbac.md`, Section 5.19) — the role column must be constrained at the **database level** (e.g. `CHECK` constraint or Postgres enum) to only `ADMIN`/`MANAGER`/`CUSTOMER` — there is no "Staff" or "Super Admin," and an application-level-only check is not sufficient; a direct/raw write must also be rejected by the schema.
3. **Coupon usage counters** (`10-coupon-discount.md`, Section 8.8) — usage-limit enforcement needs real concurrency safety at the data layer (e.g. atomic increment with a constraint, or a transaction with appropriate isolation/locking), not a read-then-write pattern in application code that races under concurrent redemptions.
4. **Audit trail tables** — every status change and permission-changing action needs a corresponding audit record (previous value, new value, timestamp, acting user) per 5.21.11 and 5.15 rule 10; design these as append-only, never updatable/deletable by application code.

## 3. Data Integrity Rules

- **Status transitions go through one mechanism.** Don't rely on application code discipline alone to prevent a direct status write bypassing the transition validation — where practical, make invalid states structurally harder to reach (e.g. a transition-log table as the source of truth, with the status column derived/written only by the transition function).
- **Stock decrements happen at `CONFIRMED`, not order placement** (Section 5.1) and must be restorable on cancellation — model stock so both directions (decrement, restore) are simple, auditable operations, not ad hoc arithmetic scattered across code paths.
- **Idempotent courier status sync** (Section 4.6) — schema/constraints should make it possible to detect and no-op a duplicate or out-of-order webhook update (e.g. a monotonic status-sequence check or a unique constraint on the update event), not rely purely on application-level checking.
- **Address model is shared** between registered and guest customers (Section 2.2, 2.9) — don't create a separate/reduced address table or shape for guest orders; the same schema must map identically to courier address requirements (Section 4.2) and admin/manager order views.
- **Upazila/Thana and Union/Ward are one field each with two naming conventions**, not four separate fields (Section 2.2 note) — store a type discriminator so the correct convention can be resolved, don't model this as redundant columns.
- **Coupon eligibility/restriction fields exist in the schema even if unused in v1** (Section 8.6, product/category restriction is v1-optional) — don't remove or omit these columns just because a feature is deferred; the schema should not need to change later when the feature is implemented.
- **`content_config`/`visual_theme` JSONB fields** (Homepage CMS, `13-homepage-cms.md` Section 13.3) are validated server-side against a fixed per-type schema before storage — the database storing arbitrary JSON is fine, but the application layer must never persist an unvalidated shape.

## 4. Secrets & Sensitive Data in the Database

- Courier API credentials, Meta CAPI tokens, and any other third-party secrets live in environment/config, **not** in a database table readable by application queries beyond the specific service that needs them.
- Fraud/risk-check `raw_result` (Section 7) stores the provider's full raw response for audit purposes but is **not** returned to the frontend verbatim — only fields Section 7.5 defines as displayable. Model this as a clear separation (a column/table not exposed by any general-purpose "select *" style query path), not something enforced only by remembering to filter it in every handler.
- PII (customer addresses, phone, payment details) is not duplicated into logs or analytics tables beyond what each specific feature's spec (e.g. Meta CAPI's hashed-field requirement, Section 6.5) explicitly requires.

## 5. Migrations

- Every schema change is a migration file, never a manual/ad hoc change applied directly against the database — the migration history is the source of truth for schema evolution.
- Migrations are additive/backward-compatible where practical (add nullable column, backfill, then tighten constraint in a later migration) for anything touching a table already holding production data — avoid a single migration that both adds a `NOT NULL` column and has no default/backfill step for existing rows.
- Never edit a migration that has already been applied/merged — write a new migration to correct it, the same rule as never rewriting published git history.

## 6. Query Patterns

- Avoid N+1 queries against Supabase — batch/join where the Supabase client supports it rather than looping application-side queries per row.
- Pagination on any list endpoint that could grow unbounded (orders, customers, products) — no endpoint should assume small production data volume.
- Raw SQL (via `pg`/`postgres` direct connection) is acceptable when the Supabase client can't express a query cleanly, but never string-concatenate user input into it — parameterize always (this is also a `security` skill item; a SQL-injection bug is both a data-integrity and security failure).

---

## General rules for this project

- **Read `07-order-state-machine.md` and `06-rbac.md` before modeling any table those areas touch** — they are the authoritative source for enum values and role constraints, not the narrative docs.
- **A schema that only works correctly if the application layer behaves perfectly is a latent bug** — prefer constraints, checks, and atomic operations at the database level for the highest-risk areas in Section 2 above, over trusting application discipline alone.
- **Don't design speculative tables/columns for features not yet requested** — the coupon-restriction-fields exception above is deliberate (documented in the spec itself), not a general license to add unused schema.
