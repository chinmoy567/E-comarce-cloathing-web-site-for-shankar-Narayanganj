import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import type { UserRole } from '../types/role.js';

/**
 * The single session-token mechanism (spec 03 §Session design).
 *
 * No other module signs or verifies a JWT, and no other module hashes a
 * refresh token. Spec 08 (customer sessions) reuses this module with
 * `scope: 'customer'` rather than inventing a second mechanism.
 */

export type SessionScope = 'admin' | 'customer';

export type AccessTokenClaims = {
  sub: string;
  scope: SessionScope;
  role: UserRole;
};

/**
 * Signs a short-lived access token. `exp` is set by `expiresIn`, not carried
 * in `claims`, so the caller cannot accidentally mint a token with a mismatched
 * expiry between the JWT header and a manually-set claim.
 */
export function signAccessToken(claims: AccessTokenClaims): string {
  const env = getEnv();
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.ADMIN_ACCESS_TOKEN_TTL_MIN}m`,
  });
}

export type VerifiedAccessToken = AccessTokenClaims;

/** Returns null on any verification failure (expired, malformed, wrong signature) rather than throwing. */
export function verifyAccessToken(token: string): VerifiedAccessToken | null {
  try {
    const env = getEnv();
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof decoded !== 'object' || decoded === null) return null;
    const { sub, scope, role } = decoded as Partial<AccessTokenClaims>;
    if (typeof sub !== 'string' || (scope !== 'admin' && scope !== 'customer') || typeof role !== 'string') {
      return null;
    }
    return { sub, scope, role: role as UserRole };
  } catch {
    return null;
  }
}

/** Opaque 256-bit refresh token. The raw value is returned to the caller once and never stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 of the raw refresh token — the only form persisted (§11.7). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Refresh-token expiry, `ADMIN_REFRESH_TOKEN_TTL_DAYS` from now. */
export function refreshTokenExpiry(): Date {
  const env = getEnv();
  const ms = env.ADMIN_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

/** Opaque CSRF token for the double-submit cookie (§11.5). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}
