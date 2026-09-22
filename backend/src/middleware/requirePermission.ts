import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, InternalError } from '../lib/errors.js';
import type { PermissionKey } from '../types/permissions.js';

/**
 * Runs after `requireAuth('admin')`. Rejects 403 `FORBIDDEN` if `req.actor`
 * lacks the given key. This is the ONE place a route declares its required
 * permission — later specs mount this instead of re-deriving authorization
 * (06-rbac §5.18).
 */
export function requirePermission(key: PermissionKey) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) {
      // requireAuth must run first; a missing actor here is a route-wiring bug.
      next(new InternalError('requirePermission used without requireAuth.'));
      return;
    }

    if (!req.actor.permissions.includes(key)) {
      next(new ForbiddenError('You do not have permission to perform this action.'));
      return;
    }

    next();
  };
}
