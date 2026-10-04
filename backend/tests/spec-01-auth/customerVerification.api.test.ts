import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';

/**
 * Verified account changes (02-customer §2.6, §2.9.8; spec 08): email-change confirmation, phone
 * change by password + email OTP, and the guest-to-registered claim.
 */
const SCHEMA = 'spec08_customer_verification';
const PASSWORD = 'VerifyPass12';

describe.skipIf(!TEST_DATABASE_URL)('customer verification flows (spec 08)', () => {
  let app: Express;
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let resetRateLimiterStore: typeof import('../../src/lib/rateLimiterStore.js').resetRateLimiterStore;
  const sent: Array<{ to: string; text: string }> = [];
  let seq = 0;

  const q = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await withTransaction((c) => c.query<T>(sql, params))).rows;
  const lastText = (): string => sent[sent.length - 1]!.text;
  const lastCode = (): string => /\b(\d{6})\b/.exec(lastText())![1]!;
  const lastToken = (): string => /token=([0-9a-f]{64})/.exec(lastText())![1]!;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_CUSTOMER_LOGIN_MAX = '10000';
    process.env.RL_REGISTRATION_MAX = '10000';
    process.env.RL_GUEST_LOOKUP_MAX = '10000';
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    ({ resetRateLimiterStore } = await import('../../src/lib/rateLimiterStore.js'));
    await resetTransactionPool();
    const email = await import('../../src/services/email/index.js');
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

  function nextPhone(): string {
    seq += 1;
    return `0179990${String(seq).padStart(4, '0')}`;
  }

  async function registeredAgent(phone = nextPhone()) {
    const reg = await request(app).post('/api/customer/auth/register').send({ phone_number: phone, password: PASSWORD });
    expect(reg.status).toBe(201);
    const agent = request.agent(app);
    expect((await agent.post('/api/customer/auth/login').send({ phone_number: phone, password: PASSWORD })).status).toBe(200);
    return { agent, phone };
  }

  /** A logged-in customer whose email is confirmed (the only phone-change channel). */
  async function verifiedAgent() {
    const { agent, phone } = await registeredAgent();
    const email = `verified${seq}@example.com`;
    await agent.patch('/api/customer/auth/profile').send({ full_name: 'Verified User', email });
    await request(app).post('/api/customer/auth/email-change/confirm').send({ token: lastToken() });
    sent.length = 0;
    return { agent, phone, email };
  }

  describe('email change (§2.6, acceptance 18)', () => {
    it('does not touch users.email or the recovery channel until the link is confirmed', async () => {
      const { agent, phone } = await registeredAgent();
      const email = `pending${seq}@example.com`;
      const res = await agent.patch('/api/customer/auth/profile').send({ full_name: 'Pending User', email });
      expect(res.status).toBe(200);
      expect(res.body.data.email_verified).toBe(false);
      expect(res.body.data.pending_email).toBe(email);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe(email);

      const [before] = await q<{ email: string | null; email_verified_at: Date | null }>(
        'SELECT email, email_verified_at FROM users WHERE phone_number = $1',
        [phone],
      );
      expect(before!.email).toBeNull();
      expect(before!.email_verified_at).toBeNull();

      // An unconfirmed address cannot receive a password-reset code.
      sent.length = 0;
      expect((await request(app).post('/api/customer/auth/request-otp').send({ email })).status).toBe(200);
      expect(sent).toHaveLength(0);
    });

    it('confirms once: the link sets the verified address, and cannot be reused', async () => {
      const { agent, phone } = await registeredAgent();
      const email = `confirm${seq}@example.com`;
      await agent.patch('/api/customer/auth/profile').send({ full_name: 'Confirm User', email });
      const token = lastToken();

      expect((await request(app).post('/api/customer/auth/email-change/confirm').send({ token })).status).toBe(200);
      const [after] = await q<{ email: string; email_verified_at: Date | null }>(
        'SELECT email, email_verified_at FROM users WHERE phone_number = $1',
        [phone],
      );
      expect(after!.email).toBe(email);
      expect(after!.email_verified_at).not.toBeNull();

      const again = await request(app).post('/api/customer/auth/email-change/confirm').send({ token });
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');

      const me = await agent.get('/api/customer/auth/me');
      expect(me.body.data.email_verified).toBe(true);
      expect(me.body.data.pending_email).toBeUndefined();
    });

    it('supersedes an earlier link and rejects an expired or unknown one', async () => {
      const { agent } = await registeredAgent();
      await agent.patch('/api/customer/auth/profile').send({ full_name: 'Link User', email: `first${seq}@example.com` });
      const first = lastToken();
      await agent.patch('/api/customer/auth/profile').send({ full_name: 'Link User', email: `second${seq}@example.com` });
      const second = lastToken();

      expect((await request(app).post('/api/customer/auth/email-change/confirm').send({ token: first })).status).toBe(400);
      await q(`UPDATE email_verification_tokens SET expires_at = now() - interval '1 minute'`);
      expect((await request(app).post('/api/customer/auth/email-change/confirm').send({ token: second })).status).toBe(400);
      expect(
        (await request(app).post('/api/customer/auth/email-change/confirm').send({ token: 'a'.repeat(64) })).status,
      ).toBe(400);
    });

    it('stores no raw token', async () => {
      const { agent } = await registeredAgent();
      await agent.patch('/api/customer/auth/profile').send({ full_name: 'Hash User', email: `hash${seq}@example.com` });
      const token = lastToken();
      const rows = await q<object>('SELECT * FROM email_verification_tokens');
      for (const row of rows) for (const v of Object.values(row)) expect(String(v)).not.toContain(token);
    });

    it('clearing the email removes the recovery channel', async () => {
      const { agent, email } = await verifiedAgent();
      const res = await agent.patch('/api/customer/auth/profile').send({ full_name: 'Verified User', email: null });
      expect(res.status).toBe(200);
      await request(app).post('/api/customer/auth/request-otp').send({ email });
      expect(sent).toHaveLength(0);
    });
  });

  describe('phone change (§2.6, acceptance 17)', () => {
    const request_ = (agent: ReturnType<typeof request.agent>, body: object) =>
      agent.post('/api/customer/auth/phone-change/request').send(body);

    it('moves users and customers to the new number after password + emailed OTP', async () => {
      const { agent, phone, email } = await verifiedAgent();
      const newPhone = nextPhone();

      const req = await request_(agent, { new_phone_number: newPhone, current_password: PASSWORD });
      expect(req.status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe(email);
      expect(lastText()).not.toContain(newPhone); // only a masked hint is emailed

      const done = await agent
        .post('/api/customer/auth/phone-change/confirm')
        .send({ otp_id: req.body.data.otp_id, otp_code: lastCode(), new_phone_number: newPhone });
      expect(done.status).toBe(200);
      expect(done.body.data.phone_number).toBe(newPhone);

      const [u] = await q<{ phone_number: string }>('SELECT phone_number FROM users WHERE email = $1', [email]);
      const [c] = await q<{ phone_number: string }>('SELECT phone_number FROM customers WHERE phone_number = $1', [newPhone]);
      expect(u!.phone_number).toBe(newPhone);
      expect(c).toBeDefined();
      expect((await q('SELECT 1 FROM customers WHERE phone_number = $1', [phone])).length).toBe(0);

      // History follows the record: logging in with the new number works, the old one does not.
      expect((await request(app).post('/api/customer/auth/login').send({ phone_number: newPhone, password: PASSWORD })).status).toBe(200);
      expect((await request(app).post('/api/customer/auth/login').send({ phone_number: phone, password: PASSWORD })).status).toBe(401);
    });

    it('requires the current password', async () => {
      const { agent } = await verifiedAgent();
      const res = await request_(agent, { new_phone_number: nextPhone(), current_password: 'WrongPassword99' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(sent).toHaveLength(0);
    });

    it('returns NO_VERIFICATION_CHANNEL without a confirmed email, even if an unconfirmed one is saved', async () => {
      const { agent } = await registeredAgent();
      const bare = await request_(agent, { new_phone_number: nextPhone(), current_password: PASSWORD });
      expect(bare.status).toBe(409);
      expect(bare.body.error.code).toBe('NO_VERIFICATION_CHANNEL');

      await agent.patch('/api/customer/auth/profile').send({ full_name: 'No Verify', email: `nv${seq}@example.com` });
      sent.length = 0;
      const unconfirmed = await request_(agent, { new_phone_number: nextPhone(), current_password: PASSWORD });
      expect(unconfirmed.body.error.code).toBe('NO_VERIFICATION_CHANNEL');
      expect(sent).toHaveLength(0);
    });

    it('rejects a number already on any customer row, including a guest record (PHONE_IN_USE)', async () => {
      const { agent } = await verifiedAgent();
      const taken = nextPhone();
      await q(
        `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
         VALUES ('GUEST','Guest',$1,'Dhaka','Dhaka','THANA','Gulshan','WARD','5','House 1')`,
        [taken],
      );
      const res = await request_(agent, { new_phone_number: taken, current_password: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHONE_IN_USE');
    });

    it('rejects a wrong code, and a code used for a different number', async () => {
      const { agent } = await verifiedAgent();
      const newPhone = nextPhone();
      const otherPhone = nextPhone();
      const req = await request_(agent, { new_phone_number: newPhone, current_password: PASSWORD });
      const code = lastCode();
      const wrong = code === '000000' ? '111111' : '000000';

      const bad = await agent
        .post('/api/customer/auth/phone-change/confirm')
        .send({ otp_id: req.body.data.otp_id, otp_code: wrong, new_phone_number: newPhone });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');

      const mismatch = await agent
        .post('/api/customer/auth/phone-change/confirm')
        .send({ otp_id: req.body.data.otp_id, otp_code: code, new_phone_number: otherPhone });
      expect(mismatch.status).toBe(400);
    });

    it("does not accept another customer's code", async () => {
      const a = await verifiedAgent();
      const b = await verifiedAgent();
      const newPhone = nextPhone();
      const req = await request_(a.agent, { new_phone_number: newPhone, current_password: PASSWORD });
      const code = lastCode();
      const res = await b.agent
        .post('/api/customer/auth/phone-change/confirm')
        .send({ otp_id: req.body.data.otp_id, otp_code: code, new_phone_number: newPhone });
      expect(res.status).toBe(400);
    });

    it('requires a customer session', async () => {
      const res = await request(app)
        .post('/api/customer/auth/phone-change/request')
        .send({ new_phone_number: nextPhone(), current_password: PASSWORD });
      expect(res.status).toBe(401);
    });
  });

  describe('guest claim (§2.9.8, acceptance 19-20)', () => {
    async function guestWithOrder(phone: string): Promise<{ customerId: string; orderNumber: string }> {
      const [c] = await q<{ id: string }>(
        `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
         VALUES ('GUEST','Guest Buyer',$1,'Dhaka','Dhaka','THANA','Gulshan','WARD','5','House 1') RETURNING id`,
        [phone],
      );
      const orderNumber = `FB-CLAIM-${phone.slice(-4)}`;
      await q(
        `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, discount_amount, eligible_subtotal, total_amount,
                            full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
         VALUES ($1,$2,'COD','PENDING_CONFIRMATION','PENDING_COLLECTION',600,60,0,600,660,'Guest Buyer',$3,'Dhaka','Dhaka','THANA','Gulshan','WARD','5','House 1')`,
        [orderNumber, c!.id, phone],
      );
      return { customerId: c!.id, orderNumber };
    }

    const claim = (body: object) => request(app).post('/api/customer/auth/claim-guest').send(body);

    it('refuses plain registration over a guest record (GUEST_RECORD_EXISTS) and creates no account', async () => {
      const phone = nextPhone();
      await guestWithOrder(phone);
      const res = await request(app).post('/api/customer/auth/register').send({ phone_number: phone, password: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GUEST_RECORD_EXISTS');
      expect(await q('SELECT 1 FROM users WHERE phone_number = $1', [phone])).toHaveLength(0);
    });

    it('rejects registering a phone that is already registered', async () => {
      const { phone } = await registeredAgent();
      const res = await request(app).post('/api/customer/auth/register').send({ phone_number: phone, password: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
    });

    it('claims the existing record: same customer id, no second row, history preserved, session issued', async () => {
      const phone = nextPhone();
      const { customerId, orderNumber } = await guestWithOrder(phone);

      const res = await claim({ phone_number: phone, order_number: orderNumber, password: PASSWORD });
      expect(res.status).toBe(201);
      expect(res.headers['set-cookie']).toBeDefined();

      const [user] = await q<{ customer_id: string; role: string }>('SELECT customer_id, role FROM users WHERE phone_number = $1', [phone]);
      expect(user).toMatchObject({ customer_id: customerId, role: 'CUSTOMER' });
      const customers = await q<{ account_type: string }>('SELECT account_type FROM customers WHERE phone_number = $1', [phone]);
      expect(customers).toEqual([{ account_type: 'REGISTERED' }]);
      const orders = await q('SELECT 1 FROM orders WHERE customer_id = $1', [customerId]);
      expect(orders).toHaveLength(1);
    });

    it('fails identically without the matching order number, and for an unknown phone', async () => {
      const phone = nextPhone();
      const { orderNumber } = await guestWithOrder(phone);
      const other = nextPhone();
      const { orderNumber: otherOrder } = await guestWithOrder(other);

      const wrongOrder = await claim({ phone_number: phone, order_number: otherOrder, password: PASSWORD });
      const unknownOrder = await claim({ phone_number: phone, order_number: 'FB-NOPE-0000', password: PASSWORD });
      const unknownPhone = await claim({ phone_number: nextPhone(), order_number: orderNumber, password: PASSWORD });
      for (const res of [wrongOrder, unknownOrder, unknownPhone]) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('CLAIM_NOT_VERIFIED');
      }
      expect(await q('SELECT 1 FROM users WHERE phone_number = $1', [phone])).toHaveLength(0);
      expect(await q('SELECT 1 FROM customers WHERE phone_number = $1 AND account_type = $2', [phone, 'GUEST'])).toHaveLength(1);
    });

    it('cannot be used to take over an already-registered account', async () => {
      const { phone } = await registeredAgent();
      const res = await claim({ phone_number: phone, order_number: 'FB-ANY-0001', password: 'AttackerPass99' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CLAIM_NOT_VERIFIED');
    });

    it('is throttled per order number (429)', async () => {
      process.env.RL_GUEST_LOOKUP_MAX = '3';
      resetEnvCache();
      resetRateLimiterStore();
      try {
        const phone = nextPhone();
        const statuses = [];
        for (let i = 0; i < 4; i += 1) {
          statuses.push((await claim({ phone_number: phone, order_number: 'FB-GUESS-0001', password: PASSWORD })).status);
        }
        expect(statuses).toEqual([400, 400, 400, 429]);
      } finally {
        process.env.RL_GUEST_LOOKUP_MAX = '10000';
        resetEnvCache();
        resetRateLimiterStore();
      }
    });
  });
});
