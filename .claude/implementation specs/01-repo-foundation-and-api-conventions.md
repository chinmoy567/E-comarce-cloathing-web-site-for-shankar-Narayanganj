# 01 — Repository Foundation, Express Bootstrap, and Shared API Conventions

## Goal

After this slice the repository contains a working, typed, two-application workspace: a Node/Express/TypeScript REST API that boots, connects to Supabase PostgreSQL with the service-role key, exposes a health endpoint, and enforces a single shared request/response/error convention; and a Next.js/React/TypeScript/Tailwind frontend that boots, has the design system's tokens configured in Tailwind, and can call the API through one typed HTTP client. No business feature exists yet — this slice exists so that every later slice plugs into one layering convention, one error shape, one validation mechanism, and one migration runner instead of inventing its own.

## Requirement references

- `01-overview.md` §1.1 — fixed stack (Next.js/React/TypeScript/Tailwind; Node/Express/TypeScript REST; PostgreSQL via Supabase; Supabase Storage); all DB access through the Express backend using the service-role key; browser never talks to Supabase directly; RLS is not the authorization mechanism.
- `01-overview.md` §1 — two interfaces: Customer Storefront and Admin/Manager Back-office.
- `11-security-hardening.md` §11.5 — HTTPS/HSTS, `helmet` headers, CORS restricted to deployed frontend origins, cookie flags.
- `11-security-hardening.md` §11.6 — every endpoint validates input against an explicit schema (zod/joi) before business logic; parameterized DB access only.
- `11-security-hardening.md` §11.4 — request body size limits (`express.json({ limit: '100kb' })`), pagination mandatory on all list endpoints.
- `11-security-hardening.md` §11.9 — secrets only in environment variables, never committed.
- `06-rbac.md` §5.19 — role values constrained to `ADMIN` / `MANAGER` / `CUSTOMER` (the enum is created in spec 02; this spec only establishes the TypeScript type location).
- Skills: `backend` §1–2 (fixed stack, routes → controllers → services → data access layering), `database` §0, §1, §5, §6 (access pattern, `snake_case`, migrations, pagination), `frontend` §1, §8 (stack, design tokens), `security` §0 (Express is the only authorization layer).

## Depends on

None. This is the first slice.

## Scope

**In scope**

- Workspace layout: `backend/` (Express API) and `frontend/` (Next.js app), each with its own `package.json` and `tsconfig.json`, plus a root `package.json` with workspace scripts.
- Backend: Express bootstrap, TypeScript strict config, environment-variable loading and startup validation, Supabase service-role client singleton, `helmet`, CORS allowlist, JSON body size limit, request-ID middleware, structured logger, centralized error handler, `zod` validation middleware, standard success/error envelope, pagination helper, `GET /api/health`.
- Backend layering skeleton: `routes/`, `controllers/`, `services/`, `repositories/`, `middleware/`, `lib/`, `types/`, `config/`.
- Migration runner and the `migrations/` directory convention with an empty baseline migration.
- Frontend: Next.js App Router project, Tailwind configured with the exact design-system palette/spacing/typography tokens, Inter from Google Fonts, base layout, a typed `apiClient` wrapper, and a `/` placeholder page.
- `.env.example` for both apps; `.gitignore` covering `.env*` and `.secrets/`.
- Test runner configured (Vitest or Jest — pick one and use it project-wide) with one passing smoke test per app.

**Out of scope / deferred**

- Any table other than the migration-tracking table — deferred to spec **02**.
- Any authentication or RBAC middleware — deferred to spec **03**.
- Rate limiting — deferred to spec **04** (this slice only leaves the middleware mount point).
- Supabase Storage buckets — deferred to spec **06**.
- Any storefront or admin page beyond a placeholder — deferred to specs **07** onward.
- CDN/WAF and deployment infrastructure (`11-security-hardening.md` §11.4 explicitly calls this a deployment concern, not application code).

## Database changes

Migration file: `backend/migrations/0001_baseline.sql`

