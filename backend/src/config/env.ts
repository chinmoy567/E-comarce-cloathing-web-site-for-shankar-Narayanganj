import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * Environment schema (spec 01 §Configuration).
 *
 * A missing or malformed required variable aborts the process with a message
 * naming the variable. The value is NEVER printed (11-security-hardening §11.9).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  SUPABASE_URL: z.string().url('must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'must not be empty'),

  // Comma-separated allowlist. Wildcard origin is never permitted (§11.5).
  CORS_ALLOWED_ORIGINS: z.string().min(1, 'must not be empty'),

  // Public storefront origin, used for absolute links in outbound email and
  // for the "store's own domain" cta_url check (13-homepage-cms 13.13).
  PUBLIC_SITE_URL: z.string().url('must be a valid URL').default('https://fabrillke.com'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Declared here, consumed from spec 02 onward (withTransaction).
  // The pool cap is explicit because the pg pool and the Supabase client draw on
  // the same instance connection limit.
  DATABASE_URL: z.string().min(1, 'must not be empty'),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Spec 03 §Session design. Both secrets sign different token kinds and must
  // never be interchangeable, so they are two variables, not one reused value.
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ADMIN_ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  ADMIN_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // Spec 04 §11.2/§11.3 — rate-limit store and per-limiter thresholds. Every
  // threshold is env-driven so it can be tuned post-launch with no code edit.
  RATE_LIMIT_STORE: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().min(1).optional(),
  // Number of trusted reverse-proxy hops in front of the app; determines how
  // many entries of X-Forwarded-For are trusted for the limiter's IP key
  // (11-security-hardening §11.4/§11.2 — never trust a spoofable header alone).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  RL_CUSTOMER_LOGIN_MAX: z.coerce.number().int().positive().default(5),
  RL_CUSTOMER_LOGIN_WINDOW_SEC: z.coerce.number().int().positive().default(900),

  RL_ADMIN_LOGIN_MAX: z.coerce.number().int().positive().default(5),
  RL_ADMIN_LOGIN_WINDOW_SEC: z.coerce.number().int().positive().default(900),
  RL_ADMIN_LOGIN_LOCKOUT_MAX_SEC: z.coerce.number().int().positive().default(3600),

  RL_OTP_REQUEST_MAX: z.coerce.number().int().positive().default(3),
  RL_OTP_REQUEST_WINDOW_SEC: z.coerce.number().int().positive().default(900),

  RL_OTP_VERIFY_MAX: z.coerce.number().int().positive().default(5),

  RL_REGISTRATION_MAX: z.coerce.number().int().positive().default(5),
  RL_REGISTRATION_WINDOW_SEC: z.coerce.number().int().positive().default(3600),

  RL_GUEST_LOOKUP_MAX: z.coerce.number().int().positive().default(5),
  RL_GUEST_LOOKUP_WINDOW_SEC: z.coerce.number().int().positive().default(900),
  RL_GUEST_LOOKUP_LOCKOUT_SEC: z.coerce.number().int().positive().default(1800),

  RL_TRACK_ORDER_MAX: z.coerce.number().int().positive().default(10),
  RL_TRACK_ORDER_WINDOW_SEC: z.coerce.number().int().positive().default(900),

  RL_COUPON_VALIDATE_MAX: z.coerce.number().int().positive().default(10),
  RL_COUPON_VALIDATE_WINDOW_SEC: z.coerce.number().int().positive().default(600),

  RL_RISK_CHECK_MAX: z.coerce.number().int().positive().default(3),
  RL_RISK_CHECK_WINDOW_SEC: z.coerce.number().int().positive().default(900),

  RL_AUTH_CEILING_MAX: z.coerce.number().int().positive().default(100),
  RL_AUTH_CEILING_WINDOW_SEC: z.coerce.number().int().positive().default(60),

  RL_PUBLIC_CEILING_MAX: z.coerce.number().int().positive().default(60),
  RL_PUBLIC_CEILING_WINDOW_SEC: z.coerce.number().int().positive().default(60),

  // Spec 08 §6.7 — Meta Pixel ID (public, required for Pixel to load) and
  // Conversions API access token (secret, backend-only, never in frontend env).
  // Both optional — platform runs fine unconfigured (records SKIPPED entries).
  META_PIXEL_ID: z.string().min(1).optional(),
  META_CAPI_ACCESS_TOKEN: z.string().min(1).optional(),
  META_GRAPH_API_VERSION: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema> & { corsAllowedOrigins: string[] };

/**
 * Parses and validates environment variables.
 *
 * Throws an Error naming only the offending variable names and the reason —
 * never the value of any variable.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration -> ${problems}`);
  }

  const corsAllowedOrigins = result.data.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (corsAllowedOrigins.length === 0) {
    throw new Error('Invalid environment configuration -> CORS_ALLOWED_ORIGINS: must list at least one origin');
  }

  if (corsAllowedOrigins.includes('*')) {
    throw new Error('Invalid environment configuration -> CORS_ALLOWED_ORIGINS: wildcard origin is not permitted');
  }

  return { ...result.data, corsAllowedOrigins };
}

let cached: Env | undefined;

/** The validated environment. Parsed once, on first access. */
export function getEnv(): Env {
  if (!cached) {
    cached = parseEnv();
  }
  return cached;
}

/** Test seam: clears the memoized environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
