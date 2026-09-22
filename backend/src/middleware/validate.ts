import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ValidationError } from '../lib/errors.js';
import type { ApiErrorDetail } from '../types/api.js';

export type ValidationSchemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

function toDetails(error: ZodError): ApiErrorDetail[] {
  return error.issues.flatMap((issue): ApiErrorDetail[] => {
    const prefix = issue.path.join('.');

    // `.strict()` reports every unknown key in one issue with an empty path.
    // Expand it so the response names each offending field individually
    // (spec 01 acceptance 6).
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        field: prefix ? `${prefix}.${key}` : key,
        message: 'Unrecognized field.',
      }));
    }

    return [{ field: prefix || '(root)', message: issue.message }];
  });
}

/**
 * Schema validation, run before the controller (11-security-hardening §11.6).
 *
 * Schemas must be `.strict()` so unknown fields are rejected rather than passed
 * through. Every route in every later spec mounts this.
 *
 * The parsed (and therefore coerced/defaulted) value replaces the raw input, so
 * controllers read typed data rather than raw strings.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const details: ApiErrorDetail[] = [];

    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (result.success) {
        // `query` and `params` are getter-only on Express 5; assign defensively.
        Object.defineProperty(req, key, {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        details.push(...toDetails(result.error));
      }
    }

    if (details.length > 0) {
      next(new ValidationError('The request contains invalid fields.', details));
      return;
    }

    next();
  };
}
