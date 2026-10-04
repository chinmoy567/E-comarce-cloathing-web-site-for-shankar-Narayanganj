import { createHmac, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { getEnv } from '../config/env.js';
import * as oneTimeCodes from '../repositories/oneTimeCodes.repository.js';

/**
 * Shared OTP mechanics (02-customer §2.5): the HMAC, the constant-time compare, and the
 * attempt cap. Password recovery and phone change both go through here so the rules cannot drift.
 */

/** HMAC keyed by a server secret and bound to the code id: a database read alone yields no usable code. */
export function hashCode(otpId: string, code: string): string {
  return createHmac('sha256', getEnv().JWT_REFRESH_SECRET).update(`${otpId}:${code}`).digest('hex');
}

/**
 * Checks a code inside the caller's transaction. Returns true and consumes the code on success;
 * returns false (recording the wrong guess, invalidating at the cap) otherwise. It never throws
 * for a bad code, so the failed-attempt write commits with the caller's transaction.
 *
 * `userId` / `destinationHash`, when given, must match the stored code (a code issued to one
 * account or for one new phone number can never confirm another).
 */
export async function consumeCode(
  client: pg.PoolClient,
  input: {
    otpId: string;
    code: string;
    purpose: oneTimeCodes.OneTimeCodePurpose;
    userId?: string;
    destinationHash?: string;
  },
): Promise<boolean> {
  const row = await oneTimeCodes.findByIdForUpdate(input.otpId, client);
  if (
    !row ||
    row.purpose !== input.purpose ||
    row.consumedAt ||
    row.invalidatedAt ||
    row.expiresAt < new Date() ||
    (input.userId !== undefined && row.userId !== input.userId) ||
    (input.destinationHash !== undefined && row.destinationHash !== input.destinationHash)
  ) {
    return false;
  }

  const expected = Buffer.from(row.codeHash, 'hex');
  const actual = Buffer.from(hashCode(input.otpId, input.code), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await oneTimeCodes.recordFailedAttempt(row.id, getEnv().OTP_MAX_ATTEMPTS, client);
    return false;
  }

  await oneTimeCodes.markConsumed(row.id, client);
  return true;
}
