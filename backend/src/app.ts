import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { JSON_BODY_LIMIT } from './config/constants.js';
import { getEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestId } from './middleware/requestId.js';
import routes from './routes/index.js';
import { ForbiddenError } from './lib/errors.js';

/**
 * Builds the Express app. Exported separately from `server.ts` so tests can
 * mount it without binding a port.
 *
 * Middleware order is fixed by spec 01 §Middleware order:
 *   requestId -> helmet -> cors -> json limit -> logger
 *     -> [rate limiters: spec 04] -> routes -> notFound -> errorHandler
 */
export function createApp(): Express {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  // Required for correct client IPs behind a proxy; spec 04's limiters key on this.
  app.set('trust proxy', 1);

  app.use(requestId);

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

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      // 4xx/5xx detail is emitted by errorHandler; keep the access log quiet.
      autoLogging: { ignore: () => env.NODE_ENV === 'test' },
    }),
  );

  // ---------------------------------------------------------------------------
  // Rate limiters mount point — reserved for spec 04.
  // Spec 04 mounts its limiter registry HERE, after body parsing and before
  // routes, so it does not have to restructure this file.
  // ---------------------------------------------------------------------------

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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  };
}
