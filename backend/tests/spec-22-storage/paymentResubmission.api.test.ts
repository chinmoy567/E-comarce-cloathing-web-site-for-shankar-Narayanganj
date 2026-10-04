import type { Express } from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';
import { fakeStore as store } from '../helpers/fakeSupabaseStorage.ts';

/**
 * Resubmission after a rejected bKash payment (03-payment-order §3.4, 07-order-state-machine §5.21.2).
 * Real HTTP, middleware and database; only Supabase Storage is an in-memory fake.
 */
vi.mock('../../src/lib/supabase.ts', async () => (await import('../helpers/fakeSupabaseStorage.ts')).fakeSupabaseModule());

const SCHEMA = 'spec22_payment_resubmission_api';
const PW = 'ResubmitApiPass12';
const PHONE = '01711111111';

describe.skipIf(!TEST_DATABASE_URL)('payment resubmission', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let resetBucketCache: () => void;
  let customerId: string;

  async function newOrder(
    opts: { method?: 'BKASH' | 'COD'; paymentStatus?: string; orderStatus?: string; txn?: string | null } = {},
  ) {
    const method = opts.method ?? 'BKASH';
    const num = `RS${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const [o] = await q<{ id: string; order_number: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, total_amount,
                          full_name, phone_number, detailed_address, bkash_transaction_id)
       VALUES ($1,$2,$3,$4,$5,500,500,'Resubmit Tester',$6,'House 1',$7) RETURNING id, order_number`,
      [
        num,
        customerId,
        method,
        opts.orderStatus ?? (method === 'BKASH' ? 'PENDING_CONFIRMATION' : 'COD_VERIFICATION_PENDING'),
        opts.paymentStatus ?? (method === 'BKASH' ? 'REJECTED' : 'PENDING_COLLECTION'),
        PHONE,
        opts.txn === undefined ? `OLD${Math.random().toString(36).slice(2, 9).toUpperCase()}` : opts.txn,
      ],
    );
    return o!;
  }

  const row = async (id: string) => (await q(`SELECT payment_status, bkash_transaction_id, payment_proof_object_id FROM orders WHERE id=$1`, [id]))[0];
  const resubmit = (orderNumber: string, body: Record<string, unknown>) =>
    request(app).post(`/api/orders/${orderNumber}/payment-resubmission`).send(body);
  const upload = async (orderNumber: string) =>
    request(app)
      .post(`/api/orders/${orderNumber}/payment-proof`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Order-Phone', PHONE)
      .send(await sharp({ create: { width: 300, height: 200, channels: 3, background: '#33cc66' } }).jpeg().toBuffer());

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.RL_AUTHENTICATED_CEILING_MAX = '100000';
    process.env.RL_GUEST_LOOKUP_MAX = '100000';
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);

    ({ resetBucketCache } = await import('../../src/services/storage/imagePipeline.ts'));

    const { hashPassword } = await import('../../src/lib/password.js');
    const users = await import('../../src/repositories/users.repository.js');
    await users.create({ role: 'ADMIN', userIdentifier: 'rs-admin', passwordHash: await hashPassword(PW), mustChangePassword: false });

    const { createApp } = await import('../../src/app.js');
    app = createApp();

    [{ id: customerId }] = (await q(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('GUEST','Resubmit Customer','01711111111','Dhaka','Dhaka','THANA','Gulshan','WARD','Ward 2','House 2') RETURNING id`,
    )) as any;
  }, 90_000);

  beforeEach(() => {
    store.reset();
    resetBucketCache();
  });

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  describe('customer: new Transaction ID', () => {
    it('REJECTED -> PENDING_VERIFICATION, storing the new ID trimmed and upper-cased, with a history and audit trail', async () => {
      const order = await newOrder();
      const res = await resubmit(order.order_number, { phoneNumber: PHONE, bkashTransactionId: '  new9tx123  ' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ resubmitted: true });

      expect(await row(order.id)).toMatchObject({ payment_status: 'PENDING_VERIFICATION', bkash_transaction_id: 'NEW9TX123' });

      const history = await q(
        `SELECT previous_status, new_status, actor_type, reason FROM order_status_history WHERE order_id=$1 AND status_field='payment_status' ORDER BY created_at`,
        [order.id],
      );
      expect(history.at(-1)).toMatchObject({ previous_status: 'REJECTED', new_status: 'PENDING_VERIFICATION', actor_type: 'SYSTEM' });
      expect(await q(`SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='payment_status_change'`, [order.id])).toHaveLength(1);
    });

    it('answers a wrong phone and an unknown order identically', async () => {
      const order = await newOrder();
      const wrong = await resubmit(order.order_number, { phoneNumber: '01999999999', bkashTransactionId: 'NEWTX12345' });
      const unknown = await resubmit('NOSUCHORDER1', { phoneNumber: PHONE, bkashTransactionId: 'NEWTX12345' });
      expect(wrong.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
      expect((await row(order.id)).payment_status).toBe('REJECTED');
    });

    it('is refused unless a bKash order is REJECTED and not cancelled', async () => {
      const orders = [
        await newOrder({ paymentStatus: 'PENDING_VERIFICATION' }),
        await newOrder({ paymentStatus: 'PAID_VERIFIED' }),
        await newOrder({ method: 'COD' }),
        await newOrder({ orderStatus: 'CANCELLED' }),
      ];
      for (const o of orders) {
        const res = await resubmit(o.order_number, { phoneNumber: PHONE, bkashTransactionId: 'NEWTX12345' });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('PAYMENT_RESUBMISSION_NOT_ACCEPTED');
      }
    });

    it('refuses an ID already used by another order and leaves the rejected order untouched', async () => {
      const other = await newOrder({ paymentStatus: 'PENDING_VERIFICATION', txn: 'TAKEN12345' });
      const order = await newOrder({ txn: 'OLDTX00001' });
      const res = await resubmit(order.order_number, { phoneNumber: PHONE, bkashTransactionId: 'taken12345' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BKASH_TRANSACTION_ID_EXISTS');
      expect(await row(order.id)).toMatchObject({ payment_status: 'REJECTED', bkash_transaction_id: 'OLDTX00001' });
      expect(other.id).toBeTruthy();
    });

    it('lets only one of two concurrent resubmissions through', async () => {
      const order = await newOrder();
      const results = await Promise.all([
        resubmit(order.order_number, { phoneNumber: PHONE, bkashTransactionId: 'RACE1AAAA1' }),
        resubmit(order.order_number, { phoneNumber: PHONE, bkashTransactionId: 'RACE2BBBB2' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await row(order.id)).payment_status).toBe('PENDING_VERIFICATION');
    });

    it('validates strictly: a short ID, a missing phone and an unknown key are 400', async () => {
      const order = await newOrder();
      for (const body of [
        { phoneNumber: PHONE, bkashTransactionId: 'ab' },
        { bkashTransactionId: 'NEWTX12345' },
        { phoneNumber: PHONE, bkashTransactionId: 'NEWTX12345', paymentStatus: 'PAID_VERIFIED' },
      ]) {
        expect((await resubmit(order.order_number, body)).status).toBe(400);
      }
      expect((await row(order.id)).payment_status).toBe('REJECTED');
    });
  });

  describe('customer: screenshot on a rejected order', () => {
    it('stores the screenshot and resubmits the payment in one step, leaving the old ID in place', async () => {
      const order = await newOrder({ txn: 'KEEPME0001' });
      const res = await upload(order.order_number);
      expect(res.status).toBe(201);
      const after = await row(order.id);
      expect(after).toMatchObject({ payment_status: 'PENDING_VERIFICATION', bkash_transaction_id: 'KEEPME0001' });
      expect(after.payment_proof_object_id).not.toBeNull();
      const history = await q(
        `SELECT new_status FROM order_status_history WHERE order_id=$1 AND status_field='payment_status' ORDER BY created_at`,
        [order.id],
      );
      expect(history.at(-1)).toMatchObject({ new_status: 'PENDING_VERIFICATION' });
    });

    it('leaves the order REJECTED and no orphaned object when the database write fails', async () => {
      const order = await newOrder();
      await q(`ALTER TABLE storage_objects ADD CONSTRAINT force_fail_rs CHECK (false) NOT VALID`);
      try {
        expect((await upload(order.order_number)).status).toBeGreaterThanOrEqual(500);
      } finally {
        await q(`ALTER TABLE storage_objects DROP CONSTRAINT force_fail_rs`);
      }
      expect((await row(order.id)).payment_status).toBe('REJECTED');
      expect([...(store.buckets.get('payment-proofs')?.objects.keys() ?? [])]).toHaveLength(0);
    });

    it('is the same screenshot-then-ID path: after the upload the ID can no longer be resubmitted (already pending)', async () => {
      const order = await newOrder();
      expect((await upload(order.order_number)).status).toBe(201);
      const res = await resubmit(order.order_number, { phoneNumber: PHONE, bkashTransactionId: 'LATE000001' });
      expect(res.status).toBe(409);
    });
  });

  describe('admin resubmit (regression: the new Transaction ID was never stored)', () => {
    it('records the new ID, upper-cased, and moves the payment to PENDING_VERIFICATION', async () => {
      const order = await newOrder({ txn: 'OLDADMIN01' });
      const s = await loginAsAdmin(app, 'rs-admin', PW);
      const res = await s.post(`/api/admin/orders/${order.id}/payments/resubmit`).send({ newBkashTransactionId: 'adminnew99' });
      expect(res.status).toBe(200);
      expect(await row(order.id)).toMatchObject({ payment_status: 'PENDING_VERIFICATION', bkash_transaction_id: 'ADMINNEW99' });
      // The request id belongs to the audit row's request_id, never to the Transaction ID.
      const audit = await q(`SELECT request_id FROM audit_logs WHERE entity_id=$1 AND action='payment_status_change'`, [order.id]);
      expect(audit[0].request_id).not.toBe('adminnew99');
    });

    it('answers 409 BKASH_TRANSACTION_ID_EXISTS for an ID another order holds, and changes nothing', async () => {
      await newOrder({ paymentStatus: 'PENDING_VERIFICATION', txn: 'HELDELSE01' });
      const order = await newOrder({ txn: 'OLDADMIN02' });
      const s = await loginAsAdmin(app, 'rs-admin', PW);
      const res = await s.post(`/api/admin/orders/${order.id}/payments/resubmit`).send({ newBkashTransactionId: 'HELDELSE01' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BKASH_TRANSACTION_ID_EXISTS');
      expect(await row(order.id)).toMatchObject({ payment_status: 'REJECTED', bkash_transaction_id: 'OLDADMIN02' });
    });
  });
});
