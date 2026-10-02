import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/**
 * Spec 17 — CMS lookups, attachment reads, and campaign list/detail additions.
 * RBAC: cms.manage alone must be enough (no product/category permission).
 */
const SCHEMA = 'spec13_cms_lookups';
const PW = 'CmsLookupsPass12';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const PRODUCT_KEYS = ['id', 'imageUrl', 'isActive', 'name', 'slug'];
const CATEGORY_KEYS = ['id', 'name', 'parentId', 'slug'];

describe.skipIf(!TEST_DATABASE_URL)('CMS lookups and attachment reads (spec 17)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let sectionId: string;
  let campaignId: string;
  const productIds: string[] = [];
  let catParent: string;
  let catChild: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool, withTransaction } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    const usersRepository = await import('../../src/repositories/users.repository.js');
    const permissionsRepository = await import('../../src/repositories/permissions.repository.js');
    const { hashPassword } = await import('../../src/lib/password.js');
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword(PW);
    const admin = await usersRepository.create({ role: 'ADMIN', userIdentifier: 'lk-admin', passwordHash, mustChangePassword: false });
    const cmsMgr = await usersRepository.create({ role: 'MANAGER', userIdentifier: 'lk-cms', passwordHash, mustChangePassword: false });
    await usersRepository.create({ role: 'MANAGER', userIdentifier: 'lk-none', passwordHash, mustChangePassword: false });
    await permissionsRepository.grant(cmsMgr.id, 'cms.manage', admin.id);

    await withTransaction(async (c) => {
      catParent = (await c.query<{ id: string }>(`INSERT INTO categories (name, slug, display_order) VALUES ('Lk Men','lk-men',0) RETURNING id`)).rows[0]!.id;
      catChild = (await c.query<{ id: string }>(`INSERT INTO categories (name, slug, parent_id, display_order) VALUES ('Lk Shirts','lk-shirts',$1,0) RETURNING id`, [catParent])).rows[0]!.id;
      const defs: Array<[string, string, string]> = [
        ['Alpha Panjabi', 'lk-alpha', 'ACTIVE'],
        ['Beta Panjabi', 'lk-beta', 'ACTIVE'],
        ['Gamma Shirt', 'lk-gamma', 'INACTIVE'],
      ];
      for (const [i, [name, slug, status]] of defs.entries()) {
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO products (category_id, name, slug, sku, base_price, weight_grams, status)
             VALUES ($1,$2,$3,$4,100,500,$5) RETURNING id`,
            [catParent, name, slug, `LK-SKU-${i}`, status],
          )
        ).rows[0]!.id;
        productIds.push(id);
      }
      await c.query(
        `INSERT INTO product_images (product_id, storage_path, display_order, is_primary) VALUES ($1,'lk/secondary.jpg',0,false), ($1,'lk/primary.jpg',5,true)`,
        [productIds[0]],
      );
    });

    const session = await loginAsAdmin(app, 'lk-admin', PW);
    const sec = await session.post('/api/admin/homepage/sections').send({ sectionType: 'PRODUCT_CAROUSEL', contentConfig: { mode: 'MANUAL' } });
    sectionId = sec.body.data.id;
    const camp = await session.post('/api/admin/campaigns').send({ name: 'Lookup Camp', slug: 'lookup-camp' });
    campaignId = camp.body.data.id;
  }, 90_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  const cms = () => loginAsAdmin(app, 'lk-cms', PW);
  const none = () => loginAsAdmin(app, 'lk-none', PW);

  describe('lookups', () => {
    it.each(['/api/admin/cms/lookups/products', '/api/admin/cms/lookups/categories'])('%s -> 401 unauthenticated', async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it.each(['/api/admin/cms/lookups/products', '/api/admin/cms/lookups/categories'])('%s -> 403 FORBIDDEN for a manager without cms.manage', async (url) => {
      const res = await (await none()).agent.get(url);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('products -> 200 for cms.manage only; exact key set; primary image chosen; isActive mapped from status', async () => {
      const res = await (await cms()).agent.get('/api/admin/cms/lookups/products');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      for (const item of res.body.data) expect(Object.keys(item).sort()).toEqual(PRODUCT_KEYS);
      const byName = Object.fromEntries(res.body.data.map((p: { name: string }) => [p.name, p]));
      expect(byName['Alpha Panjabi'].imageUrl).toBe('lk/primary.jpg');
      expect(byName['Beta Panjabi'].imageUrl).toBeNull();
      expect(byName['Alpha Panjabi'].isActive).toBe(true);
      expect(byName['Gamma Shirt'].isActive).toBe(false);
      expect(res.body.pagination.total).toBe(3);
    });

    it('products search q matches name or slug case-insensitively', async () => {
      const s = await cms();
      const byName = await s.agent.get('/api/admin/cms/lookups/products').query({ q: 'panjabi' });
      expect(byName.body.data.map((p: { name: string }) => p.name)).toEqual(['Alpha Panjabi', 'Beta Panjabi']);
      const bySlug = await s.agent.get('/api/admin/cms/lookups/products').query({ q: 'LK-GAMMA' });
      expect(bySlug.body.data.map((p: { name: string }) => p.name)).toEqual(['Gamma Shirt']);
      const miss = await s.agent.get('/api/admin/cms/lookups/products').query({ q: 'zzzz' });
      expect(miss.status).toBe(200);
      expect(miss.body.data).toEqual([]);
    });

    it('products q treats % literally (no wildcard injection)', async () => {
      const res = await (await cms()).agent.get('/api/admin/cms/lookups/products').query({ q: '%' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('products pagination: page/pageSize slice name-ordered results with a total', async () => {
      const s = await cms();
      const p1 = await s.agent.get('/api/admin/cms/lookups/products').query({ page: 1, pageSize: 2 });
      const p2 = await s.agent.get('/api/admin/cms/lookups/products').query({ page: 2, pageSize: 2 });
      expect(p1.body.data.map((p: { name: string }) => p.name)).toEqual(['Alpha Panjabi', 'Beta Panjabi']);
      expect(p2.body.data.map((p: { name: string }) => p.name)).toEqual(['Gamma Shirt']);
      expect(p1.body.pagination.total).toBe(3);
      expect(p1.body.pagination.totalPages).toBe(2);
    });

    it('products pageSize over 100 -> 400; unknown query key -> 400', async () => {
      const s = await cms();
      expect((await s.agent.get('/api/admin/cms/lookups/products').query({ pageSize: 101 })).status).toBe(400);
      expect((await s.agent.get('/api/admin/cms/lookups/products').query({ bogus: '1' })).status).toBe(400);
    });

    it('categories -> 200 for cms.manage only; exact key set; parent before child; parentId mapped', async () => {
      const res = await (await cms()).agent.get('/api/admin/cms/lookups/categories');
      expect(res.status).toBe(200);
      for (const item of res.body.data) expect(Object.keys(item).sort()).toEqual(CATEGORY_KEYS);
      expect(res.body.data.map((c: { slug: string }) => c.slug)).toEqual(['lk-men', 'lk-shirts']);
      expect(res.body.data[0].parentId).toBeNull();
      expect(res.body.data[1].parentId).toBe(catParent);
    });

    it('categories pagination slices and reports total', async () => {
      const res = await (await cms()).agent.get('/api/admin/cms/lookups/categories').query({ page: 2, pageSize: 1 });
      expect(res.body.data.map((c: { slug: string }) => c.slug)).toEqual(['lk-shirts']);
      expect(res.body.pagination.total).toBe(2);
    });
  });

  describe('attachment reads', () => {
    async function attach() {
      const admin = await loginAsAdmin(app, 'lk-admin', PW);
      // Deliberately not name order, so ordering must come from display_order.
      const order = [productIds[2]!, productIds[0]!, productIds[1]!];
      const cats = [catChild, catParent];
      for (const target of [`homepage/sections/${sectionId}`, `campaigns/${campaignId}`]) {
        const p = await admin.put(`/api/admin/${target}/products`).send({ productIds: order });
        expect(p.status).toBe(200);
        const c = await admin.put(`/api/admin/${target}/categories`).send({ categoryIds: cats });
        expect(c.status).toBe(200);
      }
    }

    it.each([
      ['homepage/sections', 'products'],
      ['homepage/sections', 'categories'],
      ['campaigns', 'products'],
      ['campaigns', 'categories'],
    ])('GET /api/admin/%s/:id/%s -> 401 anon, 403 without cms.manage, 404 unknown id', async (base, kind) => {
      const id = base === 'campaigns' ? campaignId : sectionId;
      expect((await request(app).get(`/api/admin/${base}/${id}/${kind}`)).status).toBe(401);

      const denied = await (await none()).agent.get(`/api/admin/${base}/${id}/${kind}`);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');

      const missing = await (await cms()).agent.get(`/api/admin/${base}/${UNKNOWN_ID}/${kind}`);
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');
    });

    it.each(['homepage/sections', 'campaigns'])('%s: attached products and categories return in attach order with minimal keys', async (base) => {
      await attach();
      const id = base === 'campaigns' ? campaignId : sectionId;
      const s = await cms();
      const products = await s.agent.get(`/api/admin/${base}/${id}/products`);
      expect(products.status).toBe(200);
      expect(products.body.data.map((p: { slug: string }) => p.slug)).toEqual(['lk-gamma', 'lk-alpha', 'lk-beta']);
      for (const item of products.body.data) expect(Object.keys(item).sort()).toEqual(PRODUCT_KEYS);

      const cats = await s.agent.get(`/api/admin/${base}/${id}/categories`);
      expect(cats.status).toBe(200);
      expect(cats.body.data.map((c: { slug: string }) => c.slug)).toEqual(['lk-shirts', 'lk-men']);
      for (const item of cats.body.data) expect(Object.keys(item).sort()).toEqual(CATEGORY_KEYS);
    });

    it('an existing section with nothing attached returns an empty list, not 404', async () => {
      const admin = await loginAsAdmin(app, 'lk-admin', PW);
      const sec = await admin.post('/api/admin/homepage/sections').send({ sectionType: 'PRODUCT_CAROUSEL', contentConfig: { mode: 'MANUAL' } });
      const res = await (await cms()).agent.get(`/api/admin/homepage/sections/${sec.body.data.id}/products`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('campaign list/detail sections + displayStatus', () => {
    it('detail and list include sections:[{id,title}] for linked sections and a displayStatus', async () => {
      const admin = await loginAsAdmin(app, 'lk-admin', PW);
      const camp = await admin.post('/api/admin/campaigns').send({ name: 'Linked Camp', slug: 'linked-camp' });
      const cid = camp.body.data.id as string;
      const emptyCamp = await admin.post('/api/admin/campaigns').send({ name: 'Unlinked Camp', slug: 'unlinked-camp' });
      const sec = await admin.post('/api/admin/homepage/sections').send({
        sectionType: 'CAMPAIGN_BANNER',
        title: 'Banner Title',
        campaignId: cid,
        contentConfig: {},
      });
      expect(sec.status).toBe(201);

      const detail = await (await cms()).agent.get(`/api/admin/campaigns/${cid}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.sections).toEqual([{ id: sec.body.data.id, title: 'Banner Title' }]);
      expect(detail.body.data.displayStatus).toBe('ACTIVE');
      expect(detail.body.data.linkedSectionCount).toBe(1);

      const list = await (await cms()).agent.get('/api/admin/campaigns').query({ pageSize: 100 });
      expect(list.status).toBe(200);
      const listed = list.body.data.find((c: { id: string }) => c.id === cid);
      const unlinked = list.body.data.find((c: { id: string }) => c.id === emptyCamp.body.data.id);
      expect(listed.sections).toEqual([{ id: sec.body.data.id, title: 'Banner Title' }]);
      expect(typeof listed.displayStatus).toBe('string');
      expect(unlinked.sections).toEqual([]);
    });

    it('displayStatus reflects the schedule: a future-dated campaign is SCHEDULED', async () => {
      const admin = await loginAsAdmin(app, 'lk-admin', PW);
      const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const camp = await admin.post('/api/admin/campaigns').send({ name: 'Future Camp', slug: 'future-camp', startsAt: future });
      const detail = await (await cms()).agent.get(`/api/admin/campaigns/${camp.body.data.id}`);
      expect(detail.body.data.displayStatus).toBe('SCHEDULED');
    });
  });
});
