import type { Express } from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';

/**
 * bKash payment screenshots (spec 06 private slice, 03-payment-order §3.1, 05-admin §5.3,
 * §2.9.6). Real HTTP, middleware and database; only the Supabase Storage client is replaced
 * by an in-memory fake, because the suite must not need live credentials.
 */
const store = vi.hoisted(() => ({
  buckets: new Map<string, { public: boolean; objects: Map<string, { data: Buffer; contentType: string }> }>(),
  forcePublic: false,
  removeFails: false,
  signedTtls: [] as number[],
}));

vi.mock('../../src/lib/supabase.ts', () => ({
  resetSupabaseClient: () => undefined,
  getSupabase: () => ({
    storage: {
      getBucket: async (name: string) => {
        const b = store.buckets.get(name);
        return b ? { data: { name, public: store.forcePublic || b.public }, error: null } : { data: null, error: { message: 'not found' } };
      },
      createBucket: async (name: string, opts: { public: boolean }) => {
        store.buckets.set(name, { public: opts.public, objects: new Map() });
        return { data: { name }, error: null };
      },
      from: (name: string) => ({
        upload: async (path: string, data: Buffer, opts: { contentType: string }) => {
          store.buckets.get(name)!.objects.set(path, { data, contentType: opts.contentType });
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          if (store.removeFails) return { data: null, error: { message: 'boom' } };
          for (const p of paths) store.buckets.get(name)!.objects.delete(p);
          return { data: [], error: null };
        },
        createSignedUrl: async (path: string, ttl: number) => {
          store.signedTtls.push(ttl);
          return { data: { signedUrl: `https://storage.test/sign/${name}/${path}?token=t` }, error: null };
        },
      }),
    },
  }),
}));

const SCHEMA = 'spec22_payment_proof_api';
const PW = 'ProofApiPass12';
const PHONE = '01711111111';

