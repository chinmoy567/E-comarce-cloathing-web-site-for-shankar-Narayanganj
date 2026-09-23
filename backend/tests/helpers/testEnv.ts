/**
 * Minimal valid environment for tests that build the app.
 *
 * Rate-limit ceilings are set far above what any test suite's own login/API
 * churn could hit, so `rateLimit` runs as real middleware (not mocked) without
 * every unrelated test suite tripping spec 04's limiters incidentally. A test
 * that specifically exercises a limiter (spec 04's own suite) overrides the
 * relevant `RL_*`/`RATE_LIMIT_STORE` var for just that file via
 * `resetEnvCache()` + `process.env`, and calls `resetRateLimiterStore()` so
 * the new threshold takes effect on a clean counter.
 */
export const VALID_ENV = {
  NODE_ENV: 'test',
  PORT: '4000',
  LOG_LEVEL: 'fatal',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
  PG_POOL_MAX: '10',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://shop.example.com',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters-long',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters-long',
  ADMIN_ACCESS_TOKEN_TTL_MIN: '15',
  ADMIN_REFRESH_TOKEN_TTL_DAYS: '7',
  RL_ADMIN_LOGIN_MAX: '10000',
  RL_AUTH_CEILING_MAX: '10000',
  RL_PUBLIC_CEILING_MAX: '10000',
} as const;

export function applyTestEnv(): void {
  for (const [key, value] of Object.entries(VALID_ENV)) {
    process.env[key] = value;
  }
}
