import Redis from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { getEnv } from '../config/env.js';
import { logger } from './logger.js';
import type { RateLimiterDefinition } from '../config/rateLimits.js';

/**
 * Store selection for the rate-limiter registry (spec 04 §11.2, open
 * question 1).
 *
 * `memory` is the development default. A single Redis connection is shared by
 * every limiter instance in `redis` mode, since `rate-limiter-flexible`
 * multiplexes limiters over one client via `keyPrefix`. Booting with
 * `RATE_LIMIT_STORE=memory` in production logs an explicit warning — memory
 * counters do not survive a restart and are not shared across instances, so a
 * multi-instance production deployment would silently under-protect itself.
 */

let redisClient: Redis | undefined;
let warnedAboutMemoryInProduction = false;

function getRedisClient(): Redis {
  if (!redisClient) {
    const env = getEnv();
    if (!env.REDIS_URL) {
      throw new Error('RATE_LIMIT_STORE=redis requires REDIS_URL to be set.');
    }
    redisClient = new Redis(env.REDIS_URL);
  }
  return redisClient;
}

function warnIfMemoryInProduction(): void {
  const env = getEnv();
  if (env.NODE_ENV === 'production' && env.RATE_LIMIT_STORE === 'memory' && !warnedAboutMemoryInProduction) {
    warnedAboutMemoryInProduction = true;
    logger.warn(
      { rateLimitStore: env.RATE_LIMIT_STORE },
      'RATE_LIMIT_STORE=memory in production: rate-limit counters are per-instance and reset on restart. ' +
        'A multi-instance deployment must use RATE_LIMIT_STORE=redis or limits are not enforced consistently across instances.',
    );
  }
}

const limiterCache = new Map<string, RateLimiterAbstract>();

/**
 * Returns (and caches) the underlying `rate-limiter-flexible` limiter for one
 * cache key (a limiter name plus counter kind — 'identifier' or 'ip'). Two
 * limiters never share a keyPrefix, so an identifier counter and an IP
 * counter for the same named limiter cannot collide.
 */
export function getLimiterInstance(definition: RateLimiterDefinition, counterKind: 'identifier' | 'ip'): RateLimiterAbstract {
  warnIfMemoryInProduction();

  const cacheKey = `${definition.name}:${counterKind}:${definition.windowSec}:${definition.max}`;
  const cached = limiterCache.get(cacheKey);
  if (cached) return cached;

  const env = getEnv();
  const keyPrefix = `rl:${definition.name}:${counterKind}`;
  const blockDuration = definition.lockoutSec ?? 0;

  const limiter =
    env.RATE_LIMIT_STORE === 'redis'
      ? new RateLimiterRedis({
          storeClient: getRedisClient(),
          keyPrefix,
          points: definition.max,
          duration: definition.windowSec,
          blockDuration,
        })
      : new RateLimiterMemory({
          keyPrefix,
          points: definition.max,
          duration: definition.windowSec,
          blockDuration,
        });

  limiterCache.set(cacheKey, limiter);
  return limiter;
}

/** Test seam: drops cached limiter instances and the Redis connection so a new env takes effect. */
export function resetRateLimiterStore(): void {
  limiterCache.clear();
  warnedAboutMemoryInProduction = false;
  if (redisClient) {
    redisClient.disconnect();
    redisClient = undefined;
  }
}
