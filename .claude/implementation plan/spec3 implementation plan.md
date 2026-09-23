# Spec 03 — Admin Seed, Back-office Auth, RBAC Middleware, Manager Management

## Context

Spec 02 (identity schema, `users`/`permissions`/`user_permissions`/`audit_logs` tables,
`hashPassword`/`verifyPassword`, `withTransaction`, repositories) is already implemented
and committed. Spec 03 is the next unimplemented slice: it makes the back-office reachable
by adding the Admin seed, session issuance (JWT access + rotating refresh cookies, scope-
separated from customer sessions), `requireAuth`/`requirePermission` middleware, Manager
account/permission management, audit logging on every change, and the admin frontend shell.

The spec document (`.claude/implementation specs/03-admin-auth-rbac-manager-accounts.md`)
is already fully detailed — exact routes, request/response types, validation rules, error
codes, service-layer transaction steps, and 20 acceptance criteria. This plan maps that
spec onto this codebase's existing conventions (found in spec 01/02 code) rather than
re-deriving the design.

Two small foundational gaps must be closed before the feature code, because spec 03's
error catalogue and audit listing don't fit today's helpers exactly:

1. **`AppError` subclasses hard-code one `code` literal each** (`backend/src/lib/errors.ts`).
   Spec 03 needs several distinct `code` values sharing one HTTP status (e.g. 401:
   `INVALID_CREDENTIALS` vs `UNAUTHORIZED`; 403: `FORBIDDEN`, `CSRF_FAILED`,
   `CANNOT_MODIFY_SELF`, `CANNOT_GRANT_UNHELD_PERMISSION`, `PASSWORD_CHANGE_REQUIRED`;
   400: `VALIDATION_ERROR`, `WEAK_PASSWORD`, `PERMISSION_NOT_ASSIGNABLE`; 409:
   `CONFLICT`, `USER_IDENTIFIER_EXISTS`). Fix: give each class a `code` field settable
   via an optional constructor param that defaults to today's literal, so every existing
   call site (`throw new NotFoundError('...')`) keeps compiling unchanged, and spec 03 can
   do `throw new ForbiddenError('...', undefined, 'CSRF_FAILED')`.
2. **`audit.repository.ts` only exports `listForEntity(entityType, entityId, ...)`**
   (single-entity history). Spec 03's `GET /api/admin/audit-logs` needs a general,
   filterable-by-entity-type listing with no id. Fix: add `listAll(filter?: { entityType?
   string }, pagination, db?)` alongside the existing function — additive, no signature
   change to what spec 02's code already calls.

No JWT or cookie-parsing library is installed yet (`backend/package.json` has none of
`jsonwebtoken`, `jose`, `cookie-parser`, `cookie`). This plan adds `jsonwebtoken` +
`@types/jsonwebtoken` and `cookie-parser` + `@types/cookie-parser` — both are the
standard, unsurprising choice for Express + signed JWT/cookie flows and introduce no new
architectural layer (CLAUDE.md §2 "do not introduce another … framework" is about the
stack tier, not a utility library).

## Migration

`backend/migrations/0003_admin_sessions.sql` (next number after `0002_identity_address_audit.sql`)

Create `refresh_tokens` exactly as specced: `id`, `user_id` FK → `users(id)` ON DELETE
CASCADE, `token_hash` (unique), `scope` (`admin`|`customer`), `expires_at`, `revoked_at`,
`replaced_by` (self-FK), `created_at`. Index on `(user_id, revoked_at)`.

## Backend — new files

