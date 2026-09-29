import type { NextFunction, Request, Response } from 'express';
import { CUSTOMER_ACCESS_COOKIE } from '../config/constants.js';
import { verifyAccessToken } from '../lib/session.js';
import { resolveEffectivePermissions } from '../services/permissions.service.js';
import * as usersRepository from '../repositories/users.repository.js';

/**
 * Optional customer authentication for order creation (spec 11 — 02-customer
 * §2.3, §2.9.1: checkout must work identically for a logged-in customer and a
 * guest on the same `POST /api/customer/orders` route).
 *
 * Unlike `requireAuth`, this middleware NEVER rejects the request — it tries
 * to populate `req.actor` from the customer access cookie when one is present
 * and valid, and calls `next()` regardless of success, failure, or absence.
 * A malformed/expired cookie is treated exactly like "not logged in", i.e. the
 * guest path, never a 401 — checkout must not be blocked by a stale cookie.
 */
export function optionalAuth() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = (req.cookies as Record<string, string> | undefined)?.[CUSTOMER_ACCESS_COOKIE];
      if (!token) {
        next();
        return;
      }

      const claims = verifyAccessToken(token);
      if (!claims || claims.scope !== 'customer') {
        next();
        return;
      }

      const user = await usersRepository.findById(claims.sub);
      if (!user || !user.isActive) {
        next();
        return;
      }

      const permissions = await resolveEffectivePermissions(user.id, user.role);

      req.actor = {
        userId: user.id,
        role: user.role,
        permissions,
        mustChangePassword: user.mustChangePassword,
      };

      next();
    } catch {
      // Any failure while trying to resolve an optional session degrades to
      // "not logged in" — it must never turn into a request failure.
      next();
    }
  };
}
