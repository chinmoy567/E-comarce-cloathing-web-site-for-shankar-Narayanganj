import type { NextFunction, Request, Response } from 'express';
import { getEnv } from '../config/env.js';

/**
 * Aborts a request that runs past `REQUEST_TIMEOUT_MS` with `503`, and
 * releases the connection, rather than holding it open indefinitely
 * (spec 04 §11.4). The reverse-proxy-level timeout is a separate,
 * deployment-level control and stays out of scope here.
 */
export function requestTimeout(req: Request, res: Response, next: NextFunction): void {
  const env = getEnv();
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({
        error: { code: 'REQUEST_TIMEOUT', message: 'The request took too long to process.' },
        requestId: req.requestId,
      });
    }
    req.destroy();
  }, env.REQUEST_TIMEOUT_MS);
  timer.unref();

  res.once('finish', () => clearTimeout(timer));
  res.once('close', () => clearTimeout(timer));

  next();
}
