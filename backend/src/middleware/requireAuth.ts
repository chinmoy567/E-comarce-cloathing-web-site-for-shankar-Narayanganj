import type { NextFunction, Request, Response } from 'express';
import { ADMIN_ACCESS_COOKIE, ADMIN_CSRF_COOKIE, CSRF_HEADER, CUSTOMER_ACCESS_COOKIE } from '../config/constants.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { verifyAccessToken, type SessionScope } from '../lib/session.js';
import { resolveEffectivePermissions } from '../services/permissions.service.js';
import * as usersRepository from '../repositories/users.repository.js';
import type { PermissionKey } from '../types/permissions.js';
import type { UserRole } from '../types/role.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `requireAuth`; absent on public routes. */
      actor?: {
        userId: string;
        role: UserRole;
        permissions: PermissionKey[];
        mustChangePassword: boolean;
      };
    }
  }
}

/** State-changing methods that require the double-submit CSRF check (§11.5). */
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Verifies the session, enforces scope separation, and attaches `req.actor`.
 *
 * `requireAuth('admin')` rejects any token whose `scope` claim is not
 * `'admin'` with 401 — so a customer session, even a valid one, can never
 * reach a back-office endpoint, and vice versa (02-customer §2.4).
 *
 * Effective permissions are re-resolved on every request rather than read off
 * the token, so a mid-session grant or revoke takes effect immediately
 * (11-security-hardening §11.7) — this is deliberately not cached across
 * requests.
 */
export function requireAuth(scope: SessionScope) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookieName = scope === 'admin' ? ADMIN_ACCESS_COOKIE : CUSTOMER_ACCESS_COOKIE;
      const token = (req.cookies as Record<string, string> | undefined)?.[cookieName];

      if (!token) {
        throw new UnauthorizedError('Authentication required.');
      }

      const claims = verifyAccessToken(token);
      if (!claims || claims.scope !== scope) {
        throw new UnauthorizedError('Authentication required.');
      }

      const user = await usersRepository.findById(claims.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedError('Authentication required.');
      }

      if (scope === 'admin' && CSRF_PROTECTED_METHODS.has(req.method)) {
        const csrfCookie = (req.cookies as Record<string, string> | undefined)?.[ADMIN_CSRF_COOKIE];
        const csrfHeader = req.get(CSRF_HEADER);
        if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
          throw new ForbiddenError('CSRF token missing or invalid.', undefined, 'CSRF_FAILED');
        }
      }

      const permissions = await resolveEffectivePermissions(user.id, user.role);

      req.actor = {
        userId: user.id,
        role: user.role,
        permissions,
        mustChangePassword: user.mustChangePassword,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