**Config / constants**
- `backend/src/config/env.ts` — add `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (both
  `z.string().min(32)`), `ADMIN_ACCESS_TOKEN_TTL_MIN` (default 15), `ADMIN_REFRESH_TOKEN_TTL_DAYS`
  (default 7), `SEED_ADMIN_USER_ID`/`SEED_ADMIN_PASSWORD` are read directly by the seed
  script from `process.env`, not through the shared schema, since they're optional at
  server-boot time but required at seed time (per spec: "exit non-zero" is a seed-script
  concern, not a server-boot concern).
- `backend/src/config/constants.ts` — add `PASSWORD_MIN_LENGTH = 12`, cookie names
  (`ADMIN_ACCESS_COOKIE = 'admin_at'`, `ADMIN_REFRESH_COOKIE = 'admin_rt'`,
  `ADMIN_CSRF_COOKIE = 'admin_csrf'`), `CSRF_HEADER = 'x-csrf-token'`.

**Validation**
- `backend/src/validation/password.ts` — shared `passwordSchema` (≥12 chars, ≥1 letter,
  ≥1 digit) used by seed, Manager creation, change-password. One validator, per spec's
  "it is one shared validator."
- `backend/src/validation/admin.validation.ts` — zod `.strict()` schemas for: login,
  refresh (no body), change-password, create-manager, update-manager, set-manager-permissions,
  audit-log query (entityType filter + pagination). `userIdentifier`: 3–64 chars,
  `^[a-zA-Z0-9._-]+$`, trimmed.

**Lib**
- `backend/src/lib/session.ts` — access-token sign/verify (`jsonwebtoken`, claims
  `{ sub, scope, role, tokenVersion }`, `exp` from `ADMIN_ACCESS_TOKEN_TTL_MIN`), opaque
  refresh-token generation (`crypto.randomBytes(32)`) + SHA-256 hashing for storage,
  CSRF token generation. Mirrors the "single mechanism" pattern of `lib/transaction.ts` —
  spec 08 (customer sessions) reuses this module with `scope: 'customer'`.

**Repository**
- `backend/src/repositories/refreshTokens.repository.ts` — `create`, `findByHash`,
  `revoke`, `revokeChainForUser`, following the `db.ts`/`run()`/`toDomainError` pattern
  already used by `users.repository.ts` and `permissions.repository.ts`.
- `backend/src/repositories/audit.repository.ts` — add `listAll` (additive, see Context).

**Middleware**
- `backend/src/middleware/requireAuth.ts` — `requireAuth(scope: 'admin' | 'customer')`:
  verifies the access-token cookie, checks `scope` claim, loads the user via
  `users.repository.findById`, rejects `401 UNAUTHORIZED` on missing/expired/wrong-scope/
  inactive user, attaches `req.actor = { userId, role, permissions }` (permissions resolved
  via the service below). Also checks CSRF (`X-CSRF-Token` header vs `admin_csrf` cookie)
  for admin-scope, state-changing methods, rejecting `403 CSRF_FAILED`.
- `backend/src/middleware/requirePermission.ts` — `requirePermission(key: PermissionKey)`,
  runs after `requireAuth('admin')`, checks `req.actor.permissions`, rejects `403 FORBIDDEN`.
- `backend/src/middleware/requirePasswordChanged.ts` — rejects `403 PASSWORD_CHANGE_REQUIRED`
  when `req.actor` user has `mustChangePassword: true`, mounted on every admin route except
  `/auth/me`, `/auth/change-password`, `/auth/logout`.
- Extend `backend/src/types/express` (check if an existing `Request` augmentation file
  exists from spec 01/02 — if not, add one) with `req.actor`.

**Services**
- `backend/src/services/permissions.service.ts` — `resolveEffectivePermissions(userId,
  role)`: ADMIN → all `admin_tier='YES'` keys from `permissions.repository.listAll()`;
  MANAGER → `manager_tier='YES'` keys ∪ granted `ASSIGNED` keys via
  `permissions.repository.listGrantsForUser`, filtering out any stray `NO`-tier grant.
- `backend/src/services/adminAuth.service.ts` — `login`, `refresh` (rotate + reuse
  detection via `revokeChainForUser`), `logout`, `changePassword`. Login: identical
  response/timing-insensitive message for unknown identifier vs wrong password vs
  inactive account (`INVALID_CREDENTIALS`); on success, update `last_login_at`, issue
  tokens, write CSRF cookie.
- `backend/src/services/managers.service.ts` — `createManager`, `updateManager`,
  `deactivateManager`/`reactivateManager`, `deleteManager`, `setManagerPermissions`,
  `listManagers` — each exactly per the spec's "Service-layer rules and transaction
  boundaries" section, using `withTransaction`, `users.repository`,
  `permissions.repository`, `audit.repository.append` (same transaction client).
- `backend/src/services/auditLog.service.ts` — thin wrapper for the read endpoint using
  `audit.repository.listAll`.

**Controllers + routes**
- `backend/src/controllers/adminAuth.controller.ts`, `managers.controller.ts`,
  `auditLogs.controller.ts`, `permissionsCatalogue.controller.ts` — thin, delegate to
  services, mirror `geography.controller.ts`'s try/catch/`next(err)` shape.
- `backend/src/routes/admin/auth.routes.ts`, `admin/managers.routes.ts`,
  `admin/auditLogs.routes.ts`, `admin/permissions.routes.ts`, `admin/index.ts` (mounts
  the four, applies `requireAuth('admin')` + `requirePasswordChanged` at the router level
  except where the table says "none"/"refresh cookie").
- `backend/src/routes/index.ts` — `router.use('/admin', adminRoutes)`.
- `backend/src/app.ts` (or wherever `helmet`/`cors`/json body parser are wired) — add
  `cookie-parser` middleware.

**Scripts**
- `backend/src/scripts/seedAdmin.ts` — exact 6-step sequence from the spec (env check →
  password policy → hash → `INSERT … ON CONFLICT DO NOTHING` targeting
  `users_single_system_admin_key` → log one of two fixed lines → audit row
  `actor_type='SYSTEM', action='admin_seeded'`).
- `backend/src/scripts/resetAdminPassword.ts` — the out-of-band CLI per spec (refuse
  without `SUPABASE_SERVICE_ROLE_KEY`, read password from prompt/`ADMIN_RESET_PASSWORD`,
  update scoped by `is_system_admin = true`, delete all that user's `refresh_tokens` rows,
  audit `actor_type='SYSTEM', actor_user_id=NULL, action='OUT_OF_BAND_ADMIN_RESET'`).
- `backend/package.json` — add `"seed:admin": "tsx src/scripts/seedAdmin.ts"` and
  `"admin:reset-password": "tsx src/scripts/resetAdminPassword.ts"`, matching the existing
  `seed:geography` pattern.

## Frontend — new files

Under `frontend/src/app/admin/`:
- `login/page.tsx` — User ID + password form, idle/submitting/error/success states,
  generic error message, 44px inputs, `#DC143C` focus border.
