import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../config/constants.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id for this request; echoed in the X-Request-Id header. */
      requestId: string;
    }
  }
}

/**
 * Assigns a request id and echoes it as a response header.
 *
 * Every error response body carries the same value, so a client-reported
 * failure can be located in the server log without exposing internals.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  next();
}
