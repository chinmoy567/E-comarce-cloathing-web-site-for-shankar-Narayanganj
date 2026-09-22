import type { NextFunction, Request, Response } from 'express';
import { GENERIC_ERROR_MESSAGE } from '../config/constants.js';
import { isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { ApiError } from '../types/api.js';

/** Express' body-parser marks an oversized payload with this type. */
const PAYLOAD_TOO_LARGE = 'entity.too.large';

type BodyParserError = Error & { type?: string; status?: number; statusCode?: number };

/**
 * The centralized error handler — the ONLY place in the system that writes an
 * error response (spec 01 §Error taxonomy).
 *
 * It logs the full error server-side with the request id, and returns only
 * `code`, `message` and field-level `details` to the client. An unrecognized
 * thrown value becomes INTERNAL_ERROR with a generic message; the original
 * message is never forwarded to the client, so stack traces, SQL text, Supabase
 * payloads and env values cannot leak (security skill: error hygiene).
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = req.requestId ?? 'unknown';

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = GENERIC_ERROR_MESSAGE;
  let details: ApiError['error']['details'];

  if (isAppError(err)) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (isPayloadTooLarge(err)) {
    // Body exceeded JSON_BODY_LIMIT (11-security-hardening §11.4).
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request body is too large.';
  }

  // Full detail goes to the log only, never to the response.
  const logPayload = { requestId, status, code, err };
  if (status >= 500) {
    logger.error(logPayload, 'Request failed');
  } else {
    logger.warn(logPayload, 'Request rejected');
  }

  const body: ApiError = {
    error: details ? { code, message, details } : { code, message },
    requestId,
  };

  res.status(status).json(body);
}

function isPayloadTooLarge(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const candidate = err as BodyParserError;
  return candidate.type === PAYLOAD_TOO_LARGE || candidate.status === 413 || candidate.statusCode === 413;
}
