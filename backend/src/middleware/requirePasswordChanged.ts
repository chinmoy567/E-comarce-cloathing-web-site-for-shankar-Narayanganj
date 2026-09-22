import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, InternalError } from '../lib/errors.js';

/**
 * Blocks every admin route until the forced first-login password change is
 * done (02-customer §2.7). Mounted on every `/api/admin/*` route except
 * `/auth/me`, `/auth/change-password`, and `/auth/logout` — those three stay
 * reachable so a stuck account can still get itself unstuck and sign out.
 */
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction): void {
  if (!req.actor) {
    next(new InternalError('requirePasswordChanged used without requireAuth.'));
    return;
  }

  if (req.actor.mustChangePassword) {
    next(new ForbiddenError('Password change required before continuing.', undefined, 'PASSWORD_CHANGE_REQUIRED'));
    return;
  }

  next();
}
