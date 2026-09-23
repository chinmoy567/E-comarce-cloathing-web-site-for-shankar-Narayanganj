import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Spec 04 — rate limiting over real HTTP + a real database (§11.2, §11.3;
 * tests required 1-8; acceptance 1-9, 17).
 *
 * A mock limiter store or a mocked audit repository would assert nothing:
 * the composite identifier+IP keying, the non-enumerating 429 body, the
 * `Retry-After` header, and the hashed rejection audit row are the actual
 * claims under test, and they only exist as the real `rateLimit()` middleware
 * composed with a real Postgres-backed `audit_logs` table.
 *
 * Every test overrides the relevant `RL_*` env var to a small, test-only
 * threshold, calls `resetEnvCache()` + `resetRateLimiterStore()`, and rebuilds
 * the app — never a real-time wait.
 */
const SCHEMA = 'spec04_rate_limit';

describe.skipIf(!TEST_DATABASE_URL)('rate limiting (spec 04)', () => {
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let resetRateLimiterStore: typeof import('../../src/lib/rateLimiterStore.js').resetRateLimiterStore;
  let createApp: typeof import('../../src/app.js').createApp;
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;
  let users: typeof import('../../src/repositories/users.repository.js');
  let sha256Hex: typeof import('../../src/lib/hash.js').sha256Hex;

  const PASSWORD = 'RateLimitPass12';
  let adminId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    ({ resetRateLimiterStore } = await import('../../src/lib/rateLimiterStore.js'));
    ({ createApp } = await import('../../src/app.js'));
    ({ hashPassword } = await import('../../src/lib/password.js'));
    users = await import('../../src/repositories/users.repository.js');
    ({ sha256Hex } = await import('../../src/lib/hash.js'));

    const passwordHash = await hashPassword(PASSWORD);
    const admin = await users.create({
      role: 'ADMIN',
      userIdentifier: 'rl-admin',
      passwordHash,
      mustChangePassword: false,
    });
    adminId = admin.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  /** Rebuilds the app with the given RL_* overrides applied, on a clean limiter store. */
  function buildAppWith(overrides: Record<string, string>): Express {
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    for (const [key, value] of Object.entries(overrides)) {
      process.env[key] = value;
    }
    resetEnvCache();
    resetRateLimiterStore();
    return createApp();
  }

  async function countRows(table: string): Promise<number> {
    return withTransaction(async (c) => {
      const { rows } = await c.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
      return Number(rows[0]!.count);
    });
  }

  async function clearAuditLogs(): Promise<void> {
    await withTransaction(async (c) => {
      await c.query('DELETE FROM audit_logs');
    });
  }

  afterEach(async () => {
    await clearAuditLogs();
  });

  describe('adminLogin (test 1, acceptance 1, 2)', () => {
    it('the Nth failed attempt (at the limit) still gets a real auth response, not 429', async () => {
      const app = buildAppWith({ RL_ADMIN_LOGIN_MAX: '3', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post('/api/admin/auth/login')
          .send({ userIdentifier: 'rl-admin', password: 'wrong-password-1' });
        expect(res.status).toBe(401);
        expect(res.body.error.code).not.toBe('RATE_LIMITED');
      }
    });

    it('the (N+1)th attempt for the same identifier returns 429 RATE_LIMITED with Retry-After (acceptance 1)', async () => {
      const app = buildAppWith({ RL_ADMIN_LOGIN_MAX: '3', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });
      for (let i = 0; i < 3; i++) {
        await request(app).post('/api/admin/auth/login').send({ userIdentifier: 'rl-admin-2', password: 'wrong-password-1' });
      }
      const res = await request(app).post('/api/admin/auth/login').send({ userIdentifier: 'rl-admin-2', password: 'wrong-password-1' });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.body.error.message).toBe('Too many requests. Please try again later.');
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  describe('non-enumeration on 429 (test 3)', () => {
    it('the 429 body is byte-identical for an existing vs. a non-existent identifier', async () => {
      const app = buildAppWith({ RL_ADMIN_LOGIN_MAX: '1', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });

      // Exhaust the budget for each identifier first (1 request each).
      await request(app).post('/api/admin/auth/login').set('X-Forwarded-For', '203.0.113.10').send({ userIdentifier: 'rl-admin', password: 'wrong' });
      await request(app).post('/api/admin/auth/login').set('X-Forwarded-For', '203.0.113.11').send({ userIdentifier: 'nonexistent-user', password: 'wrong' });

      const existing = await request(app)
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ userIdentifier: 'rl-admin', password: 'wrong' });
      const nonexistent = await request(app)
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', '203.0.113.11')
        .send({ userIdentifier: 'nonexistent-user', password: 'wrong' });

      expect(existing.status).toBe(429);
      expect(nonexistent.status).toBe(429);
      const { requestId: _a, ...existingBody } = existing.body;
      const { requestId: _b, ...nonexistentBody } = nonexistent.body;
      expect(existingBody).toEqual(nonexistentBody);
    });
  });

  describe('Retry-After consistency (test 4)', () => {
    it('Retry-After is numeric and no greater than the configured window, for a limiter with no lockout', async () => {
      // authenticatedCeiling has no lockoutSec, so Retry-After reflects the
      // plain window (unlike adminLogin, whose RL_ADMIN_LOGIN_LOCKOUT_MAX_SEC
      // deliberately dominates once the window is exhausted — see the next test).
      const windowSec = 20;
      const app = buildAppWith({
        RL_AUTH_CEILING_MAX: '1',
        RL_AUTH_CEILING_WINDOW_SEC: String(windowSec),
        RL_ADMIN_LOGIN_MAX: '10000',
      });
      const loginRes = await request(app).post('/api/admin/auth/login').send({ userIdentifier: 'rl-admin', password: PASSWORD });
      expect(loginRes.status).toBe(200);
      const cookies = (loginRes.headers['set-cookie'] as unknown as string[]).join('; ');

      await request(app).get('/api/admin/auth/me').set('Cookie', cookies);
      const res = await request(app).get('/api/admin/auth/me').set('Cookie', cookies);

      expect(res.status).toBe(429);
      const retryAfter = Number(res.headers['retry-after']);
      expect(Number.isFinite(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(windowSec);
    });

    it('for adminLogin, Retry-After reflects the configured lockout once the window is exhausted (§11.3 "exponential backoff", assumption 3)', async () => {
      const lockoutSec = 3600;
      const app = buildAppWith({
        RL_ADMIN_LOGIN_MAX: '1',
        RL_ADMIN_LOGIN_WINDOW_SEC: '20',
        RL_ADMIN_LOGIN_LOCKOUT_MAX_SEC: String(lockoutSec),
      });

      await request(app).post('/api/admin/auth/login').send({ userIdentifier: 'rl-retry-after-lockout', password: 'wrong' });
      const res = await request(app).post('/api/admin/auth/login').send({ userIdentifier: 'rl-retry-after-lockout', password: 'wrong' });

      expect(res.status).toBe(429);
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(lockoutSec);
    });
  });

  describe('composite keying (test 2, §11.2)', () => {
    it('identifier budget survives IP rotation', async () => {
      const app = buildAppWith({ RL_ADMIN_LOGIN_MAX: '2', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });
      const identifier = 'rl-rotate-ip';

      await request(app).post('/api/admin/auth/login').set('X-Forwarded-For', '198.51.100.1').send({ userIdentifier: identifier, password: 'wrong' });
      await request(app).post('/api/admin/auth/login').set('X-Forwarded-For', '198.51.100.2').send({ userIdentifier: identifier, password: 'wrong' });

      // Budget of 2 exhausted across two different IPs; the third request
      // from a THIRD fresh IP is still rejected because the identifier
      // counter (not the IP counter) is what's exhausted.
      const res = await request(app)
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', '198.51.100.3')
        .send({ userIdentifier: identifier, password: 'wrong' });

      expect(res.status).toBe(429);
    });

    it('IP budget bounds an attacker cycling identifiers', async () => {
      const app = buildAppWith({ RL_ADMIN_LOGIN_MAX: '2', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });
      const ip = '198.51.100.50';

      await request(app).post('/api/admin/auth/login').set('X-Forwarded-For', ip).send({ userIdentifier: 'rl-cycle-1', password: 'wrong' });
      await request(app).post('/api/admin/auth/login').set('X-Forwarded-For', ip).send({ userIdentifier: 'rl-cycle-2', password: 'wrong' });

      // A THIRD, never-before-seen identifier from the same IP is still
      // rejected because the IP counter (not the identifier counter) is exhausted.
      const res = await request(app)
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ userIdentifier: 'rl-cycle-3', password: 'wrong' });

      expect(res.status).toBe(429);
    });

    it('a second legitimate user behind the same IP is not locked out by the first user\'s per-identifier exhaustion', async () => {
      const app = buildAppWith({ RL_ADMIN_LOGIN_MAX: '5', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });
      const sharedIp = '198.51.100.77';

      // User A exhausts THEIR OWN identifier budget across several different
      // IPs (never sharedIp), so the shared IP's own counter stays untouched.
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/admin/auth/login')
          .set('X-Forwarded-For', `198.51.100.${i + 1}`)
          .send({ userIdentifier: 'rl-shared-a', password: 'wrong' });
      }
      // A's identifier is now exhausted, even from a brand-new IP (sharedIp).
      const aRejected = await request(app)
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', sharedIp)
        .send({ userIdentifier: 'rl-shared-a', password: 'wrong' });
      expect(aRejected.status).toBe(429);

      // User B, a distinct identifier, from the SAME shared IP that just
      // rejected A: B's own identifier budget is untouched, and the shared
      // IP's own counter has only been consumed once so far (by A's
      // rejected attempt above) — B is not locked out by A's exhaustion.
      const bResult = await request(app)
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', sharedIp)
        .send({ userIdentifier: 'rl-shared-b', password: 'wrong' });
      expect(bResult.status).not.toBe(429);
    });
  });

  describe('rejection logging (test 5, §11.2, §5.15 rule 10)', () => {
    it('a 429 appends one audit_logs row with limiter/endpoint/ip in new_value and a hashed identifier, visible via security_events', async () => {
      const app = buildAppWith({ RL_ADMIN_LOGIN_MAX: '1', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });
      const identifier = 'rl-logged-identifier';

      await request(app).post('/api/admin/auth/login').set('X-Forwarded-For', '203.0.113.20').send({ userIdentifier: identifier, password: 'wrong' });
      const res = await request(app)
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', '203.0.113.20')
        .send({ userIdentifier: identifier, password: 'wrong' });
      expect(res.status).toBe(429);

      const row = await withTransaction(async (c) => {
        const { rows } = await c.query(
          `SELECT action, actor_type, new_value FROM audit_logs WHERE action = 'rate_limit_rejected' ORDER BY created_at DESC LIMIT 1`,
        );
        return rows[0];
      });

      expect(row).toBeDefined();
      expect(row.actor_type).toBe('SYSTEM');
      expect(row.new_value.limiter).toBe('adminLogin');
      expect(row.new_value.endpoint).toBe('/api/admin/auth/login');
      expect(row.new_value.ip).toBeDefined();
      expect(row.new_value.identifierHash).toBeDefined();

      // The identifier is stored hashed, never in plaintext.
      expect(row.new_value.identifierHash).not.toBe(identifier);
      expect(JSON.stringify(row.new_value)).not.toContain(identifier);
      expect(row.new_value.identifierHash).toBe(sha256Hex(identifier));

      const securityEventsRow = await withTransaction(async (c) => {
        const { rows } = await c.query(
          `SELECT * FROM security_events WHERE action = 'rate_limit_rejected' ORDER BY created_at DESC LIMIT 1`,
        );
        return rows[0];
      });
      expect(securityEventsRow).toBeDefined();
      expect(securityEventsRow.new_value.identifierHash).toBe(sha256Hex(identifier));
    });
  });

  describe('env-configurability (test 6, acceptance 9)', () => {
    it('lowering RL_ADMIN_LOGIN_MAX changes the enforced threshold with no code change', async () => {
      const strict = buildAppWith({ RL_ADMIN_LOGIN_MAX: '1', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });
      await request(strict).post('/api/admin/auth/login').send({ userIdentifier: 'rl-env-strict', password: 'wrong' });
      const strictSecond = await request(strict).post('/api/admin/auth/login').send({ userIdentifier: 'rl-env-strict', password: 'wrong' });
      expect(strictSecond.status).toBe(429);

      const relaxed = buildAppWith({ RL_ADMIN_LOGIN_MAX: '5', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });
      await request(relaxed).post('/api/admin/auth/login').send({ userIdentifier: 'rl-env-relaxed', password: 'wrong' });
      const relaxedSecond = await request(relaxed).post('/api/admin/auth/login').send({ userIdentifier: 'rl-env-relaxed', password: 'wrong' });
      expect(relaxedSecond.status).not.toBe(429);
    });
  });

  describe('no partial write on rejection (test 8, acceptance 17)', () => {
    it("a 429'd admin login — even with the CORRECT password — leaves no new refresh_tokens row, because the 429 fires before the route handler runs", async () => {
      const app = buildAppWith({ RL_ADMIN_LOGIN_MAX: '1', RL_ADMIN_LOGIN_WINDOW_SEC: '900' });
      const before = await countRows('refresh_tokens');

      // Consume the single-request budget with a WRONG password first (no row
      // written either way), so the budget is exhausted without itself
      // creating a session, isolating what the 429'd request alone does.
      const priming = await request(app).post('/api/admin/auth/login').send({ userIdentifier: 'rl-admin', password: 'wrong-password-1' });
      expect(priming.status).toBe(401);

      // The next request uses the CORRECT password — if the limiter ran
      // after the handler, this would create a session. It must not: the
      // rejection happens before the handler runs at all (spec 04 §Data
      // integrity/idempotency).
      const rejected = await request(app).post('/api/admin/auth/login').send({ userIdentifier: 'rl-admin', password: PASSWORD });
      expect(rejected.status).toBe(429);

      const after = await countRows('refresh_tokens');
      expect(after).toBe(before);
    });
  });

  describe('authenticatedCeiling (test 1, acceptance 7)', () => {
    it('under the limit succeeds; the (N+1)th authenticated request in the window is 429', async () => {
      const app = buildAppWith({ RL_AUTH_CEILING_MAX: '3', RL_AUTH_CEILING_WINDOW_SEC: '60', RL_ADMIN_LOGIN_MAX: '10000' });
      const loginRes = await request(app).post('/api/admin/auth/login').send({ userIdentifier: 'rl-admin', password: PASSWORD });
      expect(loginRes.status).toBe(200);
      const cookies = (loginRes.headers['set-cookie'] as unknown as string[]).join('; ');

      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/api/admin/auth/me').set('Cookie', cookies);
        expect(res.status).toBe(200);
      }
      const res = await request(app).get('/api/admin/auth/me').set('Cookie', cookies);
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });
  });

  describe('publicCeiling (test 1, acceptance 6)', () => {
    it('under the limit succeeds; over it returns 429, including on a path that matches no route', async () => {
      const app = buildAppWith({ RL_PUBLIC_CEILING_MAX: '3', RL_PUBLIC_CEILING_WINDOW_SEC: '60' });
      const ip = '203.0.113.99';

      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/api/does-not-exist').set('X-Forwarded-For', ip);
        expect(res.status).toBe(404);
      }
      const res = await request(app).get('/api/does-not-exist').set('X-Forwarded-For', ip);
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });
  });

  describe('Track Order vs guest lookup are independent limiters (test 7, §4.16)', () => {
    it('the registry defines two distinct RateLimiterNames with independent counter instances', async () => {
      const { buildRateLimiterRegistry } = await import('../../src/config/rateLimits.js');
      const { getLimiterInstance } = await import('../../src/lib/rateLimiterStore.js');
      resetRateLimiterStore();

      const registry = buildRateLimiterRegistry();
      expect(registry.guestOrderLookup.name).toBe('guestOrderLookup');
      expect(registry.trackOrder.name).toBe('trackOrder');
      expect(registry.guestOrderLookup.name).not.toBe(registry.trackOrder.name);

      const guestLimiter = getLimiterInstance(registry.guestOrderLookup, 'identifier');
      const trackLimiter = getLimiterInstance(registry.trackOrder, 'identifier');
      expect(guestLimiter).not.toBe(trackLimiter);

      // Exhaust guestOrderLookup for a shared identifier; trackOrder must be unaffected.
      const key = 'ORD-2026-000001';
      for (let i = 0; i < registry.guestOrderLookup.max; i++) {
        await guestLimiter.consume(key);
      }
      await expect(guestLimiter.consume(key)).rejects.toBeDefined();
      // trackOrder's independent counter for the SAME key still has budget.
      await expect(trackLimiter.consume(key)).resolves.toBeDefined();
    });
  });
});
