import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { CSRF_HEADER, JSON_BODY_LIMIT } from './config/constants.js';
import { getEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { httpsRedirect } from './middleware/httpsRedirect.js';
import { notFound } from './middleware/notFound.js';
import { rateLimit } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { requestTimeout } from './middleware/requestTimeout.js';
import routes from './routes/index.js';
import { ForbiddenError } from './lib/errors.js';

/**
 * Builds the Express app. Exported separately from `server.ts` so tests can
 * mount it without binding a port.
 *
 * Middleware order (spec 04 §Mounting in this slice):
 *   requestId -> httpsRedirect -> helmet -> cors -> timeout
 *     -> json limit -> cookies -> logger -> publicCeiling -> routes
 *     -> notFound -> errorHandler
 */
export function createApp(): Express {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  // Required for correct client IPs behind a proxy; spec 04's limiters key on
  // this via req.ip. TRUST_PROXY_HOPS is the number of trusted reverse-proxy
  // hops in front of this process (§11.2 — never trust a raw client header).
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(requestId);
  app.use(httpsRedirect);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // HSTS is only meaningful over HTTPS, i.e. in production (§11.5).
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(cors(buildCorsOptions(env.corsAllowedOrigins)));

  app.use(requestTimeout);

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // Unsigned parse only — the access/refresh/CSRF cookies are verified by
  // `requireAuth` (JWT signature, DB hash lookup, double-submit compare), not
  // by cookie-parser's own signing (spec 03 §Session design).
  app.use(cookieParser());

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      // 4xx/5xx detail is emitted by errorHandler; keep the access log quiet.
      autoLogging: { ignore: () => env.NODE_ENV === 'test' },
    }),
  );

  // General public per-IP ceiling (§11.3), mounted before routing so it also
  // bounds unmatched paths — the baseline DoS backstop (§11.4). Named
  // limiters for specific routes (adminLogin, authenticatedCeiling, ...) are
  // mounted on those routes themselves, inside routes/.
  app.use(rateLimit('publicCeiling'));

  app.use('/api', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/**
 * CORS is an explicit allowlist (§11.5). The wildcard origin is never used and
 * credentials are only allowed for allowlisted origins.
 */
function buildCorsOptions(allowedOrigins: string[]): CorsOptions {
  return {
    origin(origin, callback) {
      // Same-origin/server-to-server requests send no Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new ForbiddenError('Origin is not allowed.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', CSRF_HEADER],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  };
}
