import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../lib/errors.js';

/** Terminal route matcher: any unmatched path becomes a NOT_FOUND AppError. */
export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError('The requested resource was not found.'));
}
