import { UnauthorizedError } from '../lib/errors.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../lib/session.js';
import * as refreshTokensRepository from '../repositories/refreshTokens.repository.js';
import * as usersRepository from '../repositories/users.repository.js';

/**
 * Customer session lifecycle (spec 08, 02-customer §2.4). Mirrors the admin session in
 * `adminAuth.service.ts` — same `refresh_tokens` table, same hashed-at-rest and rotate-on-use
 * rules (11-security-hardening §11.7) — under `scope: 'customer'`, so neither session can
 * ever be used on the other's routes.
 */

export type CustomerSessionTokens = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

export async function issueCustomerSession(userId: string): Promise<CustomerSessionTokens> {
  const accessToken = signAccessToken({ sub: userId, scope: 'customer', role: 'CUSTOMER' });
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = refreshTokenExpiry();

  await refreshTokensRepository.create({
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    scope: 'customer',
    expiresAt: refreshTokenExpiresAt,
  });

  return { accessToken, refreshToken, refreshTokenExpiresAt };
}

/**
 * Rotates a refresh token. A revoked or expired token being presented is treated as reuse:
 * every live token for that customer is revoked and the caller gets 401.
 */
export async function refreshCustomerSession(rawRefreshToken: string): Promise<CustomerSessionTokens> {
  const existing = await refreshTokensRepository.findByHash(hashRefreshToken(rawRefreshToken));

  if (!existing || existing.scope !== 'customer') {
    throw new UnauthorizedError('Session expired.');
  }

  if (existing.revokedAt || existing.expiresAt < new Date()) {
    await refreshTokensRepository.revokeAllForUser(existing.userId);
    throw new UnauthorizedError('Session expired.');
  }

  const user = await usersRepository.findById(existing.userId);
  if (!user || user.role !== 'CUSTOMER' || !user.isActive) {
    await refreshTokensRepository.revokeAllForUser(existing.userId);
    throw new UnauthorizedError('Session expired.');
  }

  const tokens = await issueCustomerSession(user.id);
  const successor = await refreshTokensRepository.findByHash(hashRefreshToken(tokens.refreshToken));
  await refreshTokensRepository.revoke(existing.id, successor?.id ?? null);
  return tokens;
}

/** Revokes the presented refresh token. Silent when it is missing, unknown, or someone else's. */
export async function revokeCustomerSession(userId: string, rawRefreshToken: string | undefined): Promise<void> {
  if (!rawRefreshToken) return;
  const existing = await refreshTokensRepository.findByHash(hashRefreshToken(rawRefreshToken));
  if (existing && existing.userId === userId && existing.scope === 'customer') {
    await refreshTokensRepository.revoke(existing.id, null);
  }
}