describe.skipIf(!TEST_DATABASE_URL)('payment proof (spec 06 private slice)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let resetPaymentProofBucketCache: () => void;
  let customerId: string;

  const proofObjects = () => [...(store.buckets.get('payment-proofs')?.objects.entries() ?? [])];

  async function newOrder(opts: { method?: 'BKASH' | 'COD'; paymentStatus?: string; orderStatus?: string; phone?: string } = {}) {
    const method = opts.method ?? 'BKASH';
    const num = `PR${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const [o] = await q<{ id: string; order_number: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, total_amount,
                          full_name, phone_number, detailed_address)
       VALUES ($1,$6,$2,$3,$4,500,500,'Proof Tester',$5,'House 1') RETURNING id, order_number`,
      [
        num,
        method,
        opts.orderStatus ?? (method === 'BKASH' ? 'PENDING_CONFIRMATION' : 'COD_VERIFICATION_PENDING'),
        opts.paymentStatus ?? (method === 'BKASH' ? 'PENDING_VERIFICATION' : 'PENDING_COLLECTION'),
        opts.phone ?? PHONE,
        customerId,
      ],
    );
    return o!;
  }

  const upload = (orderNumber: string, body: Buffer, phone: string | null = PHONE) => {
    let r = request(app).post(`/api/orders/${orderNumber}/payment-proof`).set('Content-Type', 'application/octet-stream');
    if (phone !== null) r = r.set('X-Order-Phone', phone);
    return r.send(body);
  };

  async function jpeg(width = 800, height = 600, withExif = false): Promise<Buffer> {
    let img = sharp({ create: { width, height, channels: 3, background: '#cc3366' } }).jpeg();
    if (withExif) img = img.withExif({ IFD0: { ImageDescription: 'secret-gps-note' } });
    return img.toBuffer();
  }

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

    [{ id: customerId }] = (await q(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('GUEST','Proof Customer','01711111111','Dhaka','Dhaka','THANA','Gulshan','WARD','Ward 2','House 2') RETURNING id`,
    )) as any;

    ({ resetPaymentProofBucketCache } = await import('../../src/services/storage/paymentProofs.service.ts'));

    const { hashPassword } = await import('../../src/lib/password.js');
    const users = await import('../../src/repositories/users.repository.js');
    const passwordHash = await hashPassword(PW);
    await users.create({ role: 'ADMIN', userIdentifier: 'pp-admin', passwordHash, mustChangePassword: false });
    await users.create({ role: 'MANAGER', userIdentifier: 'pp-mgr', passwordHash, mustChangePassword: false });

    const { createApp } = await import('../../src/app.js');
    app = createApp();
  }, 90_000);

  beforeEach(async () => {
    // Registry assertions below count rows, so every test starts from an empty registry.
    await q(`UPDATE orders SET payment_proof_object_id = NULL`);
    await q(`DELETE FROM storage_objects`);
    store.buckets.clear();
    store.forcePublic = false;
    store.removeFails = false;
    store.signedTtls.length = 0;
    resetPaymentProofBucketCache();
  });

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  describe('customer upload', () => {
    it('stores a re-encoded, metadata-free WebP in the private bucket under a server-generated path', async () => {
      const order = await newOrder();
      const res = await upload(order.order_number, await jpeg(3000, 1000, true));
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ received: true });

      expect(store.buckets.get('payment-proofs')!.public).toBe(false);
      const objects = proofObjects();
      expect(objects).toHaveLength(1);
      const [path, obj] = objects[0]!;
      expect(path).toMatch(new RegExp(`^payment/${order.id}/[0-9a-f-]{36}\\.webp$`));
      expect(obj.contentType).toBe('image/webp');

      const meta = await sharp(obj.data).metadata();
      expect(meta.format).toBe('webp');
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2000);
      expect(meta.exif).toBeUndefined();

      const [row] = await q(`SELECT visibility, bucket, mime_type, owner_entity_type, owner_entity_id FROM storage_objects`);
      expect(row).toMatchObject({ visibility: 'PRIVATE', bucket: 'payment-proofs', mime_type: 'image/webp', owner_entity_type: 'payment', owner_entity_id: order.id });
    });

    it('answers a wrong phone and an unknown order identically, and stores nothing', async () => {
      const order = await newOrder();
      const wrongPhone = await upload(order.order_number, await jpeg(), '01999999999');
      const unknown = await upload('NOSUCHORDER1', await jpeg());
      expect(wrongPhone.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(wrongPhone.body.error.message).toBe(unknown.body.error.message);
      expect(proofObjects()).toHaveLength(0);
    });

    it('requires the phone header and a non-empty body', async () => {
      const order = await newOrder();
      expect((await upload(order.order_number, await jpeg(), null)).status).toBe(400);
      expect((await upload(order.order_number, Buffer.alloc(0))).status).toBe(400);
    });

    it('rejects SVG, HTML and a PHP script named like an image — nothing reaches the bucket or the registry', async () => {
      const order = await newOrder();
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const html = Buffer.from('<html><body><script>alert(1)</script></body></html>');
      const php = Buffer.from('<?php system($_GET["c"]); ?>');
      for (const body of [svg, html, php]) {
        const res = await upload(order.order_number, body);
        expect(res.status).toBe(400);
      }
      expect(proofObjects()).toHaveLength(0);
      expect(await q(`SELECT 1 FROM storage_objects`)).toHaveLength(0);
    });

    it('rejects a file over the 5 MB cap with 413, and the global 100 kb limit still applies elsewhere', async () => {
      const order = await newOrder();
      const big = await upload(order.order_number, Buffer.alloc(6 * 1024 * 1024, 1));
      expect(big.status).toBe(413);
      const json = await request(app).post('/api/orders/lookup').send({ orderNumber: 'X', phoneNumber: 'a'.repeat(200_000) });
      expect(json.status).toBe(413);
    });

    it('only accepts a proof for a bKash order that is awaiting verification', async () => {
      const cod = await newOrder({ method: 'COD' });
      const verified = await newOrder({ paymentStatus: 'PAID_VERIFIED' });
      const cancelled = await newOrder({ orderStatus: 'CANCELLED' });
      for (const o of [cod, verified, cancelled]) {
        const res = await upload(o.order_number, await jpeg());
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('PAYMENT_PROOF_NOT_ACCEPTED');
      }
      expect(proofObjects()).toHaveLength(0);
    });

    it('replaces an earlier screenshot: the old object is removed and marked deleted', async () => {
      const order = await newOrder();
      expect((await upload(order.order_number, await jpeg())).status).toBe(201);
      const [first] = proofObjects();
      expect((await upload(order.order_number, await jpeg(400, 400))).status).toBe(201);

      const objects = proofObjects();
      expect(objects).toHaveLength(1);
      expect(objects[0]![0]).not.toBe(first![0]);
      const rows = await q<{ object_path: string; deleted_at: Date | null }>(`SELECT object_path, deleted_at FROM storage_objects ORDER BY created_at`);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.deleted_at).not.toBeNull();
      expect(rows[1]!.deleted_at).toBeNull();
    });

    it('keeps the registry row when the bucket delete of a replaced object fails', async () => {
      const order = await newOrder();
      await upload(order.order_number, await jpeg());
      store.removeFails = true;
      expect((await upload(order.order_number, await jpeg(300, 300))).status).toBe(201);
      const rows = await q<{ deleted_at: Date | null }>(`SELECT deleted_at FROM storage_objects ORDER BY created_at`);
      expect(rows[0]!.deleted_at).toBeNull();
    });

    it('leaves no orphaned object when the database write fails after the upload', async () => {
      const order = await newOrder();
      await q(`ALTER TABLE storage_objects ADD CONSTRAINT force_fail CHECK (false) NOT VALID`);
      try {
        const res = await upload(order.order_number, await jpeg());
        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        await q(`ALTER TABLE storage_objects DROP CONSTRAINT force_fail`);
      }
      expect(proofObjects()).toHaveLength(0);
      expect(await q(`SELECT 1 FROM storage_objects`)).toHaveLength(0);
    });

    it('refuses to use a bucket that turns out to be public', async () => {
      const order = await newOrder();
      store.buckets.set('payment-proofs', { public: true, objects: new Map() });
      const res = await upload(order.order_number, await jpeg());
      expect(res.status).toBe(500);
      expect(proofObjects()).toHaveLength(0);
    });

    it('writes an audit row for the submission', async () => {
      const order = await newOrder();
      await upload(order.order_number, await jpeg());
      const rows = await q(`SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'payment_proof_submitted'`, [order.id]);
      expect(rows).toHaveLength(1);
    });
  });

  describe('customer-facing responses never expose the proof (§2.9.6)', () => {
    it('guest lookup carries no screenshot reference or URL', async () => {
      const order = await newOrder();
      await upload(order.order_number, await jpeg());
      const res = await request(app).post('/api/orders/lookup').send({ orderNumber: order.order_number, phoneNumber: PHONE });
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/payment\/|payment-proof|proof|storage\.test|signed/i);
    });
  });

  describe('admin view (payment.view)', () => {
    const admin = () => loginAsAdmin(app, 'pp-admin', PW);
    const manager = () => loginAsAdmin(app, 'pp-mgr', PW);

    it('reports hasProof, then returns a short-lived signed URL', async () => {
      const order = await newOrder();
      const s = await admin();

      const before = await s.agent.get(`/api/admin/orders/${order.id}/payment`);
      expect(before.body.data.hasProof).toBe(false);
      expect((await s.agent.get(`/api/admin/orders/${order.id}/payment/proof`)).status).toBe(404);

      await upload(order.order_number, await jpeg());
      const after = await s.agent.get(`/api/admin/orders/${order.id}/payment`);
      expect(after.body.data.hasProof).toBe(true);
      expect(JSON.stringify(after.body)).not.toMatch(/payment\//);

      const res = await s.agent.get(`/api/admin/orders/${order.id}/payment/proof`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(res.body.data.url).toMatch(/^https:\/\/storage\.test\/sign\/payment-proofs\/payment\//);
      expect(store.signedTtls).toEqual([120]);
      expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('is refused without payment.view (403) and without a session (401)', async () => {
      const order = await newOrder();
      await upload(order.order_number, await jpeg());

      expect((await request(app).get(`/api/admin/orders/${order.id}/payment/proof`)).status).toBe(401);

      await q(`UPDATE permissions SET manager_tier='NO' WHERE key='payment.view'`);
      try {
        const m = await manager();
        expect((await m.agent.get(`/api/admin/orders/${order.id}/payment/proof`)).status).toBe(403);
        expect((await m.agent.get(`/api/admin/orders/${order.id}/payment`)).status).toBe(403);
      } finally {
        await q(`UPDATE permissions SET manager_tier='YES' WHERE key='payment.view'`);
      }
    });
  });
});
