import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getEnv } from '../config/env.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { sha256Hex } from '../lib/hash.js';
import { normalizeBdPhone } from '../lib/phone.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { withTransaction } from '../lib/transaction.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import * as customersRepository from '../repositories/customers.repository.js';
import * as emailTokens from '../repositories/emailVerificationTokens.repository.js';
import * as oneTimeCodes from '../repositories/oneTimeCodes.repository.js';
import * as usersRepository from '../repositories/users.repository.js';
import { sendEmail } from './email/index.js';
import { emailChangeEmail, phoneChangeOtpEmail } from './email/templates.js';
import { consumeCode, hashCode } from './oneTimeCode.service.js';

/**
 * Verified account changes for a registered customer (02-customer §2.6, §2.9.8; spec 08):
 *   - email change by confirmation link (an address is never trusted until confirmed),
 *   - phone-number change by password + email OTP,
 *   - guest-to-registered claim, proven by a matching order number.
 *
 * No SMS provider exists in the stack (spec 08, open question 1), so phone change uses the
 * customer's verified email, and the guest claim uses the spec's order-number fallback.
 */

const EMAIL_TOKEN_TTL_HOURS = 24;
const PHONE_PURPOSE = 'PHONE_VERIFICATION' as const;

function invalidCode(): ValidationError {
  return new ValidationError('The code is invalid or has expired.', undefined, 'INVALID_OR_EXPIRED_CODE');
}

function phoneInUse(): ConflictError {
  return new ConflictError('That phone number is already in use.', undefined, 'PHONE_IN_USE');
}

// ---------------------------------------------------------------- email change

/**
 * Emails a confirmation link for `email`. Nothing is written to `users` until it is confirmed.
 * Safe to call repeatedly: each call supersedes the previous pending link.
 */
export async function requestEmailChange(userId: string, email: string): Promise<void> {
  const user = await usersRepository.findById(userId);
  if (!user || user.role !== 'CUSTOMER') throw new NotFoundError('Customer not found');

  const normalized = email.trim().toLowerCase();
  if (user.email?.toLowerCase() === normalized && user.emailVerifiedAt) return; // already confirmed

  const token = randomBytes(32).toString('hex');
  await emailTokens.replaceForUser({
    userId,
    newEmail: normalized,
    tokenHash: sha256Hex(token),
    ttlSec: EMAIL_TOKEN_TTL_HOURS * 3600,
  });

  const link = `${getEnv().PUBLIC_SITE_URL.replace(/\/$/, '')}/account/verify-email?token=${token}`;
  void sendEmail(emailChangeEmail(normalized, link, EMAIL_TOKEN_TTL_HOURS));
}

/** Consumes a confirmation link: writes the verified address and stamps `email_verified_at`. */
export async function confirmEmailChange(token: string, requestId?: string | null): Promise<void> {
  const done = await withTransaction(async (client) => {
    const pending = await emailTokens.consume(sha256Hex(token), client);
    if (!pending) return false;

    const user = await usersRepository.findById(pending.userId, client);
    if (!user || user.role !== 'CUSTOMER' || !user.isActive || !user.customerId) return false;

    await usersRepository.update(user.id, { email: pending.newEmail, emailVerifiedAt: new Date() }, client);
    const customer = await customersRepository.findById(user.customerId, client);
    if (customer) {
      await customersRepository.updateProfile(
        customer.id,
        { fullName: customer.fullName, email: pending.newEmail },
        client,
      );
    }
    await appendAudit(
      {
        entityType: 'user',
        entityId: user.id,
        action: 'email_verified',
        actorUserId: user.id,
        actorType: 'USER',
        requestId,
      },
      client,
    );
    return true;
  });
  if (!done) throw invalidCode();
}

// ---------------------------------------------------------------- phone change

async function assertPhoneFree(phone: string, client?: pg.PoolClient): Promise<void> {
  const [existing, login] = await Promise.all([
    customersRepository.findByPhoneNumber(phone, client),
    usersRepository.findByPhoneNumber(phone, client),
  ]);
  if (existing || login) throw phoneInUse();
}

/**
 * Starts a phone change. Re-authenticates with the current password, requires a verified email
 * (the only verification channel there is), and emails an OTP bound to the new number.
 */
