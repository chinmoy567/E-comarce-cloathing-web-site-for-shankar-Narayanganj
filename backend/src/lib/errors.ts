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
  readonly code: string;
  readonly details?: ApiErrorDetail[];

  constructor(message: string, details?: ApiErrorDetail[], code?: string) {
    super(message);
    this.name = new.target.name;
    this.code = code ?? (new.target as typeof AppError).defaultCode;
    if (details) {
      this.details = details;
    }
    Error.captureStackTrace?.(this, new.target);
  }

  /** Overridden by each subclass; used when the constructor's `code` param is omitted. */
  static readonly defaultCode: string = 'INTERNAL_ERROR';
}

/**
 * Every subclass accepts an optional 4th-argument-free `code` override as its 3rd
 * constructor param, so a call site that needs a more specific code than the
 * class default — e.g. `new ForbiddenError('...', undefined, 'CSRF_FAILED')` —
 * does not need a new class. Existing call sites passing 1–2 args are unaffected.
 */
export class ValidationError extends AppError {
  readonly status = 400;
  static override readonly defaultCode = 'VALIDATION_ERROR';
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  static override readonly defaultCode = 'UNAUTHORIZED';
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  static override readonly defaultCode = 'FORBIDDEN';
}

export class NotFoundError extends AppError {
  readonly status = 404;
  static override readonly defaultCode = 'NOT_FOUND';
}

export class ConflictError extends AppError {
  readonly status = 409;
  static override readonly defaultCode = 'CONFLICT';
}

/** Used by the state-machine service (spec 12) for a rejected transition. */
export class InvalidTransitionError extends AppError {
  readonly status = 409;
  static override readonly defaultCode = 'INVALID_TRANSITION';
}

export class RateLimitError extends AppError {
  readonly status = 429;
  static override readonly defaultCode = 'RATE_LIMITED';
}

/** A failure in an external provider (courier, payment, risk, Meta). */
export class UpstreamError extends AppError {
  readonly status = 502;
  static override readonly defaultCode = 'UPSTREAM_ERROR';
}

export class InternalError extends AppError {
  readonly status = 500;
  static override readonly defaultCode = 'INTERNAL_ERROR';
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
