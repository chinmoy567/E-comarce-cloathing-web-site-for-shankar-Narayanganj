/** Minimal valid environment for tests that build the app. */
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
} as const;

export function applyTestEnv(): void {
  for (const [key, value] of Object.entries(VALID_ENV)) {
    process.env[key] = value;
  }
}