export async function requestPhoneChange(
  userId: string,
  newPhoneInput: string,
  currentPassword: string,
): Promise<{ otpId: string }> {
  const env = getEnv();
  const user = await usersRepository.findByIdWithSecret(userId);
  if (!user || user.role !== 'CUSTOMER') throw new NotFoundError('Customer not found');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ValidationError('Current password is incorrect.', undefined, 'INVALID_CREDENTIALS');
  }
  if (!user.email || !user.emailVerifiedAt) {
    throw new ConflictError(
      'Add and confirm an email address first, or contact support to change your phone number.',
      undefined,
      'NO_VERIFICATION_CHANNEL',
    );
  }

  const newPhone = normalizeBdPhone(newPhoneInput);
  await assertPhoneFree(newPhone);

  const otpId = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

  const issued = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${PHONE_PURPOSE}:${userId}`]);
    const recent = await oneTimeCodes.countIssuedSince(userId, PHONE_PURPOSE, env.RL_OTP_REQUEST_WINDOW_SEC, client);
    if (recent >= env.RL_OTP_REQUEST_MAX) return false;

    await oneTimeCodes.invalidateLive(userId, PHONE_PURPOSE, client);
    await oneTimeCodes.create(
      {
        id: otpId,
        purpose: PHONE_PURPOSE,
        userId,
        destinationHash: sha256Hex(newPhone),
        codeHash: hashCode(otpId, code),
        ttlSec: env.OTP_TTL_MINUTES * 60,
      },
      client,
    );
    return true;
  });

  if (issued) void sendEmail(phoneChangeOtpEmail(user.email, code, env.OTP_TTL_MINUTES, newPhone));
  return { otpId };
}

/** Confirms a phone change: updates `users.phone_number` and `customers.phone_number` together. */
export async function confirmPhoneChange(
  userId: string,
  otpId: string,
  code: string,
  newPhoneInput: string,
  requestId?: string | null,
): Promise<{ phoneNumber: string }> {
  const newPhone = normalizeBdPhone(newPhoneInput);

  const outcome = await withTransaction(async (client) => {
    const ok = await consumeCode(client, {
      otpId,
      code,
      purpose: PHONE_PURPOSE,
      userId,
      destinationHash: sha256Hex(newPhone),
    });
    if (!ok) return 'bad-code' as const;

    const user = await usersRepository.findById(userId, client);
    if (!user || user.role !== 'CUSTOMER' || !user.customerId) return 'bad-code' as const;

    // The number was free at request time; re-check, since another customer may have taken it since.
    try {
      await assertPhoneFree(newPhone, client);
    } catch (err) {
      if (err instanceof ConflictError) return 'in-use' as const;
      throw err;
    }

    await customersRepository.updatePhone(user.customerId, newPhone, client);
    await usersRepository.update(userId, { phoneNumber: newPhone }, client);
    await appendAudit(
      {
        entityType: 'customer',
        entityId: user.customerId,
        action: 'phone_changed',
        previousValue: { phone_number: user.phoneNumber },
        newValue: { phone_number: newPhone },
        actorUserId: userId,
        actorType: 'USER',
        requestId,
      },
      client,
    );
    return 'ok' as const;
  });

  if (outcome === 'bad-code') throw invalidCode();
  if (outcome === 'in-use') throw phoneInUse();
  return { phoneNumber: newPhone };
}

// ----------------------------------------------------------------- guest claim

/**
 * Turns an existing GUEST record into a registered account (§2.9.8). Possession of the phone is
 * proven by an order number that belongs to that record (the spec's fallback while no SMS
 * channel exists). The existing `customers` row is reused, so order history follows it and no
 * second customer record is created. Every failure is the same error so nothing reveals which
 * phones have ordered.
 */
export async function claimGuestAccount(
  input: { phone: string; orderNumber: string; password: string },
  requestId?: string | null,
): Promise<{ id: string; phone_number: string }> {
  const fail = () => new ValidationError('We could not verify those details.', undefined, 'CLAIM_NOT_VERIFIED');
  const phone = normalizeBdPhone(input.phone);
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    const customer = await customersRepository.findByPhoneNumber(phone, client);
    if (!customer || customer.accountType !== 'GUEST') throw fail();

    const { rowCount } = await client.query('SELECT 1 FROM orders WHERE order_number = $1 AND customer_id = $2', [
      input.orderNumber.trim().toUpperCase(),
      customer.id,
    ]);
    if (!rowCount) throw fail();

    const user = await usersRepository.create(
      { role: 'CUSTOMER', passwordHash, phoneNumber: phone, customerId: customer.id },
      client,
    );
    await customersRepository.promoteToRegistered(customer.id, client);
    await appendAudit(
      {
        entityType: 'customer',
        entityId: customer.id,
        action: 'guest_claimed',
        actorUserId: user.id,
        actorType: 'USER',
        requestId,
      },
      client,
    );
    return { id: user.id, phone_number: phone };
  });
}
