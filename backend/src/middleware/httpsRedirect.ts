import type { NextFunction, Request, Response } from 'express';
import { getEnv } from '../config/env.js';

/**
 * Redirects `http` to `https` in production only (spec 04 §11.5). A no-op in
 * development/test, where local tooling talks plain HTTP.
 *
 * Relies on the deployment's reverse proxy/CDN setting `X-Forwarded-Proto`,
 * the standard signal for "the original client request was HTTPS" when TLS is
 * terminated upstream of this process.
 */
export function httpsRedirect(req: Request, res: Response, next: NextFunction): void {
  const env = getEnv();
  if (env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const forwardedProto = req.get('X-Forwarded-Proto');
  if (forwardedProto && forwardedProto !== 'https') {
    res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
    return;
  }

  next();
}