- `change-password/page.tsx` — shown/forced when `mustChangePassword`.
- `layout.tsx` (the shell) — header + logout, nav built from `/auth/me`'s `permissions`
  array, redirects to `/admin/change-password` while `mustChangePassword` is true.
- `managers/page.tsx` — paginated list, card-per-row at mobile widths, `Add Manager` CTA.
- `managers/new/page.tsx`, `managers/[id]/page.tsx` — form + permission checklist grouped
  by operational/administrative split, disabling permissions the current Admin lacks.
- `audit-logs/page.tsx` — paginated, filterable by entity type.
- A small `frontend/src/lib/adminApi.ts` (or reuse an existing API client convention if
  spec 02's customer work already established one — check `frontend/src/lib/` first) for
  calls that always send credentials (cookies) and the CSRF header on mutations.
- `frontend/src/app/robots.ts` (if it exists from spec 07 already) is untouched here;
  note only — spec 07 owns `/admin` disallow.

All pages follow the `design`/`frontend` skill conventions already established (explicit
loading/empty/error/success states, no gradients, documented palette).

## Verification

- `npm run migrate` applies `0003_admin_sessions.sql` cleanly against the test DB.
- `npm run seed:admin` (with env vars set) creates one Admin; run twice → idempotent;
  run with `SEED_ADMIN_PASSWORD` unset → non-zero exit, variable named, no value printed.
- `npm run typecheck` and `npm test` pass, including the new `testing-agent`-authored
  suite covering the spec's 14 "Tests required" items and 20 acceptance criteria
  (delegate test-writing to the `testing-agent` after implementation, per this repo's
  established workflow — do not hand-write tests myself in the implementation pass).
- Manual smoke: login as seeded Admin → forced password change → create a Manager with
  one `ASSIGNED` permission → confirm `/auth/me` reflects it → attempt Manager-on-Manager
  action → 403 → check `/admin/audit-logs` shows matching rows.
- Confirm no `code` field on any existing thrown `AppError` subclass changed (grep for
  `new NotFoundError(`, `new ForbiddenError(` etc. across the repo and confirm they still
  compile with 1 or 2 args, unaffected by the new optional 3rd param).
