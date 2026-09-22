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
} as const;

export function applyTestEnv(): void {
  for (const [key, value] of Object.entries(VALID_ENV)) {
    process.env[key] = value;
  }
}
