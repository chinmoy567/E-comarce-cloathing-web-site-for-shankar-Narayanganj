import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import * as auditRepository from '../../src/repositories/audit.repository.ts';

/**
 * Spec 02 acceptance 11, test 9 — the audit log is append-only.
 *
 * The guarantee is the ABSENCE of a mutation code path (06-rbac §5.15 rule 10,
 * database skill §2.4), so the first test inspects the module's exports: if
 * someone later adds an `update` or `delete` here, this fails before the
 * rewritable audit trail can ship.
 */
const SCHEMA = 'spec02_audit';

describe('audit repository exports (acceptance 11)', () => {
  it('exposes no function that updates or deletes a row', () => {
    const exported = Object.keys(auditRepository).sort();
    expect(exported).toEqual(['append', 'listAll', 'listForEntity']);
  });

  it('exposes no export whose name suggests mutation', () => {
    const mutating = Object.keys(auditRepository).filter((name) =>
      /update|delete|remove|purge|destroy|truncate|edit|modify/i.test(name),
    );
    expect(mutating).toEqual([]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('audit repository round-trip', () => {
  let repo: typeof auditRepository;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    repo = await import('../../src/repositories/audit.repository.js');
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  const ENTITY_ID = '11111111-1111-1111-1111-111111111111';

  it('round-trips previous/new value, actor, and reason (§5.21.11)', async () => {
    const appended = await repo.append({
      entityType: 'order',
      entityId: ENTITY_ID,
      action: 'status_change',
      previousValue: { status: 'PENDING' },
      newValue: { status: 'CONFIRMED' },
      reason: 'Payment verified',
      actorType: 'SYSTEM',
      requestId: 'req-123',
    });

    expect(appended).toMatchObject({
      entityType: 'order',
      entityId: ENTITY_ID,
      action: 'status_change',
      previousValue: { status: 'PENDING' },
      newValue: { status: 'CONFIRMED' },
      reason: 'Payment verified',
      actorUserId: null,
      actorType: 'SYSTEM',
      requestId: 'req-123',
    });
    expect(appended.createdAt).toBeInstanceOf(Date);
  });

  it('accepts a system-level event with no entity id', async () => {
    const entry = await repo.append({
      entityType: 'system',
      action: 'admin_seeded',
      actorType: 'SYSTEM',
    });
    expect(entry.entityId).toBeNull();
    expect(entry.previousValue).toBeNull();
    expect(entry.newValue).toBeNull();
  });

  it('lists an entity history newest first', async () => {
    const id = '22222222-2222-2222-2222-222222222222';
    for (const status of ['CONFIRMED', 'SHIPPED', 'DELIVERED']) {
      await repo.append({
        entityType: 'order',
        entityId: id,
        action: 'status_change',
        newValue: { status },
        actorType: 'SYSTEM',
      });
    }

    const { items, total } = await repo.listForEntity('order', id, { page: 1, pageSize: 20 });
    expect(total).toBe(3);
    expect(items.map((i) => (i.newValue as { status: string }).status)).toEqual([
      'DELIVERED',
      'SHIPPED',
      'CONFIRMED',
    ]);
  });

  it('paginates without losing the total', async () => {
    const { items, total } = await repo.listForEntity(
      'order',
      '22222222-2222-2222-2222-222222222222',
      { page: 1, pageSize: 2 },
    );
    expect(items).toHaveLength(2);
    expect(total).toBe(3);
  });
});
