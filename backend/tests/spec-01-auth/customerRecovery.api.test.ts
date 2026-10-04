import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';

/**
 * Customer password recovery (02-customer §2.5, spec 08) and customer refresh sessions
 * (02-customer §2.4, 11-security §11.7), end to end over HTTP against a real schema.
 */
const SCHEMA = 'spec08_customer_recovery';
const PASSWORD = 'OriginalPass12';
const NEW_PASSWORD = 'BrandNewPass34';

describe.skipIf(!TEST_DATABASE_URL)('customer recovery + sessions (spec 08)', () => {
  let app: Express;
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let resetRateLimiterStore: typeof import('../../src/lib/rateLimiterStore.js').resetRateLimiterStore;
  let recovery: typeof import('../../src/services/customerPasswordRecovery.service.js');
  const sent: Array<{ to: string; text: string }> = [];
  let seq = 0;

  const lastCode = (): string => /\b(\d{6})\b/.exec(sent[sent.length - 1]!.text)![1]!;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_CUSTOMER_LOGIN_MAX = '10000';
    process.env.RL_REGISTRATION_MAX = '10000';
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    ({ resetRateLimiterStore } = await import('../../src/lib/rateLimiterStore.js'));
    await resetTransactionPool();
    recovery = await import('../../src/services/customerPasswordRecovery.service.js');
    const email = await import('../../src/services/email/index.js');
    // Never touch real SMTP, even though backend/.env may hold credentials.
    email.setEmailSenderForTests({
      async send(message) {
        sent.push({ to: message.to, text: message.text });
      },
    });
    const { createApp } = await import('../../src/app.js');
    app = createApp();
  }, 60_000);

  afterAll(async () => {
    const email = await import('../../src/services/email/index.js');
    email.setEmailSenderForTests(null);
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(() => {
    sent.length = 0;
    resetRateLimiterStore();
  });

  /** Registers a customer with an email on file; returns the identifiers. */
  async function customerWithEmail(): Promise<{ phone: string; email: string; userId: string }> {
    seq += 1;
    const phone = `0178880${String(seq).padStart(4, '0')}`;
    const email = `recover${seq}@example.com`;
    const reg = await request(app).post('/api/customer/auth/register').send({ phone_number: phone, password: PASSWORD });
    expect(reg.status).toBe(201);
    const agent = request.agent(app);
    await agent.post('/api/customer/auth/login').send({ phone_number: phone, password: PASSWORD });
    const patch = await agent.patch('/api/customer/auth/profile').send({ full_name: 'Recover Tester', email });
    expect(patch.status).toBe(200);
    // The address only becomes a recovery destination once the emailed link is confirmed.
    const link = /token=([0-9a-f]{64})/.exec(sent[sent.length - 1]!.text);
    expect(link).not.toBeNull();
    expect((await request(app).post('/api/customer/auth/email-change/confirm').send({ token: link![1] })).status).toBe(200);
    sent.length = 0;
    const { rows } = await withTransaction((c) => c.query<{ id: string }>('SELECT id FROM users WHERE phone_number = $1', [phone]));
    return { phone, email, userId: rows[0]!.id };
  }

  const requestOtp = (email: string) => request(app).post('/api/customer/auth/request-otp').send({ email });
  const verifyOtp = (otpId: string, code: string) =>
    request(app).post('/api/customer/auth/verify-otp').send({ otp_id: otpId, otp_code: code });
  const reset = (token: string, pw: string) =>
    request(app).post('/api/customer/auth/reset-password').send({ reset_token: token, new_password: pw });
  const login = (phone: string, pw: string) =>
    request(app).post('/api/customer/auth/login').send({ phone_number: phone, password: pw });

  describe('password recovery (§2.5)', () => {
    it('completes request → verify → reset, changes the password, and signs out other sessions', async () => {
      const { phone, email, userId } = await customerWithEmail();
      const rt = await withTransaction((c) =>
        c.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [userId]),
      );
      expect(rt.rowCount).toBeGreaterThan(0);

      const req = await requestOtp(email);
      expect(req.status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe(email);

      const ver = await verifyOtp(req.body.data.otp_id, lastCode());
      expect(ver.status).toBe(200);

      const done = await reset(ver.body.data.reset_token, NEW_PASSWORD);
      expect(done.status).toBe(200);

      expect((await login(phone, PASSWORD)).status).toBe(401);
      expect((await login(phone, NEW_PASSWORD)).status).toBe(200);

      // The pre-reset session's refresh token was revoked by the reset (the new login added one).
      const live = await withTransaction((c) =>
        c.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [userId]),
      );
      expect(live.rowCount).toBe(1);
    });

    it('answers identically for an unknown email and sends nothing', async () => {
      const { email } = await customerWithEmail();
      const known = await requestOtp(email);
      const unknown = await requestOtp('nobody-here@example.com');
      expect(unknown.status).toBe(known.status);
      expect(Object.keys(unknown.body.data).sort()).toEqual(Object.keys(known.body.data).sort());
      expect(unknown.body.data.message).toBe(known.body.data.message);
      expect(sent).toHaveLength(1); // only the real account got mail

      // A made-up otp_id can never verify.
      const ver = await verifyOtp(unknown.body.data.otp_id, '123456');
      expect(ver.status).toBe(400);
      expect(ver.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');
    });

    it('does not send recovery to an address that is not on a customer account', async () => {
      const res = await requestOtp('admin-like@example.com');
      expect(res.status).toBe(200);
      expect(sent).toHaveLength(0);
    });

    it('stores no plaintext code', async () => {
      const { email, userId } = await customerWithEmail();
      await requestOtp(email);
      const code = lastCode();
      const { rows } = await withTransaction((c) => c.query('SELECT * FROM one_time_codes WHERE user_id = $1', [userId]));
      expect(rows).toHaveLength(1);
      for (const value of Object.values(rows[0]!)) {
        expect(String(value)).not.toContain(code);
      }
    });

    it('accepts a code once: the second verify of the same code fails', async () => {
      const { email } = await customerWithEmail();
      const req = await requestOtp(email);
      const code = lastCode();
      expect((await verifyOtp(req.body.data.otp_id, code)).status).toBe(200);
      const again = await verifyOtp(req.body.data.otp_id, code);
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');
    });

    it('lets a reset grant be redeemed once', async () => {
      const { email } = await customerWithEmail();
      const req = await requestOtp(email);
      const ver = await verifyOtp(req.body.data.otp_id, lastCode());
      expect((await reset(ver.body.data.reset_token, NEW_PASSWORD)).status).toBe(200);
      const again = await reset(ver.body.data.reset_token, 'AnotherPass56');
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');
    });

    it('rejects a code after the 10-minute expiry', async () => {
      const { email, userId } = await customerWithEmail();
      const req = await requestOtp(email);
      await withTransaction((c) =>
        c.query(`UPDATE one_time_codes SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [userId]),
      );
      const ver = await verifyOtp(req.body.data.otp_id, lastCode());
      expect(ver.status).toBe(400);
      expect(ver.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');
    });

    it('invalidates a code after 5 wrong attempts, even for the correct code afterwards', async () => {
      const { email } = await customerWithEmail();
      const req = await requestOtp(email);
      const code = lastCode();
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i += 1) {
        resetRateLimiterStore(); // exercise the service cap, not the HTTP limiter
        expect((await verifyOtp(req.body.data.otp_id, wrong)).status).toBe(400);
      }
      resetRateLimiterStore();
      const ver = await verifyOtp(req.body.data.otp_id, code);
      expect(ver.status).toBe(400);
      expect(ver.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');
    });

    it('supersedes the earlier code when a new one is requested', async () => {
      const { email } = await customerWithEmail();
      const first = await requestOtp(email);
      const firstCode = lastCode();
      const second = await requestOtp(email);
      expect((await verifyOtp(first.body.data.otp_id, firstCode)).status).toBe(400);
      expect((await verifyOtp(second.body.data.otp_id, lastCode())).status).toBe(200);
    });

    it('issues nothing past 3 requests per account in the window, with the same response', async () => {
      const { email } = await customerWithEmail();
      const responses = [];
      for (let i = 0; i < 4; i += 1) {
        responses.push(await recovery.requestPasswordResetOtp(email));
      }
      expect(sent).toHaveLength(3);
      expect(responses[3]!.otpId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('throttles OTP requests over HTTP per email (429)', async () => {
      const { email } = await customerWithEmail();
      const statuses = [];
      for (let i = 0; i < 4; i += 1) statuses.push((await requestOtp(email)).status);
      expect(statuses).toEqual([200, 200, 200, 429]);
    });

    it('does not let one account exhaust the request budget of another', async () => {
      const a = await customerWithEmail();
      const b = await customerWithEmail();
      for (let i = 0; i < 4; i += 1) await recovery.requestPasswordResetOtp(a.email);
      expect(sent).toHaveLength(3);
      await recovery.requestPasswordResetOtp(b.email);
      expect(sent).toHaveLength(4);
      expect(sent[3]!.to).toBe(b.email);
    });

    it('rejects an access token or garbage as a reset grant', async () => {
      const res = await reset('not-a-real-token', NEW_PASSWORD);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');
    });
  });

  describe('customer refresh sessions (§2.4, §11.7)', () => {
    function cookieValue(res: request.Response, name: string): string {
      const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));
      return raw!.split(';')[0]!.slice(name.length + 1);
    }

    it('persists a hashed customer-scope refresh token at login', async () => {
      const { phone, userId } = await customerWithEmail();
      const res = await login(phone, PASSWORD);
      const raw = cookieValue(res, 'customer_rt');
      const { rows } = await withTransaction((c) =>
        c.query('SELECT token_hash, scope FROM refresh_tokens WHERE user_id = $1', [userId]),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.scope === 'customer')).toBe(true);
      expect(rows.some((r) => r.token_hash === raw)).toBe(false); // never stored raw
    });

    it('rotates on refresh and detects reuse of the old token', async () => {
      const { phone, userId } = await customerWithEmail();
      const res = await login(phone, PASSWORD);
      const oldRt = cookieValue(res, 'customer_rt');

      const refreshed = await request(app).post('/api/customer/auth/refresh').set('Cookie', `customer_rt=${oldRt}`);
      expect(refreshed.status).toBe(200);
      const newRt = cookieValue(refreshed, 'customer_rt');
      expect(newRt).not.toBe(oldRt);
      expect(cookieValue(refreshed, 'customer_at')).toBeTruthy();

      // The old token is spent; presenting it again revokes the whole chain.
      const replay = await request(app).post('/api/customer/auth/refresh').set('Cookie', `customer_rt=${oldRt}`);
      expect(replay.status).toBe(401);
      const live = await withTransaction((c) =>
        c.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [userId]),
      );
      expect(live.rowCount).toBe(0);
      const after = await request(app).post('/api/customer/auth/refresh').set('Cookie', `customer_rt=${newRt}`);
      expect(after.status).toBe(401);
    });

    it('rejects refresh without a cookie or with an unknown token', async () => {
      expect((await request(app).post('/api/customer/auth/refresh')).status).toBe(401);
      const bogus = await request(app).post('/api/customer/auth/refresh').set('Cookie', 'customer_rt=deadbeef');
      expect(bogus.status).toBe(401);
    });

    it('does not accept an admin-scope refresh token', async () => {
      const { userId } = await customerWithEmail();
      const { generateRefreshToken, hashRefreshToken } = await import('../../src/lib/session.js');
      const raw = generateRefreshToken();
      await withTransaction((c) =>
        c.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, scope, expires_at)
           VALUES ($1, $2, 'admin', now() + interval '1 day')`,
          [userId, hashRefreshToken(raw)],
        ),
      );
      const res = await request(app).post('/api/customer/auth/refresh').set('Cookie', `customer_rt=${raw}`);
      expect(res.status).toBe(401);
    });

    it('revokes the refresh token on logout', async () => {
      const { phone } = await customerWithEmail();
      const agent = request.agent(app);
      const res = await agent.post('/api/customer/auth/login').send({ phone_number: phone, password: PASSWORD });
      const rt = cookieValue(res, 'customer_rt');
      expect((await agent.post('/api/customer/auth/logout')).status).toBe(200);
      const after = await request(app).post('/api/customer/auth/refresh').set('Cookie', `customer_rt=${rt}`);
      expect(after.status).toBe(401);
    });
  });
});
