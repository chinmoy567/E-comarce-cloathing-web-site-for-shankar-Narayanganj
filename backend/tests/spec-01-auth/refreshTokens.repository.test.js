import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { resetEnvCache } from '../../src/config/env.ts';
/**
 * Spec 03 — `refresh_tokens` repository contract (migration 0004,
 * §Database changes, §11.7).
 *
 * The raw token is never stored, only its hash; `findByHash` is the only
 * lookup path; `revoke`/`revokeAllForUser` are the two ways a token stops
 * being usable. This layer only stores rows — reuse detection and rotation
 * are `adminAuth.service`'s job, covered in `adminAuth.service.test.ts`.
 */
const SCHEMA = 'spec03_refreshrepo';
describe.skipIf(!TEST_DATABASE_URL)('refreshTokens repository', () => {
    let repo;
    let users;
    let withTransaction;
    let resetTransactionPool;
    let userId;
    beforeAll(async () => {
        await resetSchema(SCHEMA);
        process.env.DATABASE_URL = scopedUrl(SCHEMA);
        resetEnvCache();
        ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
        await resetTransactionPool();
        repo = await import('../../src/repositories/refreshTokens.repository.js');
        users = await import('../../src/repositories/users.repository.js');
    }, 60_000);
    afterAll(async () => {
        await resetTransactionPool?.();
        await dropSchema(SCHEMA);
    });
    beforeEach(async () => {
        await withTransaction(async (c) => {
            await c.query('DELETE FROM refresh_tokens');
            await c.query('DELETE FROM users');
        });
        const admin = await users.create({ role: 'ADMIN', userIdentifier: 'admin01', passwordHash: 'hash' });
        userId = admin.id;
    });
    it('creates a row and finds it by hash', async () => {
        const expiresAt = new Date(Date.now() + 60_000);
        const created = await repo.create({ userId, tokenHash: 'hash-a', scope: 'admin', expiresAt });
        const found = await repo.findByHash('hash-a');
        expect(found?.id).toBe(created.id);
        expect(found?.userId).toBe(userId);
        expect(found?.scope).toBe('admin');
        expect(found?.revokedAt).toBeNull();
        expect(found?.replacedBy).toBeNull();
    });
    it('findByHash returns null for an unknown hash', async () => {
        expect(await repo.findByHash('does-not-exist')).toBeNull();
    });
    it('rejects a duplicate token_hash (UNIQUE constraint)', async () => {
        const expiresAt = new Date(Date.now() + 60_000);
        await repo.create({ userId, tokenHash: 'dup-hash', scope: 'admin', expiresAt });
        await expect(repo.create({ userId, tokenHash: 'dup-hash', scope: 'admin', expiresAt })).rejects.toMatchObject({ code: '23505' });
    });
    it('rejects a scope outside admin|customer (CHECK constraint)', async () => {
        await expect(withTransaction(async (c) => {
            await c.query(`INSERT INTO refresh_tokens (user_id, token_hash, scope, expires_at)
           VALUES ($1, 'bad-scope-hash', 'superuser', now() + interval '1 day')`, [userId]);
        })).rejects.toMatchObject({ code: '23514' });
    });
    it('revoke sets revoked_at and replaced_by', async () => {
        const expiresAt = new Date(Date.now() + 60_000);
        const first = await repo.create({ userId, tokenHash: 'chain-1', scope: 'admin', expiresAt });
        const second = await repo.create({ userId, tokenHash: 'chain-2', scope: 'admin', expiresAt });
        await repo.revoke(first.id, second.id);
        const reloaded = await repo.findByHash('chain-1');
        expect(reloaded?.revokedAt).not.toBeNull();
        expect(reloaded?.replacedBy).toBe(second.id);
    });
    it('revoke on an already-revoked row is a no-op (idempotent)', async () => {
        const expiresAt = new Date(Date.now() + 60_000);
        const token = await repo.create({ userId, tokenHash: 'idem-1', scope: 'admin', expiresAt });
        await repo.revoke(token.id, null);
        const firstRevokedAt = (await repo.findByHash('idem-1')).revokedAt;
        await repo.revoke(token.id, null);
        const secondRevokedAt = (await repo.findByHash('idem-1')).revokedAt;
        expect(secondRevokedAt?.getTime()).toBe(firstRevokedAt?.getTime());
    });
    it('revokeAllForUser revokes every live token for that user and no other', async () => {
        const other = await users.create({ role: 'MANAGER', userIdentifier: 'mgr01', passwordHash: 'hash' });
        const expiresAt = new Date(Date.now() + 60_000);
        await repo.create({ userId, tokenHash: 'user-a', scope: 'admin', expiresAt });
        await repo.create({ userId, tokenHash: 'user-b', scope: 'admin', expiresAt });
        await repo.create({ userId: other.id, tokenHash: 'other-a', scope: 'admin', expiresAt });
        await repo.revokeAllForUser(userId);
        expect((await repo.findByHash('user-a'))?.revokedAt).not.toBeNull();
        expect((await repo.findByHash('user-b'))?.revokedAt).not.toBeNull();
        expect((await repo.findByHash('other-a'))?.revokedAt).toBeNull();
    });
    it('deleting the user cascades its refresh tokens away (ON DELETE CASCADE)', async () => {
        const expiresAt = new Date(Date.now() + 60_000);
        await repo.create({ userId, tokenHash: 'cascade-1', scope: 'admin', expiresAt });
        await withTransaction(async (c) => {
            await c.query('DELETE FROM users WHERE id = $1', [userId]);
        });
        expect(await repo.findByHash('cascade-1')).toBeNull();
    });
});
