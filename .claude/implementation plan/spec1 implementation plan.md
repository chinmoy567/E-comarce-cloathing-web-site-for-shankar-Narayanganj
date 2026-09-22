# Spec 01 — Repository Foundation, Express Bootstrap, and Shared API Conventions

## Context

The repository currently contains **only documentation** — `git ls-files` shows nothing but `.claude/` specs, PRDs and skills. There is no code at all.

`.claude/implementation specs/00-index.md` breaks the build into 21 sequential slices. Spec 01 is the foundation with no dependencies: it exists so that the other 20 slices plug into **one** layering convention, **one** error shape, **one** validation mechanism, **one** pagination helper and **one** migration runner instead of each inventing its own. Per the index, spec 01 is the 3rd-highest-leverage slice — every route in the system inherits its conventions.

Outcome: a typed two-app npm workspace that boots. Express API with a health endpoint, Supabase service-role client, the full error taxonomy, zod validation and the migration runner; Next.js frontend with the exact design-system Tailwind tokens and a typed `apiClient`. **No business feature** — tables beyond migration bookkeeping are spec 02, auth/RBAC is spec 03, rate limiting is spec 04.

### Decisions confirmed with the user

- **No Supabase credentials yet.** I build the full scaffold and write `.env.example` placeholders. Acceptance criteria 1 and 2 (live migrate + `database: "ok"`) are left for the user to run once they create the Supabase project. Everything else is verified now.
- **Spec defaults accepted** (its own stated assumptions 1–3): Vitest project-wide, `pino` with secret redaction, single repo with npm workspaces.

---

## Approach

Follow `.claude/implementation specs/01-repo-foundation-and-api-conventions.md` as written — it is unusually prescriptive (exact file paths, exact error table, exact hex tokens). No reinterpretation needed. Build in six steps.

### Step 1 — Workspace root

- Root `package.json`: `"workspaces": ["backend", "frontend"]`, private, scripts `dev:backend`, `dev:frontend`, `migrate`, `test` (delegating to workspaces).
- `.gitignore` already covers `.env*`, `.secrets/`, `node_modules/`, `dist/` — **verify only, do not rewrite** (spec §Security requirement 4 is already satisfied).
- Root `tsconfig.base.json` with `strict: true`, extended by both workspaces.

### Step 2 — Backend skeleton (`backend/`)

Exact layout from the spec:

```
backend/src/
  config/       env.ts, constants.ts
  lib/          supabase.ts, logger.ts, errors.ts, pagination.ts
  middleware/   requestId.ts, validate.ts, errorHandler.ts, notFound.ts
  routes/       index.ts, health.routes.ts
  controllers/  health.controller.ts
  services/     health.service.ts
  repositories/ health.repository.ts
  types/        api.ts, role.ts
  app.ts        server.ts
backend/migrations/  0001_baseline.sql
backend/tests/
```

**Binding layering rule** (backend skill §2): route → controller → service → repository → Supabase. The health endpoint deliberately walks all four layers so later specs have a working reference, even though it is trivial.

Key files:

- **`config/env.ts`** — zod-parsed env at startup. Required: `NODE_ENV`, `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ALLOWED_ORIGINS`, `LOG_LEVEL`. Also declared for spec 02: `DATABASE_URL`, `PG_POOL_MAX` (default 10). On failure: abort naming the variable, **never printing its value**.
- **`types/api.ts`** — `ApiSuccess<T>`, `ApiListSuccess<T>`, `ApiError` exactly as the spec's TypeScript block. Every later endpoint imports these.
- **`lib/errors.ts`** — `AppError` base plus the nine subclasses in the spec's table (`ValidationError` 400 … `InternalError` 500), including `InvalidTransitionError` 409 which spec 12 will use.
- **`middleware/errorHandler.ts`** — the *only* place an error response is written. Logs full error server-side with request ID; returns `code`/`message`/`details` + `requestId` only. Unrecognized throws → `INTERNAL_ERROR` + `"An unexpected error occurred."`
- **`middleware/validate.ts`** — `validate({ body?, query?, params? })` with `.strict()` schemas, throwing `ValidationError` with per-field `details`.
- **`lib/pagination.ts`** — `paginationQuerySchema` (`page` ≥ 1 default 1, `pageSize` 1–100 default 20) plus a helper producing Supabase `range()` bounds and the `pagination` block.
- **`lib/supabase.ts`** — one module-level service-role client, imported **only** by `repositories/`.
- **`lib/logger.ts`** — pino with redaction on `authorization`, `password`, `token`, `service_role`.
- **`app.ts`** — middleware in the spec's exact order, with a **reserved comment mount point for spec 04's rate limiters** so spec 04 need not restructure:

```
requestId → helmet → cors(allowlist, never '*') → express.json({limit:'100kb'})
  → request logger → [rate limiters: spec 04] → routes → notFound → errorHandler
```

`app.ts` exports the app for tests; `server.ts` binds the port.

### Step 3 — Migration runner

- `backend/migrations/0001_baseline.sql`: `CREATE EXTENSION IF NOT EXISTS pgcrypto;` + `schema_migrations (id text PK, applied_at timestamptz NOT NULL DEFAULT now())`.
- `backend/scripts/migrate.ts`: reads `migrations/*.sql` in filename order over a `pg` connection using `DATABASE_URL`, applies each unapplied file **inside a transaction**, records it in `schema_migrations`, skips already-applied ones, exits 0 when nothing to do.
- Conventions fixed here and binding on specs 02–21: `snake_case` plural tables; `id uuid PK DEFAULT gen_random_uuid()`, `created_at`, `updated_at` on every table; **money is `numeric(12,2)`, never float**; migrations `NNNN_description.sql`, forward-only, never edited after apply.

