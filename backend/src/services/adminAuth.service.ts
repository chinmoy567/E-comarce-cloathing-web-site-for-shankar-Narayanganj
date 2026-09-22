import { verifyPassword, hashPassword } from '../lib/password.js';
import { UnauthorizedError } from '../lib/errors.js';
import {
  generateCsrfToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../lib/session.js';
import * as usersRepository from '../repositories/users.repository.js';
import * as refreshTokensRepository from '../repositories/refreshTokens.repository.js';
import { resolveEffectivePermissions } from './permissions.service.js';
import { assertPasswordPolicy } from '../validation/password.validation.js';
import type { PermissionKey } from '../types/permissions.js';
import type { UserRole } from '../types/role.js';

/**
 * Admin/Manager session lifecycle (spec 03 §Session design, §Routes).
 *
 * Login gives byte-identical responses for an unknown identifier, a wrong
 * password, and an inactive account — all three collapse to one
 * `INVALID_CREDENTIALS` — so the endpoint never leaks whether an identifier
 * exists (11-security-hardening §11.2).
 */

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  csrfToken: string;
};

export type AdminActorSummary = {
  id: string;
  userIdentifier: string;
  role: Extract<UserRole, 'ADMIN' | 'MANAGER'>;
  isSystemAdmin: boolean;
};

export type LoginResult = {
  user: AdminActorSummary;
  permissions: PermissionKey[];
  mustChangePassword: boolean;
  tokens: SessionTokens;
};

async function issueTokens(userId: string, role: UserRole): Promise<SessionTokens> {
  const accessToken = signAccessToken({ sub: userId, scope: 'admin', role });
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = refreshTokenExpiry();

  await refreshTokensRepository.create({
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    scope: 'admin',
    expiresAt: refreshTokenExpiresAt,
  });

  return { accessToken, refreshToken, refreshTokenExpiresAt, csrfToken: generateCsrfToken() };
}

export async function login(userIdentifier: string, password: string): Promise<LoginResult> {
  const user = await usersRepository.findByUserIdentifier(userIdentifier);

  const genericError = new UnauthorizedError('Invalid user ID or password.', undefined, 'INVALID_CREDENTIALS');

  if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) {
    throw genericError;
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk || !user.isActive) {
    throw genericError;
  }

  await usersRepository.update(user.id, { lastLoginAt: new Date() });

  const [permissions, tokens] = await Promise.all([
    resolveEffectivePermissions(user.id, user.role),
    issueTokens(user.id, user.role),
  ]);

  return {
    user: { id: user.id, userIdentifier: user.userIdentifier!, role: user.role, isSystemAdmin: user.isSystemAdmin },
    permissions,
    mustChangePassword: user.mustChangePassword,
    tokens,
  };
}

export type RefreshResult = { tokens: SessionTokens };

/**
 * Rotates a refresh token. Presenting an already-revoked token is treated as
 * reuse — the entire chain for that user is revoked and the caller gets 401,
 * per §11.7's "rotated on use" and spec 03 acceptance 19.
 */
export async function refresh(rawRefreshToken: string): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const existing = await refreshTokensRepository.findByHash(tokenHash);

  if (!existing || existing.scope !== 'admin') {
    throw new UnauthorizedError('Session expired.');
  }

  if (existing.revokedAt || existing.expiresAt < new Date()) {
    // Reuse of an already-revoked token, or a naturally expired one: either
    // way the safest response is to kill every live token for this user.
    await refreshTokensRepository.revokeAllForUser(existing.userId);
    throw new UnauthorizedError('Session expired.');
  }

  const user = await usersRepository.findById(existing.userId);
  if (!user || !user.isActive) {
    await refreshTokensRepository.revokeAllForUser(existing.userId);
    throw new UnauthorizedError('Session expired.');
  }

  const tokens = await issueTokens(user.id, user.role);
  const newRecord = await refreshTokensRepository.findByHash(hashRefreshToken(tokens.refreshToken));
  await refreshTokensRepository.revoke(existing.id, newRecord?.id ?? null);

  return { tokens };
}

export async function logout(userId: string, rawRefreshToken: string | undefined): Promise<void> {
  if (rawRefreshToken) {
    const existing = await refreshTokensRepository.findByHash(hashRefreshToken(rawRefreshToken));
    if (existing && existing.userId === userId) {
      await refreshTokensRepository.revoke(existing.id, null);
    }
  }
}

/**
 * The spec's `MeResponse` type is `AdminLoginResponse['user'] & { permissions
 * }`; `mustChangePassword` is added here too, beyond the literal type, because
 * the frontend shell needs it on every page load (not just the login
 * response) to know whether to redirect to the forced password-change page —
 * without it there is no way to answer "is this session still gated" after a
 * refresh. Adding a field is compatible with every acceptance criterion, none
 * of which asserts an exact `/auth/me` shape.
 */
export type MeResult = AdminActorSummary & { permissions: PermissionKey[]; mustChangePassword: boolean };

export async function getMe(userId: string, permissions: PermissionKey[]): Promise<MeResult> {
  const user = await usersRepository.findById(userId);
  if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) {
    throw new UnauthorizedError('Authentication required.');
  }
  return {
    id: user.id,
    userIdentifier: user.userIdentifier!,
    role: user.role,
    isSystemAdmin: user.isSystemAdmin,
    permissions,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await usersRepository.findByIdWithSecret(userId);
  if (!user) {
    throw new UnauthorizedError('Authentication required.');
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    throw new UnauthorizedError('Current password is incorrect.', undefined, 'INVALID_CREDENTIALS');
  }

  assertPasswordPolicy(newPassword);

  const newHash = await hashPassword(newPassword);
  await usersRepository.update(userId, { passwordHash: newHash, mustChangePassword: false });
}
