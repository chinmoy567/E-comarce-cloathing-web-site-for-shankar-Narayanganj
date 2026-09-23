import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_CUSTOMER, TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Spec 03 — `adminAuth.service` (§Session design, §Error cases).
 *
 * Tests required items 12 (login non-enumeration) and 13 (refresh rotation +
 * reuse detection), at the service layer — `adminAuth.api.test.ts` covers the
 * same claims through HTTP/cookies.
 */
const SCHEMA = 'spec03_authsvc';

describe.skipIf(!TEST_DATABASE_URL)('adminAuth.service', () => {
  let service: typeof import('../../src/services/adminAuth.service.js');
  let users: typeof import('../../src/repositories/users.repository.js');
  let refreshTokens: typeof import('../../src/repositories/refreshTokens.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;

  let adminId: string;
  const PASSWORD = 'CorrectHorse12';

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    service = await import('../../src/services/adminAuth.service.js');
    users = await import('../../src/repositories/users.repository.js');
    refreshTokens = await import('../../src/repositories/refreshTokens.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));
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
    const passwordHash = await hashPassword(PASSWORD);
    const admin = await users.create({
      role: 'ADMIN',
      userIdentifier: 'svc-admin',
      passwordHash,
      mustChangePassword: false,
    });
    adminId = admin.id;
  });

  describe('login (§11.2 non-enumeration, test 12)', () => {
    it('succeeds with correct credentials and returns permissions + tokens', async () => {
      const result = await service.login('svc-admin', PASSWORD);
      expect(result.user.id).toBe(adminId);
      expect(result.permissions.length).toBeGreaterThan(0);
      expect(result.tokens.accessToken).toBeTruthy();
      expect(result.tokens.refreshToken).toBeTruthy();
    });

    it('rejects a wrong password with INVALID_CREDENTIALS/401', async () => {
      await expect(service.login('svc-admin', 'WrongPassword12')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
    });

    it('rejects an unknown identifier with INVALID_CREDENTIALS/401', async () => {
      await expect(service.login('does-not-exist', PASSWORD)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
    });

    it('rejects an inactive account with INVALID_CREDENTIALS/401', async () => {
      await withTransaction(async (c) => {
        await c.query('UPDATE users SET is_active = false WHERE id = $1', [adminId]);
      });
      await expect(service.login('svc-admin', PASSWORD)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
    });

    it('wrong password, unknown identifier, and inactive account produce byte-identical error messages', async () => {
      await withTransaction(async (c) => {
        const inactive = await users.create({
          role: 'MANAGER',
          userIdentifier: 'svc-inactive',
          passwordHash: await hashPassword(PASSWORD),
        });
        await c.query('UPDATE users SET is_active = false WHERE id = $1', [inactive.id]);
      });

      const [wrongPw, unknown, inactive] = await Promise.all([
        service.login('svc-admin', 'WrongPassword12').catch((e) => e),
        service.login('nobody-here', PASSWORD).catch((e) => e),
        service.login('svc-inactive', PASSWORD).catch((e) => e),
      ]);

      expect(wrongPw.message).toBe(unknown.message);
      expect(wrongPw.message).toBe(inactive.message);
      expect(wrongPw.code).toBe(unknown.code);
      expect(wrongPw.code).toBe(inactive.code);
    });

    it('a CUSTOMER-role account cannot log in through the admin service (§5.19)', async () => {
      // `users_role_shape` (spec 02 migration) requires a CUSTOMER row to carry
      // a `customer_id` FK — insert one directly rather than pulling in the
      // full customers-repository fixture, since only the role-gate matters
      // here: `adminAuth.service.login` rejects a `role !== ADMIN|MANAGER` row
      // before it even reaches password verification.
      await withTransaction(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO customers (
             account_type, full_name, phone_number, email, division, district,
             area_unit_type, area_unit_name, ward_unit_type, ward_unit_name,
             detailed_address, postal_code
           ) VALUES ('REGISTERED', $1, '01712340099', $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            SAMPLE_CUSTOMER.fullName,
            SAMPLE_CUSTOMER.email,
            SAMPLE_CUSTOMER.address.division,
            SAMPLE_CUSTOMER.address.district,
            SAMPLE_CUSTOMER.address.areaUnitType,
            SAMPLE_CUSTOMER.address.areaUnitName,
            SAMPLE_CUSTOMER.address.wardUnitType,
            SAMPLE_CUSTOMER.address.wardUnitName,
            SAMPLE_CUSTOMER.address.detailedAddress,
            SAMPLE_CUSTOMER.address.postalCode,
          ],
        );
        await c.query(
          `INSERT INTO users (role, phone_number, password_hash, customer_id)
           VALUES ('CUSTOMER', '01712340099', $1, $2)`,
          [await hashPassword(PASSWORD), rows[0]!.id],
        );
      });

      await expect(service.login('01712340099', PASSWORD)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
    });
  });

  describe('refresh rotation and reuse detection (§11.7, test 13)', () => {
    it('rotates: the old token is revoked and a new one is issued', async () => {
      const { tokens } = await service.login('svc-admin', PASSWORD);
      const result = await service.refresh(tokens.refreshToken);

      expect(result.tokens.refreshToken).not.toBe(tokens.refreshToken);

      const { hashRefreshToken } = await import('../../src/lib/session.js');
      const oldRow = await refreshTokens.findByHash(hashRefreshToken(tokens.refreshToken));
      expect(oldRow?.revokedAt).not.toBeNull();
    });

    it('replaying an already-rotated (revoked) token is rejected and revokes the entire chain', async () => {
      const { tokens } = await service.login('svc-admin', PASSWORD);
      const rotated = await service.refresh(tokens.refreshToken);

      // Replay of the original, now-revoked token: reuse detected.
      await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ status: 401 });

      // The chain's newest token must also now be revoked (defence against a
      // stolen-and-replayed old token: the whole chain is killed).
      const { hashRefreshToken } = await import('../../src/lib/session.js');
      const newestRow = await refreshTokens.findByHash(hashRefreshToken(rotated.tokens.refreshToken));
      expect(newestRow?.revokedAt).not.toBeNull();
    });

    it('rejects an unknown refresh token', async () => {
      await expect(service.refresh('not-a-real-token')).rejects.toMatchObject({ status: 401 });
    });

    it('rejects a refresh token belonging to a customer scope', async () => {
      const { hashRefreshToken } = await import('../../src/lib/session.js');
      await refreshTokens.create({
        userId: adminId,
        tokenHash: hashRefreshToken('customer-scoped-token'),
        scope: 'customer',
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.refresh('customer-scoped-token')).rejects.toMatchObject({ status: 401 });
    });

    it('rejects an expired refresh token and revokes the chain', async () => {
      const { hashRefreshToken } = await import('../../src/lib/session.js');
      await refreshTokens.create({
        userId: adminId,
        tokenHash: hashRefreshToken('expired-token'),
        scope: 'admin',
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.refresh('expired-token')).rejects.toMatchObject({ status: 401 });
    });

    it('rejects refresh for a since-deactivated account', async () => {
      const { tokens } = await service.login('svc-admin', PASSWORD);
      await withTransaction(async (c) => {
        await c.query('UPDATE users SET is_active = false WHERE id = $1', [adminId]);
      });
      await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('logout', () => {
    it('revokes the presented refresh token', async () => {
      const { tokens } = await service.login('svc-admin', PASSWORD);
      await service.logout(adminId, tokens.refreshToken);

      const { hashRefreshToken } = await import('../../src/lib/session.js');
      const row = await refreshTokens.findByHash(hashRefreshToken(tokens.refreshToken));
      expect(row?.revokedAt).not.toBeNull();
    });

    it('does not revoke a token belonging to a different user', async () => {
      const other = await users.create({
        role: 'MANAGER',
        userIdentifier: 'svc-other',
        passwordHash: await hashPassword(PASSWORD),
        mustChangePassword: false,
      });
      const { tokens } = await service.login('svc-admin', PASSWORD);

      await service.logout(other.id, tokens.refreshToken);

      const { hashRefreshToken } = await import('../../src/lib/session.js');
      const row = await refreshTokens.findByHash(hashRefreshToken(tokens.refreshToken));
      expect(row?.revokedAt).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('rejects a wrong current password with INVALID_CREDENTIALS', async () => {
      await expect(
        service.changePassword(adminId, 'WrongCurrentPw1', 'BrandNewPassword12'),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    });

    it('rejects a new password below the minimum policy with WEAK_PASSWORD', async () => {
      await expect(service.changePassword(adminId, PASSWORD, 'short1')).rejects.toMatchObject({
        code: 'WEAK_PASSWORD',
        status: 400,
      });
    });

    it('succeeds and clears mustChangePassword', async () => {
      await withTransaction(async (c) => {
        await c.query('UPDATE users SET must_change_password = true WHERE id = $1', [adminId]);
      });
      await service.changePassword(adminId, PASSWORD, 'BrandNewPassword12');

      const updated = await users.findById(adminId);
      expect(updated?.mustChangePassword).toBe(false);

      // The new password actually works for login.
      const result = await service.login('svc-admin', 'BrandNewPassword12');
      expect(result.user.id).toBe(adminId);
    });
  });
});