Creates only the migration bookkeeping table (if the chosen runner does not create it itself):

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `text` | NOT NULL | — | PRIMARY KEY; migration filename |
| `applied_at` | `timestamptz` | NOT NULL | `now()` | |

Also enable the `pgcrypto` extension so later migrations can use `gen_random_uuid()`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Conventions fixed here and binding on every later spec (per the `database` skill §1, §5):

- `snake_case` table and column names; plural table names.
- Every table has `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` unless the spec states otherwise.
- All money columns are `numeric(12,2)` in BDT. Never floating point.
- Migrations are numbered `NNNN_description.sql`, forward-only, never edited after being applied.

## Backend work

### Directory layout

```text
backend/
  src/
    config/        env.ts (schema-validated env loading), constants.ts
    lib/           supabase.ts (service-role client), logger.ts, errors.ts, pagination.ts
    middleware/    requestId.ts, validate.ts, errorHandler.ts, notFound.ts
    routes/        index.ts, health.routes.ts
    controllers/
    services/
    repositories/
    types/         api.ts, role.ts
    app.ts         (builds the Express app; exported for tests)
    server.ts      (binds the port)
  migrations/
  tests/
```

Layering rule (per the `backend` skill §2), binding on all later specs: **route → controller → service → repository → Supabase.** A route never contains business logic; a controller never queries the database; only a repository touches the Supabase client.

### Routes

| Method | Path | Auth | Permission |
| --- | --- | --- | --- |
| `GET` | `/api/health` | none | none |

```ts
// GET /api/health -> 200
type HealthResponse = {
  status: 'ok';
  uptimeSeconds: number;
  database: 'ok' | 'unavailable';
};
```

The handler performs one trivial `select` against Supabase to report `database`. It never returns version strings, env values, or connection details.

### Shared API envelope (`src/types/api.ts`)

Every endpoint in every later spec uses these shapes. No endpoint invents its own.

```ts
export type ApiSuccess<T> = { data: T };

export type ApiListSuccess<T> = {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type ApiError = {
  error: {
    code: string;          // stable machine-readable code, e.g. 'VALIDATION_ERROR'
    message: string;       // safe, user-presentable text — never a stack trace or driver error
    details?: Array<{ field: string; message: string }>; // field errors only
  };
  requestId: string;
};
```

### Error taxonomy (`src/lib/errors.ts`)

An `AppError` base class with subclasses mapping to fixed status codes. Later specs reference these by name rather than hand-writing status codes.

| Class | Status | `code` |
| --- | --- | --- |
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `InvalidTransitionError` | 409 | `INVALID_TRANSITION` |
| `RateLimitError` | 429 | `RATE_LIMITED` |
| `UpstreamError` | 502 | `UPSTREAM_ERROR` |
| `InternalError` | 500 | `INTERNAL_ERROR` |

The centralized error handler is the only place that writes an error response. It logs the full error server-side with the request ID; it returns only `code`, `message`, and field-level `details` to the client. An unrecognized thrown value becomes `INTERNAL_ERROR` with the generic message `"An unexpected error occurred."` — the original message is never forwarded to the client (`security` skill: error hygiene).

### Validation middleware (`src/middleware/validate.ts`)

```ts
validate({ body?: ZodSchema; query?: ZodSchema; params?: ZodSchema })
```

Runs before the controller, uses `.strict()` schemas so unknown fields are rejected rather than passed through (`11-security-hardening.md` §11.6), and throws `ValidationError` with per-field `details`. Every route in every later spec mounts this.

### Pagination helper (`src/lib/pagination.ts`)

A shared `paginationQuerySchema` (`page` ≥ 1 default 1, `pageSize` 1–100 default 20) and a helper that converts it to Supabase `range()` bounds and builds the `pagination` block. Mandatory on every list endpoint (`11-security-hardening.md` §11.4).

### Supabase client (`src/lib/supabase.ts`)

A single module-level client created from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. It is imported only by files under `repositories/`. The service-role key is never logged, never returned in a response, and never referenced in `frontend/`.

