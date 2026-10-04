import { randomInt, randomUUID } from 'node:crypto';
import { getEnv } from '../config/env.js';
import { hashPassword } from '../lib/password.js';
import { sha256Hex } from '../lib/hash.js';
import { ValidationError } from '../lib/errors.js';
import { signResetGrant, verifyResetGrant } from '../lib/session.js';
import { withTransaction } from '../lib/transaction.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import * as oneTimeCodes from '../repositories/oneTimeCodes.repository.js';
import * as refreshTokensRepository from '../repositories/refreshTokens.repository.js';
import * as usersRepository from '../repositories/users.repository.js';
import { passwordResetOtpEmail } from './email/templates.js';
import { sendEmail } from './email/index.js';
import { consumeCode, hashCode } from './oneTimeCode.service.js';

/**
 * Customer password recovery by email OTP (02-customer §2.5, spec 08 §Password recovery).
 *
 * Rules enforced here: 10-minute expiry, single use, max 3 requests per account per
 * 15 minutes, max 5 wrong guesses per issued code, and one identical failure for every
 * cause so nothing reveals whether an account, a code, or a limit was involved.
 */

const PURPOSE = 'PASSWORD_RESET' as const;

function invalidCode(): ValidationError {
  return new ValidationError('The code is invalid or has expired.', undefined, 'INVALID_OR_EXPIRED_CODE');
}

/**
 * Issues a code if the email belongs to an active customer and the request budget allows.
 * Always returns an `otpId` that looks the same whether or not anything was issued, so
 * the caller can answer identically in every case.
 */
export async function requestPasswordResetOtp(email: string): Promise<{ otpId: string }> {
  const env = getEnv();
  const otpId = randomUUID();

  const user = await usersRepository.findActiveCustomerByEmail(email);
  if (!user) return { otpId };

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

  const issued = await withTransaction(async (client) => {
    // Serialize per account so two parallel requests cannot both pass the budget check.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${PURPOSE}:${user.id}`]);

    const recent = await oneTimeCodes.countIssuedSince(user.id, PURPOSE, env.RL_OTP_REQUEST_WINDOW_SEC, client);
    if (recent >= env.RL_OTP_REQUEST_MAX) return false;

    await oneTimeCodes.invalidateLive(user.id, PURPOSE, client);
    await oneTimeCodes.create(
      {
        id: otpId,
        purpose: PURPOSE,
        userId: user.id,
        destinationHash: sha256Hex(email.trim().toLowerCase()),
        codeHash: hashCode(otpId, code),
        ttlSec: env.OTP_TTL_MINUTES * 60,
      },
      client,
    );
    return true;
  });

  if (issued) {
    // Not awaited: delivery time must not distinguish a real account from an unknown one.
    // `sendEmail` never throws and never logs the body.
    void sendEmail(passwordResetOtpEmail(user.email ?? email, code, env.OTP_TTL_MINUTES));
  }
  return { otpId };
}

/** Verifies a code and returns a single-use reset grant. Every failure is the same `INVALID_OR_EXPIRED_CODE`. */
export async function verifyPasswordResetOtp(otpId: string, code: string): Promise<string> {
  // The failed-attempt counter must persist, so a bad code is a `false`, not a throw, inside the transaction.
  const ok = await withTransaction((client) => consumeCode(client, { otpId, code, purpose: PURPOSE }));

  if (!ok) throw invalidCode();
  return signResetGrant(otpId);
}

/** Sets a new password from a verified grant, spends the grant, and signs the account out everywhere. */
export async function resetPassword(grant: string, newPassword: string, requestId?: string | null): Promise<void> {
  const otpId = verifyResetGrant(grant);
  if (!otpId) throw invalidCode();

  const passwordHash = await hashPassword(newPassword);

  const done = await withTransaction(async (client) => {
    const userId = await oneTimeCodes.spendGrant(otpId, client);
    if (!userId) return false;

    await usersRepository.update(userId, { passwordHash }, client);
    await refreshTokensRepository.revokeAllForUser(userId, client);
    await appendAudit(
      {
        entityType: 'user',
        entityId: userId,
        action: 'password_reset_via_otp',
        actorUserId: userId,
        actorType: 'USER',
        requestId,
      },
      client,
    );
    return true;
  });

  if (!done) throw invalidCode();
}
