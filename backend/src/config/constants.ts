/** Global JSON body size limit (11-security-hardening §11.4). */
export const JSON_BODY_LIMIT = '100kb';

/** Header carrying the per-request correlation id. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Pagination bounds, mandatory on every list endpoint (§11.4). */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** The only message an unexpected server error may present to a client. */
export const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred.';

/**
 * Website identity. Single source of truth on the backend for the brand name
 * and canonical domain — outbound email subjects and bodies, and the
 * "store's own domain" check for CMS `cta_url` validation (13-homepage-cms
 * 13.13), read from here rather than hard-coding a string.
 *
 * The frontend mirror lives in `frontend/src/lib/site.ts`; keep the two in step.
 */
export const SITE_NAME = 'Fabrillke';

/** Bare canonical domain, no scheme. */
export const SITE_DOMAIN = 'fabrillke.com';

/** Transactional sender address for order and account email. */
export const EMAIL_FROM_NAME = SITE_NAME;
export const EMAIL_FROM_ADDRESS = `noreply@${SITE_DOMAIN}`;

/**
 * bcrypt work factor for password hashing (11-security-hardening §11.7 requires
 * bcrypt cost >= 12). Raising this is safe: existing hashes carry their own cost
 * and still verify.
 */
export const BCRYPT_COST = 12;

/**
 * Per-transaction statement timeout for `withTransaction` (spec 02 assumption 3).
 * Bounds how long one statement may hold a pooled connection, which matters
 * because the pg pool and the Supabase client share one instance connection cap.
 */
export const STATEMENT_TIMEOUT_MS = 10_000;

/**
 * Minimum password policy (11-security-hardening §11.7, spec 03 open question 2):
 * >= 12 characters, at least one letter and one digit. The single shared policy
 * applied to the Admin seed, Manager creation, and every password change.
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Back-office session cookie names (spec 03 §Session design). Distinct from any
 * customer-session cookie name spec 08 introduces, so both sessions can coexist
 * in one browser without either being usable on the other's routes (§2.4).
 */
export const ADMIN_ACCESS_COOKIE = 'admin_at';
export const ADMIN_REFRESH_COOKIE = 'admin_rt';
export const ADMIN_CSRF_COOKIE = 'admin_csrf';

/** Double-submit CSRF header checked against `ADMIN_CSRF_COOKIE` (§11.5). */
export const CSRF_HEADER = 'x-csrf-token';