### Configuration (`src/config/env.ts`)

Environment variables are parsed through a zod schema at startup; a missing or malformed required variable aborts the process with a message naming the variable but never printing its value.

Required in this slice: `NODE_ENV`, `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ALLOWED_ORIGINS` (comma-separated), `LOG_LEVEL`. Also declared here (consumed from spec **02** onward, where `withTransaction` is built): `DATABASE_URL` and `PG_POOL_MAX` (default `10`) — the direct PostgreSQL connection and its explicit pool cap. The cap is set deliberately rather than left at the driver default, because the `pg` pool and the Supabase client draw on the same instance's connection limit; exhausting it would fail order creation under load (spec 02, assumption 3).

### Middleware order (`src/app.ts`)

```text
requestId
  → helmet
  → cors (allowlist from CORS_ALLOWED_ORIGINS; never '*')
  → express.json({ limit: '100kb' })
  → request logger
  → [rate limiters — mount point reserved for spec 04]
  → routes
  → notFound
  → errorHandler
```

## Frontend work

- Next.js App Router project in `frontend/`, TypeScript strict, Tailwind CSS.
- `tailwind.config.ts` defines the design system's exact tokens (`design` skill, "Color Palette" / "Typography" / "Spacing System"). No colour outside this set may be used by any later spec:
  - `primary #DC143C`, `primary-hover #B01030`, `primary-active #A00E2A`, `secondary #1F2937`, `accent #059669`, `success #10B981`, `error #DC2626`, `warning #F59E0B`, `info #0EA5E9`, `background #FFFFFF`, `surface #F9FAFB`, `text-primary #111827`, `text-secondary #6B7280`, `text-tertiary #9CA3AF`, `border #E5E7EB`.
  - Spacing scale on a 4px base: `xs 4`, `sm 8`, `md 12`, `lg 16`, `xl 20`, `2xl 24`, `3xl 32`.
  - Breakpoints: `sm 375`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`.
  - Font family Inter, loaded via `next/font/google`.
- `frontend/src/lib/apiClient.ts`: a single typed fetch wrapper that reads `NEXT_PUBLIC_API_BASE_URL`, sends `credentials: 'include'`, unwraps `ApiSuccess<T>`, and throws a typed `ApiClientError` carrying `code`/`message`/`details` so every later page can render backend validation errors rather than inventing its own (`frontend` skill §2, §10).
- Root layout: mobile-first, 16px page gutters, English-only chrome, `<html lang="en">`.
- A `/` placeholder page that calls `GET /api/health` and renders explicit loading / error / success states — this exists to prove the loading/error/success discipline required of every later page.
- No Supabase client, anon key, or service-role key anywhere in `frontend/` — ever.

## Security requirements

- `helmet` is enabled with CSP, `X-Content-Type-Options`, frame-ancestors, `Referrer-Policy`, and HSTS in production (§11.5).
- CORS is an explicit allowlist built from `CORS_ALLOWED_ORIGINS`; wildcard origin is never used, and credentials are only allowed for allowlisted origins (§11.5).
- JSON body limit `100kb` globally; upload endpoints get their own larger, separately-bounded limit in spec 06 (§11.4).
- All environment secrets come from env vars; `.env*` and `.secrets/` are gitignored; no credential literal appears in any tracked file (§11.9, `06-rbac.md` §5.12.1).
- The error handler never leaks stack traces, SQL text, Supabase error payloads, or env values to the client.
- Rate limiting is *not* implemented here but the mount point is reserved so spec 04 does not have to restructure `app.ts`.
- RLS is not used as an authorization control anywhere (`01-overview.md` §1.1); every later route performs its own Express-layer check.

## Data integrity / idempotency

No business data exists yet. Two conventions established here carry forward:

- The migration runner records each applied migration in `schema_migrations` and refuses to re-apply one, so running migrations repeatedly is safe.
- Money is `numeric(12,2)` everywhere; no later spec may introduce a float money column.

## Acceptance criteria

1. `npm run migrate` against a fresh Supabase database applies `0001_baseline.sql` and creates `schema_migrations`; running it a second time applies nothing and exits 0.
2. `npm run dev --workspace backend` starts the API and `GET http://localhost:PORT/api/health` returns `200` with `{"data":{"status":"ok","uptimeSeconds":<n>,"database":"ok"}}`.
3. Starting the backend with `SUPABASE_SERVICE_ROLE_KEY` unset aborts with a message naming the variable, and the message does not contain any other secret's value.
4. A request to `GET /api/health` from an origin not in `CORS_ALLOWED_ORIGINS` is rejected by CORS; a request from an allowlisted origin succeeds.
5. A `POST` to any route with a body larger than 100kb returns `413`, not a parsed request.
6. A route wired with `validate({ body: z.object({ a: z.string() }).strict() })` rejects `{"a":"x","b":1}` with `400` and `error.code === 'VALIDATION_ERROR'` naming field `b`.
7. Forcing a thrown `Error('boom')` inside a controller returns `500` with `error.message === 'An unexpected error occurred.'` — the string `boom` appears in the server log with the request ID, and nowhere in the HTTP response body.
8. Every error response contains a `requestId` matching the `X-Request-Id` response header.
9. `npm run dev --workspace frontend` serves `/` at 375px width with no horizontal scroll; the page shows a loading state, then either the health result or a rendered error message.
10. `grep -ri "supabase" frontend/src` returns no match; `grep -r "SERVICE_ROLE" frontend/` returns no match.
11. Response headers on any backend response include `X-Content-Type-Options: nosniff` and a `Content-Security-Policy`.
12. `npm test` runs and passes in both workspaces.

