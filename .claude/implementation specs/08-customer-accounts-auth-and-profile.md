# 08 — Customer Accounts: Optional Registration, Login, Password Recovery, and Profile

## Goal

After this slice a customer can — entirely on their own initiative, from the profile icon in the header — register with a mobile number and password, log in, recover a password by email OTP, and manage their profile, address, and password. Customer sessions are issued under a `customer` scope that can never reach back-office endpoints. The profile-completeness rule that checkout depends on is implemented and enforced server-side. Registration is never surfaced inside checkout: this slice deliberately builds the account system **without** touching the checkout flow, so the guest-first default in spec 11 cannot regress into an account gate.

## Requirement references

- `02-customer.md` §2 — creating an account is **optional**; guest checkout is the default, unprompted path; registration is discovered and opted into via the **profile icon** in the storefront header, never as a checkout step; checkout never presents a "Register/Login or Continue as Guest?" choice.
- `02-customer.md` §2.1 — registration requires mobile phone number + password; the number is unique; one account per number; passwords hashed, never plaintext.
- `02-customer.md` §2.2 — required profile fields before a registered customer can place an order: full name, mobile, email (optional), Division, District, Upazila/Thana, Union/Ward, detailed address, postal code (optional); the Upazila/Thana and Union/Ward discriminators.
- `02-customer.md` §2.3 — checkout validation for the registered path: complete → proceed; incomplete → block the order, redirect to the Profile page, identify the missing fields, then return to checkout. Enforced on the backend as well as the frontend.
- `02-customer.md` §2.4 — login by mobile + password; httpOnly signed session token with defined expiry and refresh; **customer and admin/manager sessions use separate token scopes**; login rate-limited per account and per IP using the §2.5 approach.
- `02-customer.md` §2.5 — forgot-password flow by registered email with OTP; a customer with no email on file cannot use it (accepted v1 constraint); OTP expires after 10 minutes, single-use, max 3 requests per account per 15 minutes, max 5 incorrect attempts per issued OTP before invalidation; no sensitive account information in error messages; thresholds configurable.
- `02-customer.md` §2.6 — view/edit profile; update phone and email "according to the system's verification rules"; update delivery address; change password; view order history.
- `02-customer.md` §2.9.4 — a guest customer record has no password and no authentication identity and cannot be used to log in.
- `02-customer.md` §2.9.8 — optional post-order account creation from the profile icon only; the new account associates with the **existing** customer reference matched by phone number; past orders become visible; the association must verify the phone number (OTP to the phone, or a matching Order Number) so an attacker cannot claim someone else's guest history; the discriminator flips to `REGISTERED`.
- `06-rbac.md` §5.19 — `CUSTOMER` role applies only to customer records with login credentials; a guest reference holds no role; a customer role never grants back-office access.
- `11-security-hardening.md` §11.3 — rate limits for login, OTP request, OTP verify, and registration; §11.7 — password hashing, minimum password policy, short-lived tokens, revocable/rotated refresh tokens.
- Skills: `security` §1 (auth/session/OTP), §2, `backend` §2, `frontend` §2, §5, `design` (Customer Account Page, Forms), `test` §4.

## Depends on

- **01** — API conventions, validation, errors.
- **02** — `users`, `customers`, the address columns and discriminators, `normalizeBdPhone`, `hashPassword`/`verifyPassword`, `withTransaction`, `audit_logs`.
- **03** — the session/refresh-token machinery and `refresh_tokens` table (reused here with `scope = 'customer'`), `requireAuth`.
- **04** — `customerLogin`, `otpRequest`, `otpVerify`, `registration` limiters; `publicCeiling`.
- **07** — storefront shell (the profile icon lives in the header built there).

## Scope

**In scope**

