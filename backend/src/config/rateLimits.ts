import { getEnv } from './env.js';

/**
 * Named rate-limiter registry (spec 04 §11.3 matrix).
 *
 * Every limiter is defined here by name, key strategy, window, and threshold —
 * including limiters for endpoints that do not exist yet (`customerLogin`,
 * `otpRequest`, `otpVerify`, `registration`, `guestOrderLookup`, `trackOrder`,
 * `couponValidate`, `riskCheck`). Later specs mount an existing entry by name
 * (`rateLimit('customerLogin')`) rather than inventing their own limiter, so
 * the composite-keying and non-enumeration rules in `middleware/rateLimit.ts`
 * apply uniformly everywhere.
 *
 * All thresholds are read from env so they can be tuned post-launch with no
 * code change (§11.3 "configurable business/operational parameters").
 */

/** How a limiter derives its counter key(s) from the request. */
export type KeyStrategy =
  /** Two independent counters: identifier alone, and IP alone. Rejects if either trips. */
  | 'identifier+ip'
  /** One counter, IP only. Used when there is no per-account identifier to key on. */
  | 'ip';

/** Where the identifier value is read from, and how it is normalized before keying. */
export type IdentifierSource =
  /** `req.body.phoneNumber` (or equivalent), normalized via `normalizeBdPhone`. */
  | 'phone'
  /** A generic account/user identifier string, lower-cased. */
  | 'userIdentifier'
  /** An order number, upper-cased. */
  | 'orderNumber'
  /** An already-authenticated actor id (`req.actor.userId`). No normalization. */
  | 'actorId'
  /** No identifier — IP-only limiter. */
  | 'none';

export type RateLimiterDefinition = {
  name: string;
  keyStrategy: KeyStrategy;
  identifierSource: IdentifierSource;
  /** Max requests allowed within the window. */
  max: number;
  /** Window length, in seconds. */
  windowSec: number;
  /** Optional additional lockout applied once the window's budget is exhausted. */
  lockoutSec?: number;
};

export type RateLimiterName =
  | 'customerLogin'
  | 'adminLogin'
  | 'otpRequest'
  | 'otpVerify'
  | 'registration'
  | 'guestOrderLookup'
  | 'trackOrder'
  | 'couponValidate'
  | 'riskCheck'
  | 'authenticatedCeiling'
  | 'publicCeiling';

/** Builds the registry from the current environment. Not cached — reads env fresh, matching `getEnv()`'s own memoization. */
export function buildRateLimiterRegistry(): Record<RateLimiterName, RateLimiterDefinition> {
  const env = getEnv();

  return {
    customerLogin: {
      name: 'customerLogin',
      keyStrategy: 'identifier+ip',
      identifierSource: 'phone',
      max: env.RL_CUSTOMER_LOGIN_MAX,
      windowSec: env.RL_CUSTOMER_LOGIN_WINDOW_SEC,
      lockoutSec: env.RL_ADMIN_LOGIN_LOCKOUT_MAX_SEC,
    },
    adminLogin: {
      name: 'adminLogin',
      keyStrategy: 'identifier+ip',
      identifierSource: 'userIdentifier',
      max: env.RL_ADMIN_LOGIN_MAX,
      windowSec: env.RL_ADMIN_LOGIN_WINDOW_SEC,
      lockoutSec: env.RL_ADMIN_LOGIN_LOCKOUT_MAX_SEC,
    },
    otpRequest: {
      name: 'otpRequest',
      keyStrategy: 'identifier+ip',
      identifierSource: 'phone',
      max: env.RL_OTP_REQUEST_MAX,
      windowSec: env.RL_OTP_REQUEST_WINDOW_SEC,
    },
    otpVerify: {
      name: 'otpVerify',
      keyStrategy: 'identifier+ip',
      // Keyed on the issued OTP id at the call site (not a stable account
      // identifier), so it is passed explicitly rather than normalized here.
      identifierSource: 'userIdentifier',
      max: env.RL_OTP_VERIFY_MAX,
      windowSec: env.RL_OTP_REQUEST_WINDOW_SEC,
    },
    registration: {
      name: 'registration',
      keyStrategy: 'ip',
      identifierSource: 'none',
      max: env.RL_REGISTRATION_MAX,
      windowSec: env.RL_REGISTRATION_WINDOW_SEC,
    },
    guestOrderLookup: {
      name: 'guestOrderLookup',
      keyStrategy: 'identifier+ip',
      identifierSource: 'orderNumber',
      max: env.RL_GUEST_LOOKUP_MAX,
      windowSec: env.RL_GUEST_LOOKUP_WINDOW_SEC,
      lockoutSec: env.RL_GUEST_LOOKUP_LOCKOUT_SEC,
    },
    trackOrder: {
      name: 'trackOrder',
      keyStrategy: 'identifier+ip',
      identifierSource: 'orderNumber',
      max: env.RL_TRACK_ORDER_MAX,
      windowSec: env.RL_TRACK_ORDER_WINDOW_SEC,
    },
    couponValidate: {
      name: 'couponValidate',
      keyStrategy: 'identifier+ip',
      identifierSource: 'actorId',
      max: env.RL_COUPON_VALIDATE_MAX,
      windowSec: env.RL_COUPON_VALIDATE_WINDOW_SEC,
    },
    riskCheck: {
      name: 'riskCheck',
      keyStrategy: 'identifier+ip',
      identifierSource: 'actorId',
      max: env.RL_RISK_CHECK_MAX,
      windowSec: env.RL_RISK_CHECK_WINDOW_SEC,
    },
    authenticatedCeiling: {
      name: 'authenticatedCeiling',
      keyStrategy: 'identifier+ip',
      identifierSource: 'actorId',
      max: env.RL_AUTH_CEILING_MAX,
      windowSec: env.RL_AUTH_CEILING_WINDOW_SEC,
    },
    publicCeiling: {
      name: 'publicCeiling',
      keyStrategy: 'ip',
      identifierSource: 'none',
      max: env.RL_PUBLIC_CEILING_MAX,
      windowSec: env.RL_PUBLIC_CEILING_WINDOW_SEC,
    },
  };
}