## Tests required

Per the `test` skill (infrastructure slice — standard coverage, no business rules yet):

1. **Health endpoint** — returns `200` and the documented shape.
2. **Env validation** — building the app with a missing required env var throws at startup and does not start listening.
3. **Validation middleware rejects unknown fields** — proves `.strict()` schemas are the convention (business rule: `11-security-hardening.md` §11.6, "reject unknown/malformed fields rather than passing them through").
4. **Error handler hygiene** — an unexpected thrown error produces the generic message and the original text does not appear in the response body (business rule: no internal detail leakage to clients).
5. **CORS allowlist** — disallowed origin rejected, allowlisted origin permitted (business rule: §11.5, no wildcard CORS).
6. **Body size limit** — an oversized JSON body is rejected with `413` (business rule: §11.4 DoS mitigation).
7. **Pagination helper** — out-of-range `pageSize` is rejected and defaults are applied (business rule: §11.4 mandatory pagination).
8. **Migration idempotency** — running the runner twice applies each migration once.

## Open questions / assumptions

1. **Repository layout.** The PRDs never state whether backend and frontend live in one repository. *Assumption:* a single repository with `backend/` and `frontend/` workspaces, since `01-overview.md` §1.1 treats them as one system and this keeps shared TypeScript types in one place. If the client requires separate repositories, only the workspace scripts change, not the layering.
2. **Test runner.** Not specified anywhere. *Assumption:* Vitest for both workspaces (TypeScript-native, no extra transform config). Any single choice satisfies the `test` skill as long as it is used project-wide; the skill's real requirement is a **real Postgres test database**, not mocks — so the chosen runner must support running against a live test Supabase/Postgres instance.
3. **Logger.** Not specified. *Assumption:* `pino` with redaction configured for `authorization`, `password`, `token`, and `service_role` keys, satisfying §11.9's "never log secrets."
4. **`express.json` limit.** §11.4 gives `100kb` as an example (`e.g.`). *Assumption:* adopt `100kb` literally as the global default; upload endpoints override it in spec 06.
5. **Session transport.** `02-customer.md` §2.4 requires an httpOnly signed token while `11-security-hardening.md` §11.5 says bearer/JWT reduces CSRF exposure but any cookie session still needs CSRF protection. This is decided in spec **03**, not here; this slice only sets `credentials: 'include'` on the client so either choice works without a rewrite.
