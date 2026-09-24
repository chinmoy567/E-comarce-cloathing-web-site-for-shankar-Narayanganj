import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_CUSTOMER, TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl, } from '../helpers/schemaFixture.ts';
import { resetEnvCache } from '../../src/config/env.ts';
/**
 * Spec 02 — `users` repository (06-rbac §5.19, 02-customer §2.1/§2.8).
 *
 * The repository is the only way application code reaches a login identity, so
 * what it refuses to do matters as much as what it does: it must not expose
 * `is_system_admin` or `role`/`customer_id` as writable fields, and it must not
 * hand the password hash to a non-auth caller. Those are properties of the
 * module's shape, checked here alongside the round-trips that need a real
 * database.
 */
const SCHEMA = 'spec02_users_repo';
describe.skipIf(!TEST_DATABASE_URL)('users repository', () => {
    let repo;
    let withTransaction;
    let resetTransactionPool;
    /** A customer row to hang CUSTOMER logins off, recreated per test. */
    let customerId;
    beforeAll(async () => {
        await resetSchema(SCHEMA);
        process.env.DATABASE_URL = scopedUrl(SCHEMA);
        resetEnvCache();
        ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
        await resetTransactionPool();
        repo = await import('../../src/repositories/users.repository.js');
    }, 60_000);
    afterAll(async () => {
        await resetTransactionPool?.();
        await dropSchema(SCHEMA);
    });
    beforeEach(async () => {
        const customers = await import('../../src/repositories/customers.repository.js');
        await withTransaction(async (c) => {
            // users first: customers is the FK parent.
            await c.query('DELETE FROM users');
            await c.query('DELETE FROM customers');
        });
        const customer = await customers.upsertByPhoneNumber(SAMPLE_CUSTOMER);
        customerId = customer.id;
    });
    describe('create (§2.8, §2.1)', () => {
        it('creates an Admin identity keyed by user identifier', async () => {
            const user = await repo.create({
                role: 'ADMIN',
                userIdentifier: 'admin01',
                passwordHash: 'hash',
            });
            expect(user.role).toBe('ADMIN');
            expect(user.userIdentifier).toBe('admin01');
            expect(user.customerId).toBeNull();
            // Neither flag is caller-supplied: both come from the column defaults.
            expect(user.isSystemAdmin).toBe(false);
            expect(user.isActive).toBe(true);
        });
        it('creates a registered-customer identity bound to its customer row', async () => {
            const user = await repo.create({
                role: 'CUSTOMER',
                phoneNumber: SAMPLE_CUSTOMER.phoneNumber,
                customerId,
                passwordHash: 'hash',
            });
            expect(user.role).toBe('CUSTOMER');
            expect(user.customerId).toBe(customerId);
            expect(user.userIdentifier).toBeNull();
        });
        it('normalizes the phone number before storing it (§2.9.4)', async () => {
            // Stored in one canonical form regardless of the caller's format, which
            // is what makes the UNIQUE(phone_number) rule in §2.1 actually bite.
            const user = await repo.create({
                role: 'CUSTOMER',
                phoneNumber: '+8801712345678',
                customerId,
                passwordHash: 'hash',
            });
            expect(user.phoneNumber).toBe('01712345678');
        });
        it('rejects a second account on the same mobile number (§2.1)', async () => {
            const second = await import('../../src/repositories/customers.repository.js').then((m) => m.upsertByPhoneNumber({ ...SAMPLE_CUSTOMER, phoneNumber: '01812345678' }));
            await repo.create({
                role: 'CUSTOMER',
                phoneNumber: '01712345678',
                customerId,
                passwordHash: 'hash',
            });
            // A different customer row, but the same login phone number.
            await expect(repo.create({
                role: 'CUSTOMER',
                phoneNumber: '+8801712345678',
                customerId: second.id,
                passwordHash: 'hash',
            })).rejects.toMatchObject({ code: 'USER_PHONE_EXISTS', status: 409 });
        });
        it('rejects a duplicate user identifier with USER_IDENTIFIER_EXISTS', async () => {
            await repo.create({ role: 'MANAGER', userIdentifier: 'mgr01', passwordHash: 'hash' });
            await expect(repo.create({ role: 'MANAGER', userIdentifier: 'mgr01', passwordHash: 'hash' })).rejects.toMatchObject({ code: 'USER_IDENTIFIER_EXISTS', status: 409 });
        });
        it('rejects a second login identity for one customer record (§2.9.8)', async () => {
            await repo.create({
                role: 'CUSTOMER',
                phoneNumber: '01712345678',
                customerId,
                passwordHash: 'hash',
            });
            await expect(repo.create({
                role: 'CUSTOMER',
                phoneNumber: '01812345678',
                customerId,
                passwordHash: 'hash',
            })).rejects.toMatchObject({ status: 409 });
        });
        it('lets the database refuse a malformed role shape (§5.19)', async () => {
            // The CHECK is the enforcement point, not an application guard: an ADMIN
            // must never carry a customer_id, whatever the caller passes.
            await expect(repo.create({
                role: 'ADMIN',
                userIdentifier: 'admin02',
                customerId,
                passwordHash: 'hash',
            })).rejects.toThrow();
            await expect(repo.create({ role: 'CUSTOMER', phoneNumber: '01912345678', passwordHash: 'hash' })).rejects.toThrow();
        });
        it('exposes no way to mint a system admin (§5.12.3)', async () => {
            // is_system_admin is seed-only. If `create` ever accepted it, an
            // API-reachable path could create a protected account.
            const user = await repo.create({
                role: 'ADMIN',
                userIdentifier: 'admin03',
                passwordHash: 'hash',
                // @ts-expect-error — the input type must not admit this field.
                isSystemAdmin: true,
            });
            expect(user.isSystemAdmin).toBe(false);
        });
    });
    describe('lookups', () => {
        it('findByUserIdentifier returns the hash for auth', async () => {
            await repo.create({ role: 'MANAGER', userIdentifier: 'mgr02', passwordHash: 'stored-hash' });
            const found = await repo.findByUserIdentifier('mgr02');
            expect(found?.passwordHash).toBe('stored-hash');
        });
        it('findByPhoneNumber matches any accepted phone format', async () => {
            await repo.create({
                role: 'CUSTOMER',
                phoneNumber: '01712345678',
                customerId,
                passwordHash: 'stored-hash',
            });
            for (const input of ['01712345678', '8801712345678', '+8801712345678']) {
                const found = await repo.findByPhoneNumber(input);
                expect(found?.customerId).toBe(customerId);
            }
        });
        it('findById never returns the password hash (§5.12.1)', async () => {
            const created = await repo.create({
                role: 'MANAGER',
                userIdentifier: 'mgr03',
                passwordHash: 'stored-hash',
            });
            const found = await repo.findById(created.id);
            expect(found).not.toBeNull();
            expect(found).not.toHaveProperty('passwordHash');
            expect(JSON.stringify(found)).not.toContain('stored-hash');
        });
        it('returns null for identifiers that do not exist', async () => {
            expect(await repo.findByUserIdentifier('nobody')).toBeNull();
            expect(await repo.findByPhoneNumber('01999999999')).toBeNull();
            expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
        });
    });
    describe('update', () => {
        it('updates the mutable fields and bumps updated_at', async () => {
            const created = await repo.create({
                role: 'MANAGER',
                userIdentifier: 'mgr04',
                passwordHash: 'hash',
                mustChangePassword: true,
            });
            const when = new Date('2026-01-01T00:00:00.000Z');
            const updated = await repo.update(created.id, {
                email: 'mgr04@example.com',
                isActive: false,
                mustChangePassword: false,
                lastLoginAt: when,
            });
            expect(updated?.email).toBe('mgr04@example.com');
            expect(updated?.isActive).toBe(false);
            expect(updated?.mustChangePassword).toBe(false);
            expect(updated?.lastLoginAt?.toISOString()).toBe(when.toISOString());
            expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
        });
        it('does not admit role, customerId, or isSystemAdmin as updatable', async () => {
            const created = await repo.create({
                role: 'MANAGER',
                userIdentifier: 'mgr05',
                passwordHash: 'hash',
            });
            const updated = await repo.update(created.id, {
                // @ts-expect-error — crossing the customer/back-office boundary.
                role: 'ADMIN',
                customerId,
                isSystemAdmin: true,
            });
            expect(updated?.role).toBe('MANAGER');
            expect(updated?.customerId).toBeNull();
            expect(updated?.isSystemAdmin).toBe(false);
        });
        it('returns null for an unknown id', async () => {
            const result = await repo.update('00000000-0000-0000-0000-000000000000', {
                isActive: false,
            });
            expect(result).toBeNull();
        });
        it('treats an empty patch as a read rather than a no-column UPDATE', async () => {
            const created = await repo.create({
                role: 'MANAGER',
                userIdentifier: 'mgr06',
                passwordHash: 'hash',
            });
            const updated = await repo.update(created.id, {});
            expect(updated?.id).toBe(created.id);
        });
    });
    describe('listManagers', () => {
        it('returns only MANAGER rows, newest first, with the full total', async () => {
            await repo.create({ role: 'ADMIN', userIdentifier: 'admin10', passwordHash: 'hash' });
            await repo.create({
                role: 'CUSTOMER',
                phoneNumber: '01712345678',
                customerId,
                passwordHash: 'hash',
            });
            for (const id of ['m1', 'm2', 'm3']) {
                await repo.create({ role: 'MANAGER', userIdentifier: id, passwordHash: 'hash' });
            }
            const page = await repo.listManagers({ page: 1, pageSize: 2 });
            expect(page.items).toHaveLength(2);
            expect(page.items.every((u) => u.role === 'MANAGER')).toBe(true);
            // The total counts every manager, not just the page.
            expect(page.total).toBe(3);
        });
        it('pages without repeating a row', async () => {
            for (const id of ['p1', 'p2', 'p3']) {
                await repo.create({ role: 'MANAGER', userIdentifier: id, passwordHash: 'hash' });
            }
            const first = await repo.listManagers({ page: 1, pageSize: 2 });
            const second = await repo.listManagers({ page: 2, pageSize: 2 });
            expect(second.items).toHaveLength(1);
            const ids = [...first.items, ...second.items].map((u) => u.id);
            expect(new Set(ids).size).toBe(3);
        });
    });
});
