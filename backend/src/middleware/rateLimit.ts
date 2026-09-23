import type { NextFunction, Request, Response } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';
import * as auditRepository from '../repositories/audit.repository.js';
import { ADMIN_REFRESH_COOKIE } from '../config/constants.js';
import { buildRateLimiterRegistry, type IdentifierSource, type RateLimiterName } from '../config/rateLimits.js';
import { RateLimitError } from '../lib/errors.js';
import { sha256Hex } from '../lib/hash.js';
import { logger } from '../lib/logger.js';
import { normalizeBdPhone } from '../lib/phone.js';
import { getLimiterInstance } from '../lib/rateLimiterStore.js';

/**
 * Rate-limit middleware factory (spec 04 §11.2).
 *
 * `rateLimit(name)` looks up the named definition in the registry and
 * enforces it. Composite limiters (`identifier+ip`) maintain two independent
 * counters and reject if EITHER trips: an identifier-only counter (survives
 * IP rotation) and an IP-only counter (bounds a single source so a shared IP
 * doesn't lock out unrelated legitimate users). IP-only limiters
 * (`registration`, `publicCeiling`) maintain one counter.
 *
 * On rejection: 429, `Retry-After`, a body that never differentiates an
 * existing from a non-existent identifier, and one `audit_logs` row with the
 * identifier stored hashed (never in plaintext).
 */
export function rateLimit(name: RateLimiterName) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const registry = buildRateLimiterRegistry();
      const definition = registry[name];
      const ip = extractClientIp(req);
      const identifier = definition.keyStrategy === 'identifier+ip' ? extractIdentifier(req, definition.identifierSource) : undefined;

      const checks: Array<{ counterKind: 'identifier' | 'ip'; key: string }> = [];
      if (identifier !== undefined) {
        checks.push({ counterKind: 'identifier', key: identifier });
      }
      checks.push({ counterKind: 'ip', key: ip });

      for (const check of checks) {
        const limiter = getLimiterInstance(definition, check.counterKind);
        try {
          await limiter.consume(check.key);
        } catch (rejection) {
          if (!(rejection instanceof RateLimiterRes)) throw rejection;

          const retryAfterSec = Math.max(1, Math.ceil(rejection.msBeforeNext / 1000));
          await logRejection({ limiterName: name, identifier, ip, endpoint: req.originalUrl, requestId: req.requestId });

          res.setHeader('Retry-After', String(retryAfterSec));
          throw new RateLimitError('Too many requests. Please try again later.');
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Reads the identifier for a composite limiter from the request and
 * normalizes it so casing/formatting variants share one budget (§11.2).
 * Never throws on a malformed value — an attacker sending garbage still needs
 * to be rate-limited, not let through by a validation error thrown before the
 * limiter runs.
 */
function extractIdentifier(req: Request, source: IdentifierSource): string {
  const body = (req.body ?? {}) as Record<string, unknown>;

  switch (source) {
    case 'phone': {
      const raw = body.phoneNumber ?? body.phone;
      if (typeof raw !== 'string' || raw.length === 0) return 'unknown';
      try {
        return normalizeBdPhone(raw);
      } catch {
        return raw.trim().toLowerCase();
      }
    }
    case 'userIdentifier': {
      const raw = body.userIdentifier ?? body.identifier;
      return typeof raw === 'string' ? raw.trim().toLowerCase() : 'unknown';
    }
    case 'orderNumber': {
      const raw = body.orderNumber ?? body.trackingNumber;
      return typeof raw === 'string' ? raw.trim().toUpperCase() : 'unknown';
    }
    case 'actorId': {
      // `authenticatedCeiling` mounts on some routes (e.g. admin refresh)
      // that run before `requireAuth` populates `req.actor` — there the
      // refresh-session cookie stands in as the per-account identifier, so
      // requests aren't all collapsed into one shared "unknown" bucket.
      if (req.actor?.userId) return req.actor.userId;
      const cookies = req.cookies as Record<string, string> | undefined;
      const refreshCookie = cookies?.[ADMIN_REFRESH_COOKIE];
      return refreshCookie ? sha256Hex(refreshCookie) : 'unknown';
    }
    default:
      return 'unknown';
  }
}

/**
 * The client's source IP, honoring `TRUST_PROXY_HOPS` via Express's own
 * `trust proxy` setting (configured once in `app.ts`) — never a raw
 * `X-Forwarded-For` read, which a client can spoof (§11.2).
 */
function extractClientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

async function logRejection(params: {
  limiterName: string;
  identifier: string | undefined;
  ip: string;
  endpoint: string;
  requestId: string;
}): Promise<void> {
  try {
    await auditRepository.append({
      entityType: 'rate_limit',
      entityId: null,
      action: 'rate_limit_rejected',
      actorUserId: null,
      actorType: 'SYSTEM',
      requestId: params.requestId,
      newValue: {
        limiter: params.limiterName,
        endpoint: params.endpoint,
        ip: sha256Hex(params.ip),
        identifierHash: params.identifier ? sha256Hex(params.identifier) : null,
      },
    });
  } catch (err) {
    // Logging failure must never block or crash the rejection response itself.
    logger.error({ err, limiter: params.limiterName }, 'Failed to log rate-limit rejection');
  }
}
