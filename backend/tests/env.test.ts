import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { VALID_ENV } from './helpers/testEnv.js';

describe('environment validation (spec 01 acceptance 3)', () => {
  it('parses a complete environment', () => {
    const env = parseEnv({ ...VALID_ENV } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(4000);
    expect(env.PG_POOL_MAX).toBe(10);
    expect(env.corsAllowedOrigins).toEqual(['http://localhost:3000', 'https://shop.example.com']);
  });

  it('aborts when SUPABASE_SERVICE_ROLE_KEY is missing, naming the variable', () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = VALID_ENV;
    expect(() => parseEnv(rest as NodeJS.ProcessEnv)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('never prints the value of another secret in the failure message', () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = VALID_ENV;
    let message = '';
    try {
      parseEnv(rest as NodeJS.ProcessEnv);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toContain(VALID_ENV.DATABASE_URL);
    expect(message).not.toContain('postgres:postgres');
  });

  it('rejects a wildcard CORS origin', () => {
    expect(() => parseEnv({ ...VALID_ENV, CORS_ALLOWED_ORIGINS: '*' } as NodeJS.ProcessEnv)).toThrow(
      /wildcard/i,
    );
  });
});