- Customer registration (standalone, from the profile icon).
- Customer login, refresh, logout, and `me`.
- Forgot-password OTP flow: request, verify, reset.
- Profile read/update, address update, password change.
- Phone-number change verified by password + email OTP (Admin-performed where no email exists, per §2.6's "system's verification rules"); email change with email verification.
- The profile-completeness evaluator that spec 11's registered checkout path calls.
- Guest→registered account claiming (§2.9.8), including the phone-verification requirement.
- Email delivery abstraction (OTP and verification messages).
- Storefront pages: register, login, forgot/reset password, account home, profile edit, address, change password.

**Out of scope / deferred**

- Order history content — the page exists here with an empty/loading state, but the orders it lists come from spec **11**; the route is wired in spec **15** when the customer order endpoints exist.
- Any checkout change — spec **11** owns checkout and must not add a login prompt.
- Guest order lookup by Order Number + Phone — deferred to spec **15**.
- Wishlist and saved carts — deferred to spec **09**.
- Admin-side customer management (§5.7) — deferred to spec **13**.

## Database changes

Migration file: `backend/migrations/0008_customer_auth.sql`

`users`, `customers`, and `refresh_tokens` already exist. This migration adds the one-time-code table and the verification bookkeeping §2.6 implies.

### `one_time_codes`

Serves password-reset OTPs, phone-change verification, and guest-claim phone verification with one mechanism, since the §2.5 rules are explicitly reused by the other flows (§2.5, §2.6, §2.9.8).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `purpose` | `otp_purpose` | NOT NULL | — | `PASSWORD_RESET` \| `PHONE_VERIFICATION` \| `GUEST_CLAIM` |
| `user_id` | `uuid` | NULL | — | FK → `users(id)` ON DELETE CASCADE; NULL for a claim before the account exists |
| `destination_hash` | `text` | NOT NULL | — | SHA-256 of the normalized email or phone; the raw value is not stored twice |
| `code_hash` | `text` | NOT NULL | — | Hash of the OTP — the plaintext code is **never** stored |
| `expires_at` | `timestamptz` | NOT NULL | — | Issued + `OTP_TTL_MINUTES` (default 10) |
| `consumed_at` | `timestamptz` | NULL | — | Set on successful use — enforces single-use |
| `invalidated_at` | `timestamptz` | NULL | — | Set when the attempt budget is exhausted |
| `attempt_count` | `integer` | NOT NULL | `0` | Incremented per incorrect verification |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

```sql
CREATE TYPE otp_purpose AS ENUM ('PASSWORD_RESET','PHONE_VERIFICATION','GUEST_CLAIM');
```

- Index on `(purpose, destination_hash, created_at DESC)` — backs the "max 3 requests per account per 15 minutes" count (§2.5).
- Partial unique index ensuring at most one live code per purpose+destination: `CREATE UNIQUE INDEX ON one_time_codes (purpose, destination_hash) WHERE consumed_at IS NULL AND invalidated_at IS NULL` — issuing a new code invalidates the previous one in the same transaction, so two valid codes never coexist for one destination.

### `users` additions

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `email_verified_at` | `timestamptz` | NULL | — | §2.6 "according to the system's verification rules" |
| `phone_verified_at` | `timestamptz` | NULL | — | Set when a phone change or guest claim is OTP-verified |
| `password_changed_at` | `timestamptz` | NULL | — | Used to invalidate outstanding sessions on password change |

### `email_verification_tokens`

Email changes are verified by a link rather than an OTP, since the customer is already authenticated and a link is the ordinary mechanism.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `user_id` | `uuid` | NOT NULL | FK → `users(id)` ON DELETE CASCADE |
| `new_email` | `text` | NOT NULL | The pending address |
| `token_hash` | `text` | NOT NULL | UNIQUE |
| `expires_at` | `timestamptz` | NOT NULL | Default 24 h |
| `consumed_at` | `timestamptz` | NULL | |

## Backend work

### Session scope

Customer sessions reuse spec 03's machinery with `scope: 'customer'`, cookies named `cust_at` / `cust_rt`, and the same rotation and reuse-detection rules. `requireAuth('customer')` rejects an `admin`-scoped token and vice versa — §2.4's separate-scopes requirement is enforced by the same single check in both directions, so no endpoint can be gated by "is logged in" without also fixing which kind of login.

Access token 15 min, refresh 7 days, both `httpOnly`/`secure`/`sameSite=strict`, with the same double-submit CSRF token as the admin session (§11.5).

`password_changed_at` is embedded in the access token; `requireAuth` rejects a token issued before the stored value, so changing a password invalidates every outstanding session (§11.7's revocability intent).

### Routes

| Method | Path | Auth | Limiter |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | none | `registration` |
| `POST` | `/api/auth/login` | none | `customerLogin` |
| `POST` | `/api/auth/refresh` | refresh cookie | `publicCeiling` |
| `POST` | `/api/auth/logout` | customer | — |
| `GET` | `/api/auth/me` | customer | `authenticatedCeiling` |
| `POST` | `/api/auth/forgot-password` | none | `otpRequest` |
| `POST` | `/api/auth/verify-otp` | none | `otpVerify` |
| `POST` | `/api/auth/reset-password` | none (requires a verified OTP grant) | `otpVerify` |
| `GET` | `/api/customer/profile` | customer | `authenticatedCeiling` |
| `PATCH` | `/api/customer/profile` | customer | `authenticatedCeiling` |
| `PUT` | `/api/customer/address` | customer | `authenticatedCeiling` |
| `POST` | `/api/customer/change-password` | customer | `authenticatedCeiling` |
| `POST` | `/api/customer/phone-change/request` | customer | `otpRequest` |
| `POST` | `/api/customer/phone-change/confirm` | customer | `otpVerify` |
| `POST` | `/api/customer/email-change/request` | customer | `otpRequest` |
| `GET` | `/api/customer/email-change/confirm` | none (token-bearing link) | `publicCeiling` |
| `POST` | `/api/auth/claim-guest/request` | none | `otpRequest` |
| `POST` | `/api/auth/claim-guest/complete` | none | `otpVerify` |

### Types

```ts
// POST /api/auth/register — §2.1 requires only these two fields
type RegisterRequest = { phoneNumber: string; password: string };
type RegisterResponse = { customer: CustomerProfileResponse; profileComplete: boolean };

// POST /api/auth/login — §2.4
type LoginRequest = { phoneNumber: string; password: string };
type LoginResponse = { customer: CustomerProfileResponse; profileComplete: boolean };
// Tokens are httpOnly cookies; never in the body.

type CustomerProfileResponse = {
  fullName: string | null;
  phoneNumber: string;
  email: string | null;
  emailVerified: boolean;
  address: CustomerAddress | null;   // the spec-02 shape, with both discriminators
};

type ProfileCompletenessResponse = {
  complete: boolean;
  missingFields: Array<'fullName'|'phoneNumber'|'division'|'district'|'areaUnit'|'wardUnit'|'detailedAddress'>;
};

// POST /api/auth/forgot-password — §2.5 step 2
type ForgotPasswordRequest = { email: string };
type ForgotPasswordResponse = { requested: true };   // always this, regardless of existence

// POST /api/auth/verify-otp — §2.5 steps 5–6
type VerifyOtpRequest = { email: string; code: string };
type VerifyOtpResponse = { resetGrant: string };     // short-lived, single-use

// POST /api/auth/reset-password — §2.5 steps 7–9
type ResetPasswordRequest = { resetGrant: string; newPassword: string };

// POST /api/auth/claim-guest/request — §2.9.8 step 5
type ClaimGuestRequest = { phoneNumber: string };
// POST /api/auth/claim-guest/complete
type ClaimGuestCompleteRequest = { phoneNumber: string; code: string; password: string };
```

### Registration (§2.1)

Inside `withTransaction`:

1. Normalize the phone. Validate the password against the shared minimum policy (§11.7).
2. Look up `customers` by phone.
   - **No record** → create a `customers` row with `account_type = 'REGISTERED'` and only the phone populated (name and address are profile-completion fields per §2.2, not registration fields per §2.1).
   - **A `GUEST` record exists** → **do not** silently attach it. Registration returns `409 GUEST_RECORD_EXISTS` directing the caller to the claim flow, because §2.9.8 step 5 requires phone verification before past orders can be associated. Attaching on a bare password would let anyone who knows a phone number inherit that person's order history — precisely the attack §2.9.8 names.
   - **A `REGISTERED` record exists** → `409 PHONE_ALREADY_REGISTERED`.
3. Create the `users` row with `role = 'CUSTOMER'`, the hash, and `customer_id`.
4. Issue a session and audit the creation.

Registration collects only phone + password, exactly as §2.1 specifies. Profile fields are gathered later, via the profile page, and enforced at checkout by §2.3 — not demanded up front.

### Login (§2.4)

Look up `users` by normalized phone where `role = 'CUSTOMER'` and `is_active`. Verify the hash. A guest `customers` row has no `users` row, so a guest phone number simply fails to authenticate — "cannot be used to log in" is structural, not a special case (§2.9.4). Failures return one indistinguishable `INVALID_CREDENTIALS` regardless of whether the number is unknown, is a guest, or the password is wrong, per the "must not expose sensitive account information through error messages" rule (§2.5, §11.2).

### Password recovery (§2.5) — exact rule implementation

`POST /auth/forgot-password`:
1. Normalize and hash the email.
2. Count live codes for `(PASSWORD_RESET, destination_hash)` in the last `OTP_REQUEST_WINDOW_MINUTES` (default 15). If ≥ `OTP_MAX_REQUESTS` (default **3**), return the same success envelope but issue nothing (§2.5's limit, without revealing that a limit was hit).
3. If a user with that email exists: invalidate any live code, generate a cryptographically random 6-digit code, store only its hash with `expires_at = now() + 10 minutes`, and send it by email.
4. **Always** return `{ requested: true }` — identical whether or not the address is registered (§2.5's no-information-disclosure rule).

`POST /auth/verify-otp`:
1. Load the live code for the destination. Absent/expired/consumed/invalidated → generic `INVALID_OR_EXPIRED_CODE`.
2. Compare in constant time. On mismatch, increment `attempt_count`; when it reaches `OTP_MAX_ATTEMPTS` (default **5**), set `invalidated_at` so a new code must be requested (§2.5). Return the same generic error either way.
3. On match: set `consumed_at` (single-use, §2.5) and return a `resetGrant` — a signed, 10-minute, single-use token bound to the user. The grant exists so the reset step cannot be reached by simply asserting an email; it proves a specific OTP was verified.

`POST /auth/reset-password`: verify and consume the grant, validate the new password against the policy, hash it, set `password_changed_at` (invalidating all sessions), revoke every refresh token for the user, and audit. The plaintext appears in no log and no response (§2.1, §11.7).

Customers with no email on file cannot use this flow — §2.5 states that explicitly as an accepted v1 constraint. The UI says so plainly rather than pretending an email was sent to an address that does not exist.

### Profile completeness (§2.2/§2.3) — the shared evaluator

```ts
evaluateProfileCompleteness(customer: CustomerRecord): ProfileCompletenessResponse
```

Complete when `fullName`, `phoneNumber`, `division`, `district`, `areaUnitType` + `areaUnitName`, `wardUnitType` + `wardUnitName`, and `detailedAddress` are all present. `email` and `postalCode` are explicitly optional (§2.2).

This one function is what spec 11's registered-customer checkout branch calls server-side. §2.3 requires the check to run on the backend "as well as the frontend," and §3 requires order creation to re-run it — so it must be exactly one function, not a frontend form rule mirrored by a separate backend rule that can drift.

### Phone change (§2.6)

§2.6 requires this to follow "the system's verification rules." Those rules are defined here, and because **no SMS provider exists in the fixed stack** (Open questions 1), verification uses the channels that do exist rather than assuming one that does not.

**Self-service path — requires an email on file.** `POST /customer/phone-change/request` requires the customer's **current password** in the request body (re-authentication: a hijacked session alone must not be able to move the account's primary identifier) and issues a `PHONE_VERIFICATION` OTP to the **registered email**. `POST /customer/phone-change/confirm` verifies the OTP and, inside a transaction, updates `users.phone_number`, `customers.phone_number`, and clears `phone_verified_at` — the new number is *changed*, not *proven*, so it must not inherit the old number's verified stamp.

**No email on file → not self-service.** §2.2 makes email optional, so some customers have no verifiable channel. For them the endpoint returns `409 NO_VERIFICATION_CHANNEL` and the change is performed by an Admin/Manager under `customer.update` (§5.18), which writes an `audit_logs` entry naming the actor and the old and new numbers. An unverifiable self-service change of the account's primary identifier is never permitted.

When `SmsOtpChannel` is later configured, the request handler prefers SMS to the new number and both branches above collapse into one — no caller changes.

The new number must not already exist on any `customers` row — including a guest row — because `customers.phone_number` is unique and because moving onto an existing guest record would silently absorb that record's order history, the same risk §2.9.8 guards against. Rejected with `409 PHONE_IN_USE`.

**Consequence worth stating plainly:** the customer's phone number is the join key for their order history, their risk-check cache, and their per-customer coupon usage (§2.9.4, §7.6, §8.8). Changing it moves all three, because they all key off the one `customers` row that is being updated — not off a copy. Past orders already reference `customer_id`, so history follows the record rather than the number.

### Email change (§2.6)

`request` stores the pending address plus a hashed token and emails a confirmation link. `confirm` consumes the token and writes `users.email` + `email_verified_at`. The address is not written until confirmed, so an unverified address can never become a password-recovery destination — which matters because §2.5's recovery flow trusts `users.email` completely.

### Guest→registered claim (§2.9.8)

`POST /auth/claim-guest/request` — for a phone number with a `GUEST` `customers` row, issue a `GUEST_CLAIM` OTP **to that phone**. The response is identical whether or not such a row exists (no enumeration of who has ordered).

`POST /auth/claim-guest/complete` — inside `withTransaction`:
1. Verify the OTP (same single-use, expiry, and attempt rules).
2. Re-load the `customers` row by phone; require `account_type = 'GUEST'`.
3. Create the `users` row with the supplied password, `role = 'CUSTOMER'`, `customer_id` = the **existing** record's id — §2.9.8 step 3's "rather than creating a second, disconnected customer record."
4. Flip `account_type` to `REGISTERED` (step 6).
5. Audit and issue a session.

Past orders become visible because they already reference that `customer_id` (step 4). No order row is rewritten.

§2.9.8 step 5 offers "OTP to the phone, **or** requiring the guest to also supply a matching Order Number" — this slice implements the OTP path as primary. If SMS is unavailable at launch, the Order Number variant is the fallback (see Open questions 1). What is **not** acceptable is completing the claim with neither.

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Phone already registered | 409 | `PHONE_ALREADY_REGISTERED` |
| Guest record exists for this phone | 409 | `GUEST_RECORD_EXISTS` |
| Bad login | 401 | `INVALID_CREDENTIALS` (identical for all causes) |
| Weak password | 400 | `WEAK_PASSWORD` |
| OTP wrong/expired/consumed/invalidated | 400 | `INVALID_OR_EXPIRED_CODE` (identical for all causes) |
| OTP request over budget | 200 | `{ requested: true }` — indistinguishable by design |
| Reset grant invalid/expired/used | 400 | `INVALID_RESET_GRANT` |
| Phone in use on phone change | 409 | `PHONE_IN_USE` |
| Wrong current password on change | 400 | `INVALID_CREDENTIALS` |
| Phone change requested with no email on file | 409 | `NO_VERIFICATION_CHANNEL` (§2.6 — Admin/Manager performs it instead) |
| Rate limited | 429 | `RATE_LIMITED` |

## Frontend work

Storefront routes under `frontend/src/app/(storefront)/account/`, reached **only** from the profile icon in the header (§2, §2.9.8).

- **`/account/register`** — phone + password + confirm. Explains that an account is optional and that checkout works without one (§2's framing), so the page never reads as a gate.
- **`/account/login`** — phone + password, a "Forgot password?" link, and a link to register.
- **`/account/forgot-password`** → **`/account/verify-otp`** → **`/account/reset-password`** — three steps mirroring §2.5's flow. The OTP screen shows expiry and remaining-attempt guidance in general terms without revealing counts. If the customer has no email on file, the page states the §2.5 constraint directly.
- **`/account`** — name, phone, email, member-since; full-width 44px actions: My Orders, Saved Addresses, Wishlist, Account Settings, Logout (`design`: Customer Account Page).
- **`/account/profile`** — the §2.2 fields with Division/District selects, an Upazila/Thana field paired with its rural/metropolitan selector, a Union/Ward field with the same, detailed address, optional postal code. A persistent banner lists missing fields when the profile is incomplete, returned by the backend evaluator rather than computed in the form (`frontend` §2 — the backend is the source of truth).
- **`/account/change-password`**, **`/account/phone`**, **`/account/email`**.
- **`/account/orders`** — built here with loading/empty states; populated by spec 15.
- **`/account/claim`** — the §2.9.8 path: enter phone → **supply a matching Order Number for that phone** → set password. This is §2.9.8 step 5's Order-Number alternative, used because no SMS provider exists (Open questions 1); the page explains that the Order Number is on the order confirmation and in any courier notification. The step is never skippable — an unverified claim is refused, not downgraded.

**Checkout is untouched by this slice.** No page under `/checkout` gains a login prompt, a "continue as guest" choice, or a register link (§2, §2.9.1 step 2). A reviewer should be able to `grep` the checkout directory for "register"/"log in" and find nothing.

Design compliance: labels above inputs at 12px/600, inputs 44px with 16px font (prevents mobile zoom), 2px `#DC143C` focus border, 2px `#DC2626` error border with the message below, required markers in red, full-width buttons, no multi-column forms on mobile, explicit loading/error/success states throughout.

## Security requirements

- **Scope separation (§2.4, §5.19).** `requireAuth('customer')` rejects admin tokens; `requireAuth('admin')` rejects customer tokens. A `CUSTOMER` role never reaches a back-office route, which is stated as an absolute.
- **Passwords** hashed with argon2id/bcrypt via the single spec-02 helper; never stored, logged, returned, or echoed (§2.1, §11.7). The minimum policy is the same one the admin side uses.
- **OTP rules exactly as §2.5 specifies**: 10-minute expiry, single-use (`consumed_at`), max 3 requests per account per 15 minutes, max 5 incorrect attempts before invalidation. Only the code's **hash** is stored, so a database read does not yield usable codes. Codes are generated with a CSPRNG and compared in constant time (`security` §1: "not guessable/sequential, invalidated after use").
- **No account enumeration anywhere** (§2.5, §11.2): forgot-password always returns the same body; login returns one error for every failure cause; claim-request is identical for a phone with and without a guest record. This is the rule most likely to be eroded by a well-meant "helpful" message, so it is asserted by tests rather than left to review.
- **Guest records cannot authenticate** (§2.9.4) — no `users` row exists for them, so there is nothing to attack.
- **Guest history cannot be claimed without proving the phone** (§2.9.8 step 5) — registration refuses to absorb a guest record, and the claim flow requires an OTP. This closes the exact attack the PRD names.
- **Session invalidation on password change** — `password_changed_at` plus refresh-token revocation ends every other session.
- **Email is verified before it becomes a recovery destination**, so an unverified address cannot be used to take over an account.
- **Rate limiting** per §11.3 on registration, login, OTP request, and OTP verify, keyed by identifier + IP (spec 04).
- **Input validation** on every route with `.strict()` schemas; phone normalized before any lookup so casing/format variants cannot bypass a per-account limit (§11.6, §11.2).
- No customer endpoint returns another customer's data; every profile route reads `req.actor.customerId` and never a client-supplied id.

## Data integrity / idempotency

- **One account per phone** — `UNIQUE (users.phone_number)` from spec 02 makes double registration impossible even under concurrent requests.
- **One customer record per phone** — `UNIQUE (customers.phone_number)` means the guest claim attaches to the existing row rather than forking identity; this is what keeps order history, risk-check cache (§7.6), and coupon per-customer counts (§8.8) pointing at one subject.
- **One login identity per customer record** — `UNIQUE (users.customer_id)` prevents two accounts claiming one guest history.
- **At most one live OTP per purpose+destination** — the partial unique index means issuing a new code atomically supersedes the old one, so an attacker cannot accumulate a pool of valid codes by spamming requests (the request limiter bounds volume; this index bounds validity).
- **Single-use codes and grants** — `consumed_at` is set inside the verifying transaction, so a replayed code loses the race rather than verifying twice.
- **Claim is atomic** — user creation and the `GUEST → REGISTERED` flip share one transaction, so a record can never end up registered without credentials or credentialed while still marked guest.
- **Repeat-safe operations** — registering twice yields a 409, not a second account; verifying the same OTP twice fails the second time; confirming an email token twice is a no-op after the first.

## Acceptance criteria

1. `POST /api/auth/register` with `{phoneNumber:"01712345678", password:"…"}` creates one `customers` row (`REGISTERED`) and one `users` row (`CUSTOMER`), and sets `cust_at`/`cust_rt` httpOnly cookies with no token in the body.
2. Registering the same number again returns `409 PHONE_ALREADY_REGISTERED`; exactly one account exists.
3. Registering a number that has an existing **guest** record returns `409 GUEST_RECORD_EXISTS` and creates nothing.
4. `+8801712345678`, `8801712345678`, and `01712345678` all resolve to the same account on login.
5. A customer access token on any `/api/admin/*` route returns 401; an admin token on `/api/customer/*` returns 401.
6. Login with an unknown number, a guest-only number, and a wrong password all return byte-identical `401` bodies.
7. `POST /auth/forgot-password` returns `{"requested":true}` for a registered email, an unregistered email, and a malformed-but-valid-shaped email alike — all three responses identical.
8. A fourth forgot-password request within 15 minutes still returns `{"requested":true}` and issues no new code (`SELECT count(*)` on live codes is unchanged).
9. An OTP verified 11 minutes after issue returns `INVALID_OR_EXPIRED_CODE`.
10. A correct OTP used twice succeeds once, then returns `INVALID_OR_EXPIRED_CODE`.
11. Five wrong OTP attempts invalidate the code; the sixth attempt with the **correct** code still fails, and a new code must be requested.
12. `one_time_codes` contains no column holding a plaintext code, and the issued code cannot be recovered from any row.
13. After a password reset, the customer's previously-issued access token is rejected and their refresh token is revoked.
14. `GET /api/customer/profile` on a fresh account returns `profileComplete: false` with `missingFields` naming full name, division, district, area unit, ward unit, and detailed address — and **not** email or postal code.
15. Filling every required field flips `complete` to `true`; clearing only `postalCode` or `email` leaves it `true` (§2.2 optional fields).
16. A profile stored with `areaUnitType: 'THANA'` and `wardUnitType: 'WARD'` reads back with both discriminators intact.
17. `POST /customer/phone-change/confirm` with a valid OTP updates both `users.phone_number` and `customers.phone_number`; attempting to move to a number already on any customer row returns `409 PHONE_IN_USE`.
18. An email change does not alter `users.email` until the link is confirmed; an unconfirmed address cannot receive a password-reset OTP.
19. `POST /auth/claim-guest/complete` with a valid OTP converts the existing guest record to `REGISTERED`, creates a `users` row pointing at that same `customer_id`, and creates **no** second `customers` row.
20. Attempting the claim without a valid OTP fails; no `users` row is created.
21. `grep -ri "register\|log in\|sign in" frontend/src/app/\(storefront\)/checkout` returns nothing (§2: checkout never prompts for an account).
22. Exceeding the login, registration, or OTP limits returns `429` with `Retry-After`.
23. At 375px, every account page renders with no horizontal scroll, 44px inputs, and labels above fields.

## Tests required

Per the `test` skill §4 (abuse-resistance is a named priority area) and §2 (role/scope rules):

1. **OTP expiry** (§2.5) — valid before 10 minutes, rejected after.
2. **OTP single-use** (§2.5) — second use of a consumed code fails.
3. **OTP request budget** (§2.5) — the 4th request in 15 minutes issues nothing while returning the same response.
4. **OTP attempt budget** (§2.5) — 5 wrong attempts invalidate the code; a subsequent correct attempt fails.
5. **Codes are stored hashed** — no plaintext code is recoverable from the database.
6. **No account enumeration** (§2.5, §11.2) — identical responses across forgot-password (registered vs. not), login (unknown vs. guest vs. wrong password), and claim-request (guest exists vs. not). One test per surface, because each is an independent leak.
7. **One account per phone** (§2.1) — concurrent registrations for the same number produce exactly one account.
8. **Guest records cannot log in** (§2.9.4) — a guest phone with any password fails authentication.
9. **Registration refuses to absorb a guest record** (§2.9.8 step 5) — proves the history-hijack path the PRD names is closed.
10. **Guest claim requires phone verification** (§2.9.8 step 5) — completing without a valid Order Number for that phone fails; with one, the existing `customer_id` is reused and `account_type` flips to `REGISTERED`, with no second customer row. An Order Number belonging to a *different* phone is rejected — this is the exact hijack §2.9.8 step 5 names.
11. **Claim atomicity** — a forced failure mid-claim leaves neither a `users` row nor a flipped `account_type`.
12. **Session scope separation** (§2.4, §5.19) — customer token rejected on admin routes and vice versa. Called out separately from spec 03's version because this is the direction a customer would actually attempt.
13. **Profile completeness matches §2.2 exactly** — each required field individually missing yields `complete: false` naming it; email and postal code missing yields `complete: true`. One assertion per field, so a drift in the required set fails loudly. This is the rule spec 11's checkout depends on.
14. **Address discriminators round-trip** (§2.2) — THANA/WARD are not coerced to UPAZILA/UNION.
15. **Password change invalidates sessions** (§11.7).
16. **Email must be verified before recovery uses it** — a pending, unconfirmed address cannot receive a reset OTP.
17. **Rate limits** (§11.3) — for each of `registration`, `customerLogin`, `otpRequest`, `otpVerify`: one request under the limit succeeds and one over it returns 429 (the limiter pair the `test` skill §4 requires per matrix row).
18. **Phone change collision** — moving to a number held by any customer record, guest or registered, is rejected.
19. **Phone change requires re-authentication** (§2.6) — a valid session with a wrong/absent current password cannot change the number, even with a valid email OTP.
20. **Phone change with no email on file** (§2.6) — self-service returns `409 NO_VERIFICATION_CHANNEL`; the Admin/Manager path under `customer.update` succeeds and writes an audit entry naming the actor and both numbers.
21. **`phone_verified_at` is cleared, not carried**, on a phone change — the new number is changed, not proven.

## Open questions / assumptions

1. **SMS provider for phone OTP — RESOLVED; v1 ships complete without SMS.** No PRD names an SMS provider and none is in the fixed stack; §4.14.2 is explicit that the courier's SMS is the courier's own and cannot be repurposed. Both affected flows have a PRD-sanctioned path that does not require one:

   - **§2.9.8 guest-account claim.** The PRD itself offers two equal alternatives — "OTP to the phone, **or** requiring the guest to also supply a matching Order Number." The Order-Number variant is the v1 path. It satisfies the stated security goal verbatim ("so an attacker cannot claim someone else's guest order history just by registering with their phone number"), because the attacker must possess an Order Number that was issued for that phone. **This is not a downgrade or a fallback — it is one of the two mechanisms the PRD specifies.**
   - **§2.6 phone-number change.** The requirement is for the update to follow "**the system's verification rules**" — it delegates to this system's rules rather than mandating SMS. The v1 rule, defined here: a phone change requires (a) re-authentication with the current password, **and** (b) an OTP to the registered email if one is on file. Where no email is on file, the change is **not self-service** — it is an Admin/Manager action under `customer.update` (§5.18), recorded in `audit_logs` with the old and new number. This keeps an unverifiable phone change off the self-service path entirely rather than letting it through unverified.

   `OtpChannel` remains an interface with `EmailOtpChannel` implemented and `SmsOtpChannel` unimplemented. If the client later contracts an SMS provider, adding it enables phone-OTP for both flows with **no change to any caller** — the channel is selected by configuration. Until then no flow is blocked and no verification requirement is weakened.

   *Residual business decision (not a build blocker):* whether to buy SMS at all. It would upgrade §2.9.8's UX (claim without an Order Number) and make §2.6 fully self-service for email-less customers. Worth raising with the client, but v1 is complete and secure without it.
2. **Email provider.** §2.5 requires OTP email delivery but names no provider. *Assumption:* an `EmailService` interface with an SMTP implementation configured by env (`SMTP_*`, `MAIL_FROM`), plus a console implementation in development. This is a configuration choice, not a new technology.
3. **OTP length and format.** §2.5 says "one-time OTP" without specifying. *Assumption:* 6 digits, CSPRNG-generated, hashed at rest — long enough that 5 attempts is a negligible guess budget.
4. **Phone-number change and history.** §2.6 permits updating the phone number, while order history, the risk-check cache, and coupon usage all key on phone (§2.9.4, §7.6, §8.8). *Assumption:* those relationships follow the `customers` row (they reference `customer_id`), so history and coupon counts stay with the person, not the number — which is the behaviour a customer would expect. **Worth flagging**: the risk-check cache describes its key as "the customer's phone number," so a fresh check is appropriate after a phone change; spec 16 treats a changed number as a cache miss.
5. **Order-history visibility for a claimed guest.** §2.9.8 step 4 says past orders "become visible in the new account's order history." *Assumption:* because orders reference `customer_id` and the claim reuses that id, this requires no order-table change — the orders simply become reachable. Spec 15 must scope the customer order list by `customer_id`, not by `account_type`, for this to hold.
6. **`must_change_password` for customers.** §2.7's forced change applies to the seeded Admin. *Assumption:* not applied to customers, who set their own password at registration.