### Step 4 — Frontend (`frontend/`)

- Next.js App Router, TypeScript strict, Tailwind.
- `tailwind.config.ts` with the exact tokens — verified against `.claude/skills/design/SKILL.md` lines 78–170, which match the spec character for character: `primary #DC143C`, `primary-hover #B01030`, `primary-active #A00E2A`, `secondary #1F2937`, `accent #059669`, `success #10B981`, `error #DC2626`, `warning #F59E0B`, `info #0EA5E9`, `background #FFFFFF`, `surface #F9FAFB`, `text-primary #111827`, `text-secondary #6B7280`, `text-tertiary #9CA3AF`, `border #E5E7EB`. Spacing 4px base (xs 4 … 3xl 32). Breakpoints sm 375 / md 768 / lg 1024 / xl 1280 / 2xl 1536. Inter via `next/font/google`.
- **`frontend/src/lib/apiClient.ts`** — the single typed fetch wrapper: reads `NEXT_PUBLIC_API_BASE_URL`, `credentials: 'include'` (keeps both session transports in spec 03 open), unwraps `ApiSuccess<T>`, throws `ApiClientError` carrying `code`/`message`/`details`.
- Root layout mobile-first, 16px gutters, `<html lang="en">`, English-only.
- `/` placeholder calling `GET /api/health` with **explicit loading / error / success states** — the reference pattern every later page follows.
- **Hard rule:** no Supabase client, anon key or service-role key anywhere under `frontend/`, ever.

### Step 5 — Env templates

`backend/.env.example` and `frontend/.env.example` with every variable named and **placeholder values only**. No real credential is written to any tracked file. `.secrets/seed-credentials.md` holds admin bootstrap credentials — that is **spec 03's** concern, untouched here.

### Step 6 — Tests (Vitest, both workspaces)

The spec's eight required tests:

1. Health endpoint returns 200 and the documented shape.
2. Missing required env var throws at startup, does not listen.
3. Validation middleware rejects unknown fields (`.strict()` convention).
4. Error-handler hygiene — thrown `Error('boom')` → generic message, `boom` absent from the response body.
5. CORS allowlist — disallowed origin rejected, allowlisted permitted.
6. Body size limit — oversized JSON → 413.
7. Pagination helper — out-of-range `pageSize` rejected, defaults applied.
8. Migration idempotency — runner applied twice applies each file once.

Tests 1 and 8 touch the database; they will be written and skipped-with-reason (or run against the DB the user configures) since no Supabase project exists yet. Tests 2–7 run fully offline now.

---

## Critical files created

| Path | Why it matters downstream |
| --- | --- |
| `backend/src/types/api.ts` | Every endpoint in specs 02–21 uses this envelope |
| `backend/src/lib/errors.ts` | Later specs reference these classes by name, never hand-write status codes |
| `backend/src/middleware/validate.ts` | Mounted by every later route |
| `backend/src/lib/pagination.ts` | Mandatory on every list endpoint |
| `backend/src/app.ts` | Holds spec 04's reserved rate-limiter mount point |
| `backend/scripts/migrate.ts` + `migrations/0001_baseline.sql` | Every later schema change goes through this |
| `frontend/tailwind.config.ts` | No later spec may use a colour outside this set |
| `frontend/src/lib/apiClient.ts` | Every later page's backend access |

## Out of scope (deferred, per spec)

Any table beyond `schema_migrations` → **02**. Auth/RBAC middleware → **03**. Rate limiting → **04** (mount point only). Storage buckets → **06**. Real pages → **07**+. CDN/WAF/deployment → infrastructure, not code.

---

## Verification

**Runnable now, without a database:**

- `npm install` at root resolves both workspaces.
- `npm test` passes in both workspaces (tests 2–7 above).
- `npm run dev --workspace frontend` serves `/` at 375px with no horizontal scroll; shows loading → error state (API not running / DB absent) — proving the error path renders.
- `npx tsc --noEmit` clean in both workspaces under `strict`.
- `grep -ri "supabase" frontend/src` → no match; `grep -r "SERVICE_ROLE" frontend/` → no match (criterion 10).
- Start backend with `SUPABASE_SERVICE_ROLE_KEY` unset → aborts naming that variable only (criterion 3).
- `curl -i` a backend response → `X-Content-Type-Options: nosniff` + `Content-Security-Policy` present (criterion 11); every error body carries a `requestId` matching the `X-Request-Id` header (criterion 8).
- Oversized body → 413 (criterion 5); unknown field → 400 `VALIDATION_ERROR` naming the field (criterion 6); thrown `boom` → 500 generic, `boom` in the log only (criterion 7); cross-origin request rejected (criterion 4).

**Deferred to the user once Supabase exists** (fill `backend/.env`, then):

- `npm run migrate` → creates `schema_migrations` + `pgcrypto`; second run applies nothing, exits 0 (criterion 1).
- `GET /api/health` → `200 {"data":{"status":"ok","uptimeSeconds":<n>,"database":"ok"}}` (criterion 2).

I will report exactly which criteria were verified and which await credentials — no criterion will be claimed as passing unverified.
