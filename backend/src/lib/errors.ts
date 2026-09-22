import type { ApiErrorDetail } from '../types/api.js';

/** Field-level detail accepted by an AppError constructor. */
export type ApiErrorDetailInput = ApiErrorDetail;

/**
 * Error taxonomy (spec 01 §Error taxonomy).
 *
 * Later specs reference these classes by name rather than hand-writing status
 * codes. The centralized error handler is the only place that turns one of
 * these into an HTTP response.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly details?: ApiErrorDetail[];

  constructor(message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    if (details) {
      this.details = details;
    }
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = 'UNAUTHORIZED';
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = 'FORBIDDEN';
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = 'CONFLICT';
}

/** Used by the state-machine service (spec 12) for a rejected transition. */
export class InvalidTransitionError extends AppError {
  readonly status = 409;
  readonly code = 'INVALID_TRANSITION';
}

export class RateLimitError extends AppError {
  readonly status = 429;
  readonly code = 'RATE_LIMITED';
}

/** A failure in an external provider (courier, payment, risk, Meta). */
export class UpstreamError extends AppError {
  readonly status = 502;
  readonly code = 'UPSTREAM_ERROR';
}

export class InternalError extends AppError {
  readonly status = 500;
  readonly code = 'INTERNAL_ERROR';
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
