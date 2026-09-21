# 03 — Admin Seed, Back-office Authentication, RBAC Middleware, Manager Account Management

## Goal

After this slice the back-office is reachable and correctly gated: an idempotent seed script creates the single protected system Admin from environment variables; Admin/Manager users log in with a scoped session that can never be used on customer endpoints; every protected route can declare a required permission key that is enforced server-side against the §5.18 matrix plus per-user grants; and the Admin can create, update, deactivate, delete Managers and grant/revoke their `Assigned` permissions under the full hierarchy rules — with every permission-changing action audited. Every later admin feature simply mounts `requirePermission('...')` instead of re-deriving authorization.

## Requirement references

- `02-customer.md` §2.7 — initial administrator account created via database seed at first deployment; bootstrap credentials from env vars; password changed on first login; no back-office UI for creating it.
- `02-customer.md` §2.8 — Admin creates Manager accounts with User ID + Password; each Manager account separate from the Admin account.
- `02-customer.md` §2.4 — sessions use an httpOnly, signed token with a defined expiry and refresh mechanism; **customer and admin/manager sessions use separate token scopes** so neither can access the other's endpoints.
- `06-rbac.md` §5.10–5.11 — Admin → Manager hierarchy; no Super Admin, no Staff; Manager must not manage Admin accounts, other Manager accounts, its own role, or its own permissions.
- `06-rbac.md` §5.12 — what Admin can and cannot do; Admin cannot create another Admin through the back-office UI; Admin cannot grant a permission it does not itself possess.
- `06-rbac.md` §5.12.1 — seed reads `SEED_ADMIN_USER_ID` / `SEED_ADMIN_PASSWORD` from env, validates presence, hashes the password, creates role `ADMIN`, never stores/logs/exposes/commits the plaintext.
- `06-rbac.md` §5.12.2 — the seed is idempotent and must not create a duplicate Admin; use unique constraints and/or upsert.
- `06-rbac.md` §5.12.3 — the seeded Admin carries `is_system_admin` and is protected from deletion, role change, disabling, and permission change — including by the Admin itself through the normal account-management UI.
- `06-rbac.md` §5.13 — what Managers may and must not do.
- `06-rbac.md` §5.14 Rule 2 — Manage Admin: No/No; Create/Update/Delete/Deactivate Manager: Admin Yes, Manager No.
- `06-rbac.md` §5.15 rules 1–10 — permission assignment rules, including rule 6 (grantor cannot grant what it does not hold, enforced **at grant time**), rule 7 (no role set above the actor's own management scope, at creation *or* later change), rule 9 (backend authorizes every permission-changing action), rule 10 (every such action is audit-logged).
- `06-rbac.md` §5.16 — permission-key ↔ matrix-row mapping; `permission.assign` gates granting/revoking `Assigned`-tier permissions; `courier.manage` and `courier.select` are separate checks.
- `06-rbac.md` §5.17 — operational vs administrative permission separation.
- `06-rbac.md` §5.18 — the permission matrix the backend must enforce for every protected endpoint.
- `06-rbac.md` §5.19 — role enum; customer role never grants back-office access.
- `11-security-hardening.md` §11.3 — Admin/Manager login rate-limited by the same mechanism as customer login, "no exemption for back-office accounts"; general per-account ceiling on authenticated routes.
- `11-security-hardening.md` §11.7 — password hashing, minimum password policy, short-lived tokens, revocable/rotated refresh tokens, RBAC re-checked server-side on every request.
- `11-security-hardening.md` §11.5 — cookie flags (`httpOnly`, `secure`, `sameSite`), CSRF protection for cookie sessions.
- Skills: `backend` §4, `security` §2 (full RBAC list), `test` §2 (required RBAC coverage), `database` §2.2.

## Depends on

- **01** — Express app, error taxonomy, validation middleware, pagination, logger, env loading.
- **02** — `users`, `customers`, `permissions` (seeded), `user_permissions`, `audit_logs`; `user_role` enum; `hashPassword`/`verifyPassword`; `withTransaction`; `PermissionKey` type.

## Scope

**In scope**

- Seed script creating the system Admin, idempotently.
- Back-office session issuance/verification with an `admin` token scope, refresh and logout.
- `requireAuth('admin')` and `requirePermission(key)` middleware.
- The permission-resolution service (role tier + per-user grants → effective permissions).
- Admin/Manager login, refresh, logout, "who am I", and forced first-login password change.
- Manager account management: list, create, update, deactivate/reactivate, delete.
- Manager permission grant/revoke.
- Audit-log write on every account and permission change; audit-log read endpoint.
- Admin back-office frontend: login page, forced password-change page, Managers list/detail with permission checkboxes, and the admin app shell with permission-aware navigation.

**Out of scope / deferred**

- Customer registration/login/profile/password recovery — deferred to spec **08** (customer sessions are a different scope; this slice only guarantees the scopes cannot cross).
- Rate limiting implementation — deferred to spec **04**; this slice declares which endpoints need which limits, and spec 04 wires them.
- Every domain feature that *uses* `requirePermission` — deferred to its own spec.
- Admin/Manager password **self-service** recovery (an in-app "forgot password" flow for back-office accounts) — no PRD defines one, and §2.5's flow is explicitly customer-and-email-only. The operational recovery path for the seeded Admin is the CLI procedure under "Backend work"; a Manager who forgets their password is reset by the Admin via the existing Manager-update route.

## Database changes

Migration file: `backend/migrations/0003_admin_sessions.sql`

### `refresh_tokens`

Server-side storage so refresh tokens are revocable and rotatable (§11.7).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | NOT NULL | — | FK → `users(id)` ON DELETE CASCADE |
| `token_hash` | `text` | NOT NULL | — | SHA-256 of the token; the raw token is never stored |
| `scope` | `text` | NOT NULL | — | `admin` \| `customer` — spec 08 reuses this table |
| `expires_at` | `timestamptz` | NOT NULL | — | |
| `revoked_at` | `timestamptz` | NULL | — | Set on logout or on rotation |
| `replaced_by` | `uuid` | NULL | — | FK → `refresh_tokens(id)`; rotation chain |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- `UNIQUE (token_hash)`; index on `(user_id, revoked_at)`.

No other schema change: `users`, `permissions`, `user_permissions`, and `audit_logs` already exist from spec 02.

## Backend work

### Seed script

`backend/src/scripts/seedAdmin.ts`, run via `npm run seed:admin`.

Sequence, exactly per §5.12.1:

1. Read `SEED_ADMIN_USER_ID` and `SEED_ADMIN_PASSWORD` from env. If either is missing or empty, exit non-zero with `"SEED_ADMIN_USER_ID and SEED_ADMIN_PASSWORD must both be set"` — naming the variables, never printing a value.
2. Validate the password against the minimum policy (§11.7) and fail the run if it does not meet it.
3. Hash with `hashPassword` (spec 02).
4. `INSERT INTO users (role, user_identifier, password_hash, is_system_admin, must_change_password) VALUES ('ADMIN', $1, $2, true, true) ON CONFLICT DO NOTHING` — the conflict target is the partial unique index on `is_system_admin` from spec 02, so concurrent or repeated runs cannot produce a second Admin (§5.12.2).
5. Log only `"System admin already exists; no changes made."` or `"System admin created."` — never the identifier's password, never the hash.
6. Append an `audit_logs` row with `actor_type = 'SYSTEM'`, `action = 'admin_seeded'`.

`must_change_password = true` implements §2.7's note. The plaintext appears in no database column, no log line, and no tracked file (§5.12.1 items 6–9).

### Out-of-band Admin password reset

`backend/src/scripts/resetAdminPassword.ts`, run via `npm run admin:reset-password`.

No PRD defines a recovery path for the seeded Admin, and §5.12.3 makes that account non-deletable — leaving the platform one forgotten password away from being unadministrable. This CLI closes that hole without widening the attack surface. It is **deliberately not an HTTP endpoint**: a network-reachable admin reset is a much larger risk than the problem it solves, and §5.12's "no UI path to create an Admin" reflects the same reasoning.

1. Refuse to run unless `SUPABASE_SERVICE_ROLE_KEY` is present — the operator must already hold database-level access, so the script grants no privilege they lack.
2. Read the new password from an interactive prompt or `ADMIN_RESET_PASSWORD`; validate against the §11.7 policy; never echo or log it.
3. `UPDATE users SET password_hash = $1, must_change_password = true WHERE is_system_admin = true` — scoped by the flag, so it can never touch a Manager, create an account, or change a role (§5.12).
4. Delete every `refresh_tokens` row for that user — recovery assumes the previous credential may be compromised.
5. Append an `audit_logs` row: `actor_type = 'SYSTEM'`, `actor_user_id = NULL`, `action = 'OUT_OF_BAND_ADMIN_RESET'`, so the event is permanently distinguishable from an in-app password change (§5.15 rule 10).
6. Print only `"System admin password reset; the account must change it at next login."`

Adds no permission key, role, endpoint, or UI — §5.16 and §5.12 are untouched.

### Session design

- **Access token:** signed JWT, `exp` 15 minutes, claims `{ sub: userId, scope: 'admin', role, tokenVersion }`. Signed with `JWT_ACCESS_SECRET`.
- **Refresh token:** opaque 256-bit random value, stored hashed in `refresh_tokens`, `exp` 7 days, rotated on every use (the old row gets `revoked_at` and `replaced_by`).
- **Transport:** both are `httpOnly`, `secure` (production), `sameSite=strict` cookies (§2.4, §11.5), named `admin_at` and `admin_rt`. Because the session is cookie-based, CSRF protection is required: every state-changing back-office request must carry a `X-CSRF-Token` header matching a non-httpOnly `admin_csrf` cookie issued at login (double-submit). `requireAuth('admin')` rejects a mismatch with 403 `CSRF_FAILED`.
- **Scope separation (§2.4):** the token's `scope` claim is checked by `requireAuth`. `requireAuth('admin')` rejects any token whose scope is not `admin` with 401 — so a customer session, even a valid one, can never reach a back-office endpoint, and vice versa. Cookie names differ so the two sessions can coexist in one browser without either being usable on the other's routes.
- **Reuse detection:** presenting an already-revoked refresh token revokes the entire chain for that user and returns 401 (§11.7 "rotated on use").

### Middleware

```ts
requireAuth(scope: 'admin' | 'customer')
```
Verifies signature, expiry, and scope; loads the user; rejects with 401 `UNAUTHORIZED` if the user is missing or `is_active = false`; attaches `req.actor = { userId, role, permissions }`.

```ts
requirePermission(key: PermissionKey)
```
Runs after `requireAuth('admin')`. Resolves effective permissions and rejects with 403 `FORBIDDEN` if the key is absent. Per §11.7 this is re-evaluated **on every request** — never cached across requests in a way that survives a revoke.

**Effective-permission resolution** (`services/permissions.service.ts`):

```text
if user.role === 'ADMIN'            → every permission whose admin_tier = 'YES'
if user.role === 'MANAGER'          → { p : p.manager_tier = 'YES' } ∪ { p : p.manager_tier = 'ASSIGNED' AND granted to this user }
                                      (p.manager_tier = 'NO' is never included, even if a grant row somehow exists)
```

A `manager_tier = 'NO'` permission is unreachable for a Manager by construction — the grant endpoint refuses to create such a row (below), and resolution filters it out regardless, so a stray row cannot escalate.

### Routes

All under `/api/admin`. Every one requires `requireAuth('admin')` except login.

| Method | Path | Auth | Permission |
| --- | --- | --- | --- |
| `POST` | `/api/admin/auth/login` | none | none |
| `POST` | `/api/admin/auth/refresh` | refresh cookie | none |
| `POST` | `/api/admin/auth/logout` | admin | none |
| `GET` | `/api/admin/auth/me` | admin | none |
| `POST` | `/api/admin/auth/change-password` | admin | none (self only) |
| `GET` | `/api/admin/permissions` | admin | none (catalogue is not sensitive) |
| `GET` | `/api/admin/managers` | admin | `user.manager.create`¹ |
| `POST` | `/api/admin/managers` | admin | `user.manager.create` |
| `GET` | `/api/admin/managers/:id` | admin | `user.manager.update` |
| `PATCH` | `/api/admin/managers/:id` | admin | `user.manager.update` |
| `POST` | `/api/admin/managers/:id/deactivate` | admin | `user.manager.update` |
| `POST` | `/api/admin/managers/:id/reactivate` | admin | `user.manager.update` |
| `DELETE` | `/api/admin/managers/:id` | admin | `user.manager.delete` |
| `PUT` | `/api/admin/managers/:id/permissions` | admin | `permission.assign` |
| `GET` | `/api/admin/audit-logs` | admin | `audit.view` |

¹ §5.18 has no separate "Manager View" row; listing Managers is part of Manager management, which is `No` for Manager. Gating the list on `user.manager.create` keeps the list Admin-only without inventing a new permission key (§5.16 forbids inventing keys).

### Request/response types

```ts
// POST /api/admin/auth/login
type AdminLoginRequest = { userIdentifier: string; password: string };
type AdminLoginResponse = {
  user: { id: string; userIdentifier: string; role: 'ADMIN' | 'MANAGER'; isSystemAdmin: boolean };
  permissions: PermissionKey[];
  mustChangePassword: boolean;
};
// Tokens are set as httpOnly cookies; they are never in the response body.

// POST /api/admin/auth/change-password
type ChangePasswordRequest = { currentPassword: string; newPassword: string };
type ChangePasswordResponse = { changed: true };

// GET /api/admin/auth/me
type MeResponse = AdminLoginResponse['user'] & { permissions: PermissionKey[] };

// POST /api/admin/managers
type CreateManagerRequest = {
  userIdentifier: string;
  password: string;
  permissions?: PermissionKey[];   // ASSIGNED-tier keys only
};
type ManagerResponse = {
  id: string;
  userIdentifier: string;
  role: 'MANAGER';
  isActive: boolean;
  permissions: PermissionKey[];    // granted ASSIGNED-tier keys only
  createdAt: string;
};

// PATCH /api/admin/managers/:id
type UpdateManagerRequest = { userIdentifier?: string; password?: string };
// `role` is deliberately absent — see "No separate change-role action" below.

// PUT /api/admin/managers/:id/permissions
type SetManagerPermissionsRequest = { permissions: PermissionKey[] };
type SetManagerPermissionsResponse = { permissions: PermissionKey[] };
```

### Validation rules

- `userIdentifier`: 3–64 chars, `^[a-zA-Z0-9._-]+$`, trimmed, compared case-insensitively for uniqueness.
- `password`: minimum policy (§11.7) — ≥ 12 characters, at least one letter and one digit. The same policy applies to the seed, to Manager creation, and to password change; it is one shared validator.
- `permissions[]`: every element must exist in the `permissions` catalogue and have `manager_tier = 'ASSIGNED'`. A `YES`-tier key is rejected as `ValidationError` `PERMISSION_NOT_ASSIGNABLE` (it is already held by role). A `NO`-tier key is rejected the same way — this is the schema-level expression of §5.13's "Managers must NOT be able to… manage RBAC configuration."

### Service-layer rules and transaction boundaries

**`createManager`** — inside `withTransaction`:
1. Assert `actor.role === 'ADMIN'` (§5.14 Rule 2: Manager cannot create a Manager). A Manager reaching here is already blocked by `requirePermission('user.manager.create')` since that row is `No` for Manager, but the service asserts it again — defence in depth per §5.15 rule 9.
2. Assert the target role is `MANAGER`. **There is no request field for role**, so creating an Admin through this endpoint is structurally impossible (§5.12 "Admin cannot create another Admin account through the normal back-office UI", §5.12.3).
3. Enforce §5.15 rule 6 for every requested permission: the actor must currently hold it. Rejection is `ForbiddenError` `CANNOT_GRANT_UNHELD_PERMISSION`, raised **at create time**, not deferred to use.
4. Insert the user, insert the grants, append one `audit_logs` row for the account creation and one per permission granted.

**`updateManager`** — inside `withTransaction`:
1. Load the target; reject with `NotFoundError` if not a `MANAGER` row. This single check makes every §5.12.3 protection hold on this endpoint: the system Admin is an `ADMIN` row and therefore cannot be updated, disabled, or role-changed here.
2. Reject `id === actor.userId` with `ForbiddenError` `CANNOT_MODIFY_SELF` (§5.11 "Modify their own role or their own permissions"; §5.15 rule 4).
3. Apply changes; append an audit row with `previous_value`/`new_value` for each changed field. A password change records that the password changed, never the value.

**No separate change-role action (§5.15 rule 7).** There is no endpoint, and no request field anywhere in this slice, that sets or changes `users.role`. A role is fixed at creation and the only creatable role is `MANAGER`. This satisfies rule 7's "This applies both when creating a new account and when changing an existing account's role… There is no separate 'change role' action that bypasses this scope check" by removing the action entirely rather than guarding it.

**`deleteManager`** — inside `withTransaction`: reject unless the target is a `MANAGER`; reject self-deletion; delete (cascading `user_permissions`); append an audit row capturing the deleted account's identifier and role in `previous_value`.

**`setManagerPermissions`** — inside `withTransaction`, the enforcement point for §5.16's description of `permission.assign`:
1. `requirePermission('permission.assign')` has already run.
2. Reject `id === actor.userId` (§5.15 rule 4 — no self-grant).
3. Reject unless the target is a `MANAGER` (§5.11, §5.12.3 — a Manager's permissions cannot be changed by a Manager, and an Admin's cannot be changed here at all).
4. For every key in the requested set **and** every key being revoked, assert `actor` currently holds it (§5.15 rule 6, enforced at grant time).
5. Assert every key has `manager_tier = 'ASSIGNED'`.
6. Diff against current grants; insert additions, delete removals; append one `audit_logs` row per grant and per revoke with `action = 'permission_grant'` / `'permission_revoke'`, `previous_value`, `new_value`, and `actor_user_id` (§5.15 rule 10).

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Bad credentials, or account inactive | 401 | `INVALID_CREDENTIALS` (identical message either way — never reveals whether the identifier exists) |
| Missing/expired/wrong-scope token | 401 | `UNAUTHORIZED` |
| CSRF header missing or mismatched | 403 | `CSRF_FAILED` |
| Authenticated but lacking the permission | 403 | `FORBIDDEN` |
| Target is not a Manager (Admin or customer row) | 404 | `NOT_FOUND` |
| Acting on own account where forbidden | 403 | `CANNOT_MODIFY_SELF` |
| Granting a permission the actor lacks | 403 | `CANNOT_GRANT_UNHELD_PERMISSION` |
| Granting a `YES`/`NO`-tier key | 400 | `PERMISSION_NOT_ASSIGNABLE` |
| Duplicate `userIdentifier` | 409 | `USER_IDENTIFIER_EXISTS` |
| Password below policy | 400 | `WEAK_PASSWORD` |
| `mustChangePassword` still true on a non-exempt route | 403 | `PASSWORD_CHANGE_REQUIRED` |

## Frontend work

Admin back-office routes under `frontend/src/app/admin/`. None of these are indexed (`seo` skill: the back-office has no SEO requirements; `robots.txt` in spec 07 disallows `/admin`).

- **`/admin/login`** — User ID + password form. States: idle, submitting, error (single generic "Invalid user ID or password"), success → redirect. Inputs 44px, labels above fields, `#DC143C` focus border (`design` skill: Form Inputs).
- **`/admin/change-password`** — shown when `mustChangePassword` is true; the app shell redirects here from every other admin route until it is false (§2.7).
- **`/admin` shell** — header with logout; navigation rendered from the `permissions` array returned by `/auth/me`, so a Manager without `cms.manage` never sees the CMS entry. Per the `frontend` skill §3, this is UX clarity only — every action's real gate is the backend check, and the UI must still render the backend's 403 gracefully rather than assuming it never happens.
- **`/admin/managers`** — paginated list: User ID, status badge, created date. Mobile: one card per row, 80px tall, tap to open. `Add Manager` button 44px.
- **`/admin/managers/new`** and **`/admin/managers/[id]`** — form plus a permission checklist showing only `ASSIGNED`-tier permissions grouped by §5.17's operational/administrative split. A permission the current Admin does not hold is rendered disabled with the reason, matching the backend's rule 6 rejection instead of letting the user discover it on submit.
- **`/admin/audit-logs`** — paginated list of audit entries (entity, action, actor, timestamp), filterable by entity type.
- All pages implement explicit loading / empty / error / success states (`frontend` skill §10). Colours limited to the documented palette; no gradients or shadows beyond the card's `0 1px 2px` (`design` skill).

## Security requirements

- **Authorization is Express-only.** Every route above performs its own `requireAuth` + `requirePermission` check on every request; no RLS policy is relied upon (`01-overview.md` §1.1, `security` skill §0). Frontend navigation hiding is never the control (§5.15, §5.17).
- **Scope isolation (§2.4).** `requireAuth('admin')` rejects any token not carrying `scope: 'admin'`. A customer token is structurally useless on back-office routes.
- **System Admin protection (§5.12.3).** Every Manager-management route filters its target to `role = 'MANAGER'`, so there is no path — including generic account-management endpoints — by which the `is_system_admin` account can be deleted, disabled, role-changed, or have its permissions altered, by a Manager *or* by the Admin itself. `is_system_admin` is never an updatable field in any request type.
- **No self-escalation (§5.15 rules 4, 7).** Self-targeting is rejected on update, delete, and permission-set; no endpoint accepts a `role` field; the only creatable role is `MANAGER`.
- **Grantor ceiling (§5.15 rule 6).** Enforced at grant time inside the transaction, not checked later at use time.
- **Audit (§5.15 rule 10).** Every create, update, deactivate, delete, grant, and revoke appends an `audit_logs` row inside the same transaction as the change, so an audited action and its record cannot diverge.
- **Rate limiting (§11.3).** `POST /api/admin/auth/login` is declared as requiring the same per-account + per-IP limiter as customer login, explicitly with no back-office exemption; `POST /api/admin/auth/refresh` requires a per-user ceiling. Spec 04 wires these; until then the endpoints are marked with the limiter names they expect.
- **Secrets.** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_ADMIN_*` come from env only. No response body ever contains a token, a hash, or a secret. The logger redacts `authorization`, cookie headers, and any field named `password`.
- **Credential-enumeration hygiene.** Login returns one message for unknown identifier, wrong password, and inactive account (§11.2's "must not leak whether the underlying identifier exists").
- **Input validation.** Every route uses spec 01's `validate()` with `.strict()` schemas (§11.6).

## Data integrity / idempotency

- **Idempotent seed (§5.12.2).** `ON CONFLICT DO NOTHING` against spec 02's single-row partial unique index on `is_system_admin` guarantees exactly one Admin regardless of how many times, or how concurrently, the seed runs.
- **Idempotent grants.** `UNIQUE (user_id, permission_key)` makes re-granting a held permission a no-op; `PUT .../permissions` is a full-set replace, so repeating the same request converges to the same state rather than accumulating rows.
- **Refresh-token rotation.** Each refresh revokes the presented token and issues a new one in the same transaction; replaying a consumed token revokes the chain instead of minting a second valid session.
- **Atomic audit.** The change and its `audit_logs` row share one transaction, so an action can never be applied without its audit record.

## Acceptance criteria

1. `SEED_ADMIN_USER_ID=... SEED_ADMIN_PASSWORD=... npm run seed:admin` creates one `ADMIN` row with `is_system_admin = true` and `must_change_password = true`.
2. Running the seed a second time prints "already exists", exits 0, and `SELECT count(*) FROM users WHERE role='ADMIN'` is still 1.
3. Running the seed with `SEED_ADMIN_PASSWORD` unset exits non-zero with a message naming the variable, and no value is printed.
4. `grep -r "$SEED_ADMIN_PASSWORD" <application logs>` finds nothing after a successful seed.
5. `POST /api/admin/auth/login` with the seeded credentials returns 200, sets `admin_at`/`admin_rt` as `httpOnly` cookies, returns `mustChangePassword: true`, and returns no token in the body.
6. With `mustChangePassword: true`, `GET /api/admin/managers` returns 403 `PASSWORD_CHANGE_REQUIRED`; after `POST /auth/change-password` it returns 200.
7. `POST /api/admin/auth/login` with a valid identifier and wrong password, and with an unknown identifier, return byte-identical response bodies.
8. A customer access token (from spec 08, or a hand-signed token with `scope: 'customer'`) on any `/api/admin/*` route returns 401.
9. A Manager account calling `POST /api/admin/managers` returns 403, even though the request is otherwise well-formed.
10. `POST /api/admin/managers` with `{"userIdentifier":"m1","password":"...","permissions":["cms.manage"]}` as Admin succeeds; the response lists `cms.manage`; `GET /api/admin/auth/me` as that Manager includes `cms.manage` plus every `YES`-tier key and no `NO`-tier key.
11. `PUT /api/admin/managers/:id/permissions` with `["order.confirm"]` returns 400 `PERMISSION_NOT_ASSIGNABLE` (it is a `YES`-tier row).
12. `PUT /api/admin/managers/:id/permissions` with `["rbac.configure"]` returns 400 `PERMISSION_NOT_ASSIGNABLE` (it is a `NO`-tier row).
13. An Admin whose own grants somehow lack a permission attempting to grant it returns 403 `CANNOT_GRANT_UNHELD_PERMISSION`, and no `user_permissions` row is created.
14. `DELETE /api/admin/managers/<system-admin-id>` returns 404, and the Admin row is unchanged. The same holds for `PATCH`, `/deactivate`, and `/permissions` against that id.
15. `PATCH /api/admin/managers/<own-id>` returns 403 `CANNOT_MODIFY_SELF`.
16. No request schema anywhere in this slice accepts a `role` field — verified by inspecting the zod schemas.
17. After any successful create/update/delete/grant/revoke, `GET /api/admin/audit-logs` shows a matching row with actor, action, previous and new values, and timestamp.
18. A state-changing admin request without the `X-CSRF-Token` header returns 403 `CSRF_FAILED`.
19. Presenting a refresh token that has already been used returns 401 and marks every token in that user's chain revoked.
20. At 375px, `/admin/login` and `/admin/managers` render with no horizontal scroll and 44px-minimum touch targets.

## Tests required

Per the `test` skill §2 — integration tests against real Express middleware and a real test database with seeded Admin/Manager fixtures. The permission-check layer is never mocked, because it is the thing under test.

1. **Every row of the §5.18 matrix** — for each of the 47 permissions: Admin is allowed; a Manager is allowed for `YES`, rejected for `NO`, and for `ASSIGNED` is rejected while ungranted and allowed once granted. One test per row, so a failure names the exact permission.
2. **Manager cannot manage Admin** (§5.11) — as a Manager, attempt to delete, update, deactivate, and change permissions of the Admin account; all rejected.
3. **Manager cannot manage another Manager** (§5.11, §5.14 Rule 2) — create/update/delete/permission-set against a second Manager, all rejected.
4. **Self-escalation ban** (§5.15 rules 4, 7) — a Manager granting itself a permission; any actor attempting to set a role above its scope, at creation and at update. Since no `role` field exists, the test asserts the schema rejects a request carrying one.
5. **Grantor cannot exceed own permissions** (§5.15 rule 6) — the grant *call itself* fails, not merely the later use; assert no `user_permissions` row was written.
6. **Protected system Admin** (§5.12.3) — delete/disable/role-change/permission-change of the `is_system_admin` account rejected through every Manager-management endpoint, including as Admin.
7. **Idempotent Admin seed** (§5.12.2) — run the seed twice and concurrently; exactly one Admin, no error on the second run.
8. **`courier.manage` vs `courier.select`** (§5.16) — a default Manager passes a `courier.select`-gated route and fails a `courier.manage`-gated one; granting `courier.manage` flips only the second. Tested independently; neither implies the other.
9. **Audit logging for permission-changing actions** (§5.15 rule 10) — every grant/revoke/create/delete test also asserts the audit row, including actor and previous/new values.
10. **Frontend-hiding is not a security boundary** (§5.15, §5.17) — call `POST /api/admin/managers`, `PUT .../permissions`, and `DELETE .../managers/:id` directly as an unauthorized actor with no UI involved; assert rejection.
11. **Session scope separation** (§2.4) — a `scope: 'customer'` token is rejected on every `/api/admin/*` route.
12. **Login does not leak account existence** (§11.2) — identical responses for unknown identifier vs. wrong password.
13. **Refresh rotation and reuse detection** (§11.7) — a rotated token cannot be replayed; replay revokes the chain.
14. **Effective-permission resolution ignores stray `NO`-tier grants** — insert a `user_permissions` row for a `NO`-tier key directly at the data layer and assert resolution still excludes it.

## Open questions / assumptions

1. **Session transport.** §2.4 mandates "httpOnly, signed session token (JWT or equivalent) with a defined expiry and refresh mechanism", while §11.5 notes bearer tokens reduce CSRF exposure but any cookie session still needs CSRF protection. *Assumption:* httpOnly cookies plus the double-submit CSRF this then requires. Access 15 min / refresh 7 days are not specified anywhere; they are chosen as ordinary defaults and are env-configurable, consistent with §2.5's "configurable business parameters, not fixed architecture."
2. **Password policy.** §11.7 requires "a minimum password policy" without defining it. *Assumption:* ≥ 12 characters with at least one letter and one digit, applied identically to seed, Manager creation, and password change. Tune via env without changing the mechanism.
3. **Manager list permission.** §5.18 has no "Manager View" row. *Assumption:* gate `GET /api/admin/managers` on `user.manager.create` (Admin-only) rather than inventing a key, since §5.16 forbids inventing permission keys. **Flagged:** if the client wants a Manager to see the roster read-only, that requires a new matrix row and a PRD edit.
4. **Admin password recovery — RESOLVED as a defined operational procedure.** §2.5's recovery flow is explicitly customer-and-email-only, and §2.8 gives Manager accounts only a User ID and password. No PRD defines what happens when the sole Admin forgets its password, and §5.12.3 makes that account non-deletable — so with no recovery path the platform is one forgotten password away from being unadministrable.

   **Resolution: `npm run admin:reset-password`, a server-side CLI procedure** (specified under "Backend work"). It is deliberately *not* an HTTP endpoint — a network-reachable admin reset is a far larger attack surface than the problem it solves, and §5.12's "no UI path to create an Admin" reflects the same instinct. Requirements:

   - Runs only with direct server/database access (the operator must already hold `SUPABASE_SERVICE_ROLE_KEY`), so it grants no privilege an attacker at that level does not already have.
   - Resets the password of the **seeded system Admin only**, identified by `is_system_admin = true` — never a Manager, and it cannot create an account or change a role (§5.12: no Admin creation outside the seed).
   - Applies the same hashing helper and password policy as every other path.
   - Sets `must_change_password = true`, so the operator-chosen password is single-use (§2.7's forced-change rule, reused).
   - **Revokes all existing Admin sessions** — recovery assumes the old credential may be compromised.
   - Writes an `audit_logs` entry with `actor_user_id = NULL` and an explicit `OUT_OF_BAND_ADMIN_RESET` action, so the event is permanently visible in the trail (§5.15 rule 10) and distinguishable from an in-app change.

   This adds no permission key, no role, and no UI, so §5.16 and §5.12 are untouched. **Recommend to the client:** set a recoverable email on the Admin account and keep the seed credentials in the same secret store as `SUPABASE_SERVICE_ROLE_KEY` — the procedure is the floor, not a substitute for credential hygiene.
5. **Manager deletion vs. audit references.** §5.14 Rule 2 permits Manager deletion, while §5.15 rule 10 requires permanent audit records naming the acting user. *Assumption:* `audit_logs.actor_user_id` is `ON DELETE SET NULL` with the actor's identifier also denormalized into `new_value`/`previous_value` at write time, so history survives the account's deletion. **Flagged as a minor conflict:** hard-deleting an account that appears throughout the audit trail is in tension with the "complete and traceable" standard (§5.21.11); deactivation (`is_active = false`) is the safer default and delete should be used sparingly.
6. **`must_change_password` scope.** §2.7's note applies to the seeded Admin. *Assumption:* apply the same flag to newly created Manager accounts, since §11.7 holds back-office accounts to "the same or stricter" policy as customers. This is an extension of a stated rule to a parallel case, not a new requirement; if unwanted, the flag defaults to `false` on Manager creation with no other change.
