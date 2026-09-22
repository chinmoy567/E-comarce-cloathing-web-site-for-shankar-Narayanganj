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

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Declared here, consumed from spec 02 onward (withTransaction).
  // The pool cap is explicit because the pg pool and the Supabase client draw on
  // the same instance connection limit.
  DATABASE_URL: z.string().min(1, 'must not be empty'),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
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
