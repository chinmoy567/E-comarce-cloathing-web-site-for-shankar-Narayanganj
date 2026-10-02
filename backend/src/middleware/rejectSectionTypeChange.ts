import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../lib/errors.js';

/**
 * §13.4: `section_type` is immutable after creation. Surfaces a specific
 * `SECTION_TYPE_IMMUTABLE` code rather than the generic unknown-key error the
 * strict update schema would otherwise produce.
 */
export function rejectSectionTypeChange(req: Request, _res: Response, next: NextFunction): void {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === 'object' && 'sectionType' in body) {
    next(
      new ValidationError(
        'A section\'s type cannot be changed after creation.',
        [{ field: 'sectionType', message: 'Immutable after creation.' }],
        'SECTION_TYPE_IMMUTABLE',
      ),
    );
    return;
  }
  next();
}
