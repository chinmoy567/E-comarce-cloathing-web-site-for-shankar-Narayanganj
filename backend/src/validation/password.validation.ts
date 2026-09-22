import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '../config/constants.js';
import { ValidationError } from '../lib/errors.js';

/**
 * The single shared password policy (11-security-hardening §11.7, spec 03 open
 * question 2): >= 12 characters, at least one letter and one digit.
 *
 * Applied identically to the Admin seed, Manager creation, and every password
 * change — no code path defines its own rule.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one digit.');

/**
 * Enforces the same policy outside the HTTP layer — the Admin seed script and
 * the out-of-band reset CLI run before any Express middleware exists, so they
 * cannot go through `validate()`. Throws `ValidationError` `WEAK_PASSWORD` on
 * failure, never echoing the offending password.
 */
export function assertPasswordPolicy(password: string): void {
  const result = passwordSchema.safeParse(password);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'Password does not meet the minimum policy.';
    throw new ValidationError(message, undefined, 'WEAK_PASSWORD');
  }
}
