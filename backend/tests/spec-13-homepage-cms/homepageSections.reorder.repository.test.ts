import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';

/** Spec 13 — atomic reorder (§13.12). */
const SCHEMA = 'spec13_reorder_repository';

describe.skipIf(!TEST_DATABASE_URL)('reorderSections (13-homepage-cms §13.12)', () => {
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let homepageSectionsRepository: typeof import('../../src/repositories/homepageSections.repository.js');
  let homepageSectionsService: typeof import('../../src/services/homepageCms/homepageSections.service.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let adminId: string;
  let sectionIds: string[];

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    const { applyTestEnv } = await import('../helpers/testEnv.js');
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    const { resetEnvCache } = await import('../../src/config/env.js');
    resetEnvCache();

    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    usersRepository = await import('../../src/repositories/users.repository.js');
    homepageSectionsRepository = await import('../../src/repositories/homepageSections.repository.js');
    homepageSectionsService = await import('../../src/services/homepageCms/homepageSections.service.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));

    const passwordHash = await hashPassword('ReorderTestPass12');
    adminId = (
      await usersRepository.create({ role: 'ADMIN', userIdentifier: 'reorder-admin', passwordHash, mustChangePassword: false })
    ).id;

    const a = await homepageSectionsRepository.create({
      sectionType: 'HERO',
      contentConfig: {},
      displayOrder: 0,
      createdBy: adminId,
    });
    const b = await homepageSectionsRepository.create({
      sectionType: 'CATEGORY_GRID',
      contentConfig: { mode: 'ALL_ACTIVE_TOP_LEVEL' },
      displayOrder: 1,
      createdBy: adminId,
    });
    const c = await homepageSectionsRepository.create({
      sectionType: 'CUSTOM_CONTENT',
      contentConfig: { body: 'hello' },
      displayOrder: 2,
      createdBy: adminId,
    });
    sectionIds = [a.id, b.id, c.id];
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  it('a valid full-set reorder applies the new order', async () => {
    const reversed = [...sectionIds].reverse();
    await homepageSectionsService.reorderSections({ userId: adminId, role: 'ADMIN' }, reversed);

    const { items } = await homepageSectionsRepository.list({ page: 1, pageSize: 10 });
    expect(items.map((s) => s.id)).toEqual(reversed);
  });

  it('a list missing a section is rejected and changes nothing', async () => {
    const before = await homepageSectionsRepository.list({ page: 1, pageSize: 10 });

    await expect(
      homepageSectionsService.reorderSections({ userId: adminId, role: 'ADMIN' }, [sectionIds[0]!, sectionIds[1]!]),
    ).rejects.toThrow();

    const after = await homepageSectionsRepository.list({ page: 1, pageSize: 10 });
    expect(after.items.map((s) => s.id)).toEqual(before.items.map((s) => s.id));
  });

  it('a list containing an unknown id is rejected and changes nothing', async () => {
    const before = await homepageSectionsRepository.list({ page: 1, pageSize: 10 });

    await expect(
      homepageSectionsService.reorderSections(
        { userId: adminId, role: 'ADMIN' },
        [sectionIds[0]!, sectionIds[1]!, '00000000-0000-0000-0000-000000000000'],
      ),
    ).rejects.toThrow();

    const after = await homepageSectionsRepository.list({ page: 1, pageSize: 10 });
    expect(after.items.map((s) => s.id)).toEqual(before.items.map((s) => s.id));
  });

  it('a list with a duplicate id is rejected and changes nothing', async () => {
    const before = await homepageSectionsRepository.list({ page: 1, pageSize: 10 });

    await expect(
      homepageSectionsService.reorderSections({ userId: adminId, role: 'ADMIN' }, [sectionIds[0]!, sectionIds[0]!, sectionIds[1]!]),
    ).rejects.toThrow();

    const after = await homepageSectionsRepository.list({ page: 1, pageSize: 10 });
    expect(after.items.map((s) => s.id)).toEqual(before.items.map((s) => s.id));
  });
});
