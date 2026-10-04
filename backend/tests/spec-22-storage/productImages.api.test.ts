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
 * Product images (spec 06, 05-admin §5.1). Real HTTP, middleware and database; only the Supabase
 * Storage client is an in-memory fake.
 */
vi.mock('../../src/lib/supabase.ts', async () => (await import('../helpers/fakeSupabaseStorage.ts')).fakeSupabaseModule());

const SCHEMA = 'spec22_product_images_api';
const PW = 'ImagesApiPass12';

describe.skipIf(!TEST_DATABASE_URL)('product images (spec 06)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let resetBucketCache: () => void;
  let categoryId: string;

  const bucketObjects = () => [...(store.buckets.get('product-images')?.objects.keys() ?? [])];
  const admin = () => loginAsAdmin(app, 'img-admin', PW);
  const manager = () => loginAsAdmin(app, 'img-mgr', PW);

  async function newProduct(opts: { status?: 'ACTIVE' | 'INACTIVE' } = {}) {
    const slug = `img-${Math.random().toString(36).slice(2, 10)}`;
    const [p] = await q<{ id: string; slug: string }>(
      `INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,'Image Product',$2,500,$3) RETURNING id, slug`,
      [categoryId, slug, opts.status ?? 'ACTIVE'],
    );
    await q(`INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active) VALUES ($1,$2,500,5,true)`, [
      p!.id,
      `SKU-${slug}`,
    ]);
    return p!;
  }

  async function jpeg(width = 800, height = 600, withExif = false): Promise<Buffer> {
    let img = sharp({ create: { width, height, channels: 3, background: '#3366cc' } }).jpeg();
    if (withExif) img = img.withExif({ IFD0: { ImageDescription: 'secret-gps-note' } });
    return img.toBuffer();
  }

  async function upload(session: Awaited<ReturnType<typeof admin>>, productId: string, body: Buffer, altText?: string) {
    const url = `/api/admin/catalogue/products/${productId}/images${altText ? `?altText=${encodeURIComponent(altText)}` : ''}`;
    return session.post(url).set('Content-Type', 'application/octet-stream').send(body);
  }

  const images = async (productId: string) =>
    q<{ id: string; is_primary: boolean; display_order: number }>(
      `SELECT id, is_primary, display_order FROM product_images WHERE product_id = $1 ORDER BY display_order`,
      [productId],
    );

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.RL_AUTHENTICATED_CEILING_MAX = '100000';
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);

    ({ resetBucketCache } = await import('../../src/services/storage/imagePipeline.ts'));

    const { hashPassword } = await import('../../src/lib/password.js');
    const users = await import('../../src/repositories/users.repository.js');
    const passwordHash = await hashPassword(PW);
    await users.create({ role: 'ADMIN', userIdentifier: 'img-admin', passwordHash, mustChangePassword: false });
    await users.create({ role: 'MANAGER', userIdentifier: 'img-mgr', passwordHash, mustChangePassword: false });

    const { createApp } = await import('../../src/app.js');
    app = createApp();

    [{ id: categoryId }] = (await q(`INSERT INTO categories (name, slug, status) VALUES ('Img Cat','img-cat','ACTIVE') RETURNING id`)) as any;
  }, 90_000);

  beforeEach(() => {
    store.reset();
    resetBucketCache();
  });

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  describe('upload', () => {
    it('stores a re-encoded WebP in the public bucket under a server-generated path, and the first image is primary', async () => {
      const product = await newProduct();
      const s = await admin();
      const res = await upload(s, product.id, await jpeg(3000, 1000, true), 'Front view');
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ productId: product.id, altText: 'Front view', isPrimary: true, displayOrder: 0 });
      expect(res.body.data.storagePath).toMatch(new RegExp(`^https://storage\\.test/public/product-images/product/${product.id}/[0-9a-f-]{36}\\.webp$`));

      expect(store.buckets.get('product-images')!.public).toBe(true);
      const [path, obj] = [...store.buckets.get('product-images')!.objects.entries()][0]!;
      expect(path).toMatch(new RegExp(`^product/${product.id}/[0-9a-f-]{36}\\.webp$`));
      const meta = await sharp(obj.data).metadata();
      expect(meta.format).toBe('webp');
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2000);
      expect(meta.exif).toBeUndefined();

      const [reg] = await q(`SELECT visibility, owner_entity_type, owner_entity_id FROM storage_objects WHERE object_path = $1`, [path]);
      expect(reg).toMatchObject({ visibility: 'PUBLIC', owner_entity_type: 'product', owner_entity_id: product.id });
    });

    it('a second image is not primary and is ordered after the first', async () => {
      const product = await newProduct();
      const s = await admin();
      await upload(s, product.id, await jpeg());
      const second = await upload(s, product.id, await jpeg(400, 400));
      expect(second.body.data).toMatchObject({ isPrimary: false, displayOrder: 1 });
    });

    it('shows up on the admin product and on the public product page', async () => {
      const product = await newProduct();
      const s = await admin();
      const up = await upload(s, product.id, await jpeg());

      const detail = await s.agent.get(`/api/admin/catalogue/products/${product.id}`);
      expect(detail.body.data.images).toHaveLength(1);
      expect(detail.body.data.images[0].storagePath).toBe(up.body.data.storagePath);

      const pub = await request(app).get(`/api/products/${product.slug}`);
      expect(pub.status).toBe(200);
      expect(pub.body.data.images[0]).toMatchObject({ url: up.body.data.storagePath, isPrimary: true });
    });

    it('rejects SVG, HTML and a script named like an image — nothing reaches the bucket or the registry', async () => {
      const product = await newProduct();
      const s = await admin();
      const bodies = [
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        Buffer.from('<html><script>alert(1)</script></html>'),
        Buffer.from('<?php system($_GET["c"]); ?>'),
      ];
      for (const body of bodies) expect((await upload(s, product.id, body)).status).toBe(400);
      expect(bucketObjects()).toHaveLength(0);
      expect(await q(`SELECT 1 FROM product_images WHERE product_id = $1`, [product.id])).toHaveLength(0);
    });

    it('caps the body at 5 MB on this route only', async () => {
      const product = await newProduct();
      const s = await admin();
      expect((await upload(s, product.id, Buffer.alloc(6 * 1024 * 1024, 1))).status).toBe(413);
    });

    it('refuses an 11th image with 409 IMAGE_LIMIT_REACHED', async () => {
      const product = await newProduct();
      for (let i = 0; i < 10; i++) {
        await q(`INSERT INTO product_images (product_id, storage_path, display_order, is_primary) VALUES ($1,$2,$3,$4)`, [
          product.id,
          `https://example.test/${i}.webp`,
          i,
          i === 0,
        ]);
      }
      const res = await upload(await admin(), product.id, await jpeg());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IMAGE_LIMIT_REACHED');
      expect(bucketObjects()).toHaveLength(0);
    });

    it('answers 404 for an unknown product and leaves no object behind', async () => {
      const res = await upload(await admin(), '00000000-0000-0000-0000-000000000000', await jpeg());
      expect(res.status).toBe(404);
      expect(bucketObjects()).toHaveLength(0);
    });

    it('leaves no orphaned object when the database write fails after the upload', async () => {
      const product = await newProduct();
      await q(`ALTER TABLE storage_objects ADD CONSTRAINT force_fail_img CHECK (false) NOT VALID`);
      try {
        const res = await upload(await admin(), product.id, await jpeg());
        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        await q(`ALTER TABLE storage_objects DROP CONSTRAINT force_fail_img`);
      }
      expect(bucketObjects()).toHaveLength(0);
    });

    it('refuses to use a product-images bucket that turns out to be private', async () => {
      const product = await newProduct();
      store.buckets.set('product-images', { public: false, objects: new Map() });
      expect((await upload(await admin(), product.id, await jpeg())).status).toBe(500);
    });

    it('writes an audit row naming the actor', async () => {
      const product = await newProduct();
      await upload(await admin(), product.id, await jpeg());
      const rows = await q(`SELECT actor_user_id FROM audit_logs WHERE entity_id = $1 AND action = 'product_image_uploaded'`, [product.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_user_id).not.toBeNull();
    });
  });

  describe('primary, order and alt text', () => {
    async function productWithImages(n: number) {
      const product = await newProduct();
      const s = await admin();
      const ids: string[] = [];
      for (let i = 0; i < n; i++) ids.push((await upload(s, product.id, await jpeg(200 + i, 200))).body.data.id);
      return { product, s, ids };
    }

    it('setting primary leaves exactly one primary', async () => {
      const { product, s, ids } = await productWithImages(3);
      const res = await s.post(`/api/admin/catalogue/images/${ids[2]}/primary`);
      expect(res.status).toBe(200);
      const rows = await images(product.id);
      expect(rows.filter((r) => r.is_primary)).toHaveLength(1);
      expect(rows.find((r) => r.is_primary)!.id).toBe(ids[2]);
    });

    it('concurrent set-primary calls still leave exactly one primary', async () => {
      const { product, s, ids } = await productWithImages(3);
      await Promise.all([ids[1], ids[2], ids[1], ids[2]].map((id) => s.post(`/api/admin/catalogue/images/${id}/primary`)));
      expect((await images(product.id)).filter((r) => r.is_primary)).toHaveLength(1);
    });

    it('reorder applies a complete list and rejects a partial or duplicated one, changing nothing', async () => {
      const { product, s, ids } = await productWithImages(3);
      const ok = await s.patch(`/api/admin/catalogue/products/${product.id}/images/order`).send({ imageIds: [ids[2], ids[0], ids[1]] });
      expect(ok.status).toBe(200);
      expect((await images(product.id)).map((r) => r.id)).toEqual([ids[2], ids[0], ids[1]]);

      for (const bad of [[ids[0], ids[1]], [ids[0], ids[0], ids[1]], [ids[0], ids[1], '00000000-0000-0000-0000-000000000000']]) {
        const res = await s.patch(`/api/admin/catalogue/products/${product.id}/images/order`).send({ imageIds: bad });
        expect(res.status).toBe(400);
      }
      expect((await images(product.id)).map((r) => r.id)).toEqual([ids[2], ids[0], ids[1]]);
    });

    it('updates alt text, trimming and clearing it', async () => {
      const { s, ids } = await productWithImages(1);
      const set = await s.patch(`/api/admin/catalogue/images/${ids[0]}`).send({ altText: '  Blue shirt  ' });
      expect(set.body.data.altText).toBe('Blue shirt');
      const cleared = await s.patch(`/api/admin/catalogue/images/${ids[0]}`).send({ altText: '' });
      expect(cleared.body.data.altText).toBeNull();
      expect((await s.patch(`/api/admin/catalogue/images/${ids[0]}`).send({ altText: 'x'.repeat(301) })).status).toBe(400);
    });
  });

  describe('delete', () => {
    it('removes the object, marks the registry row deleted, and promotes the next image when the primary goes', async () => {
      const product = await newProduct();
      const s = await admin();
      const a = (await upload(s, product.id, await jpeg())).body.data;
      const b = (await upload(s, product.id, await jpeg(300, 300))).body.data;

      const res = await s.del(`/api/admin/catalogue/images/${a.id}`);
      expect(res.status).toBe(200);
      expect(bucketObjects()).toHaveLength(1);
      const rows = await images(product.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: b.id, is_primary: true });
      expect(await q(`SELECT 1 FROM storage_objects WHERE deleted_at IS NOT NULL AND owner_entity_id = $1`, [product.id])).toHaveLength(1);

      expect((await s.del(`/api/admin/catalogue/images/${b.id}`)).status).toBe(200);
      expect(await images(product.id)).toHaveLength(0);
      expect(bucketObjects()).toHaveLength(0);
    });

    it('keeps the image when the bucket refuses to delete it (no false "deleted")', async () => {
      const product = await newProduct();
      const s = await admin();
      const a = (await upload(s, product.id, await jpeg())).body.data;
      store.removeFails = true;
      const res = await s.del(`/api/admin/catalogue/images/${a.id}`);
      expect(res.status).toBe(502);
      expect(await images(product.id)).toHaveLength(1);
      expect(await q(`SELECT 1 FROM storage_objects WHERE deleted_at IS NOT NULL AND owner_entity_id = $1`, [product.id])).toHaveLength(0);
    });

    it('deleting a product removes all of its stored images', async () => {
      const product = await newProduct();
      const s = await admin();
      await upload(s, product.id, await jpeg());
      await upload(s, product.id, await jpeg(300, 300));
      expect(bucketObjects()).toHaveLength(2);
      const res = await s.del(`/api/admin/catalogue/products/${product.id}`);
      expect(res.status).toBe(200);
      expect(bucketObjects()).toHaveLength(0);
    });
  });

  describe('permissions (product.image.manage)', () => {
    it('every route is 401 without a session', async () => {
      const product = await newProduct();
      const id = '00000000-0000-0000-0000-000000000000';
      const calls = [
        request(app).post(`/api/admin/catalogue/products/${product.id}/images`),
        request(app).patch(`/api/admin/catalogue/products/${product.id}/images/order`).send({ imageIds: [id] }),
        request(app).patch(`/api/admin/catalogue/images/${id}`).send({ altText: null }),
        request(app).post(`/api/admin/catalogue/images/${id}/primary`),
        request(app).delete(`/api/admin/catalogue/images/${id}`),
      ];
      for (const call of calls) expect((await call).status).toBe(401);
    });

    it('a Manager is allowed by default and refused once that single key is revoked', async () => {
      const product = await newProduct();
      const m = await manager();
      expect((await upload(m, product.id, await jpeg())).status).toBe(201);

      await q(`UPDATE permissions SET manager_tier='NO' WHERE key='product.image.manage'`);
      try {
        const m2 = await manager();
        expect((await upload(m2, product.id, await jpeg())).status).toBe(403);
        const [img] = await images(product.id);
        expect((await m2.post(`/api/admin/catalogue/images/${img!.id}/primary`)).status).toBe(403);
        expect((await m2.del(`/api/admin/catalogue/images/${img!.id}`)).status).toBe(403);
        expect((await m2.patch(`/api/admin/catalogue/images/${img!.id}`).send({ altText: 'x' })).status).toBe(403);
        expect((await m2.patch(`/api/admin/catalogue/products/${product.id}/images/order`).send({ imageIds: [img!.id] })).status).toBe(403);
      } finally {
        await q(`UPDATE permissions SET manager_tier='YES' WHERE key='product.image.manage'`);
      }
    });
  });
});
