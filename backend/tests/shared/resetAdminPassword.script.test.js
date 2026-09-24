import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
/**
 * Spec 03 — `npm run admin:reset-password` (§Backend work "Out-of-band Admin
 * password reset", open question 4).
 *
 * Coverage-map trap: "`npm run admin:reset-password` is a CLI, not an
 * endpoint. Test the script's function directly: it is scoped to
 * `is_system_admin`, forces a password change, revokes sessions, and writes
 * an `OUT_OF_BAND_ADMIN_RESET` audit row. Also assert that no HTTP route
 * exposes it." The second half is covered by `adminHttpSurface.invariants.test.ts`.
 */
const execFileAsync = promisify(execFile);
const SCHEMA = 'spec03_resetpw';
const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));
const TSX_CLI = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
async function runResetScript(env) {
    return execFileAsync(process.execPath, [TSX_CLI, 'scripts/resetAdminPassword.ts'], {
        cwd: BACKEND_DIR,
        env: { ...process.env, ...env },
    });
}
describe.skipIf(!TEST_DATABASE_URL)('admin:reset-password script', () => {
    let db;
    let systemAdminId;
    let managerId;
    beforeAll(async () => {
        await resetSchema(SCHEMA);
        db = new pg.Client({ connectionString: scopedUrl(SCHEMA) });
        await db.connect();
    }, 60_000);
    afterAll(async () => {
        await db?.end();
        await dropSchema(SCHEMA);
    });
    beforeEach(async () => {
        await db.query('DELETE FROM refresh_tokens');
        await db.query('DELETE FROM audit_logs');
        await db.query('DELETE FROM users');
        const sysAdmin = await db.query(`INSERT INTO users (role, user_identifier, password_hash, is_system_admin, must_change_password)
       VALUES ('ADMIN', 'reset-sysadmin', 'old-hash', true, false) RETURNING id`);
        systemAdminId = sysAdmin.rows[0].id;
        const manager = await db.query(`INSERT INTO users (role, user_identifier, password_hash, must_change_password)
       VALUES ('MANAGER', 'reset-manager', 'mgr-hash', false) RETURNING id`);
        managerId = manager.rows[0].id;
    });
    it('refuses to run without SUPABASE_SERVICE_ROLE_KEY', async () => {
        await expect(runResetScript({
            DATABASE_URL: scopedUrl(SCHEMA),
            SUPABASE_SERVICE_ROLE_KEY: '',
            ADMIN_RESET_PASSWORD: 'NewResetPassword12',
        })).rejects.toMatchObject({ code: 1 });
        const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [systemAdminId]);
        expect(rows[0].password_hash).toBe('old-hash');
    });
    it('resets only the is_system_admin row, sets must_change_password, and never touches a Manager', async () => {
        await runResetScript({
            DATABASE_URL: scopedUrl(SCHEMA),
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
            ADMIN_RESET_PASSWORD: 'NewResetPassword12',
        });
        const { rows } = await db.query(`SELECT password_hash, must_change_password FROM users WHERE id = $1`, [systemAdminId]);
        expect(rows[0].password_hash).not.toBe('old-hash');
        expect(rows[0].password_hash.startsWith('$2')).toBe(true);
        expect(rows[0].must_change_password).toBe(true);
        const { rows: mgrRows } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [managerId]);
        expect(mgrRows[0].password_hash).toBe('mgr-hash');
    });
    it('revokes every existing refresh_tokens row for the system Admin', async () => {
        await db.query(`INSERT INTO refresh_tokens (user_id, token_hash, scope, expires_at)
       VALUES ($1, 'reset-token-hash', 'admin', now() + interval '7 days')`, [systemAdminId]);
        await runResetScript({
            DATABASE_URL: scopedUrl(SCHEMA),
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
            ADMIN_RESET_PASSWORD: 'NewResetPassword12',
        });
        const { rows } = await db.query(`SELECT count(*)::text AS count FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [systemAdminId]);
        expect(rows[0].count).toBe('0');
    });
    it('writes an OUT_OF_BAND_ADMIN_RESET audit row with actor_type SYSTEM (§5.15 rule 10)', async () => {
        await runResetScript({
            DATABASE_URL: scopedUrl(SCHEMA),
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
            ADMIN_RESET_PASSWORD: 'NewResetPassword12',
        });
        const { rows } = await db.query(`SELECT actor_type, entity_id FROM audit_logs WHERE action = 'OUT_OF_BAND_ADMIN_RESET'`);
        expect(rows).toHaveLength(1);
        expect(rows[0].actor_type).toBe('SYSTEM');
        expect(rows[0].entity_id).toBe(systemAdminId);
    });
    it('fails with no system Admin present and creates nothing', async () => {
        await db.query('DELETE FROM users');
        await expect(runResetScript({
            DATABASE_URL: scopedUrl(SCHEMA),
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
            ADMIN_RESET_PASSWORD: 'NewResetPassword12',
        })).rejects.toMatchObject({ code: 1 });
        const { rows } = await db.query(`SELECT count(*)::text AS count FROM users`);
        expect(rows[0].count).toBe('0');
    });
    it('rejects a weak password without changing the stored hash', async () => {
        await expect(runResetScript({
            DATABASE_URL: scopedUrl(SCHEMA),
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
            ADMIN_RESET_PASSWORD: 'short1',
        })).rejects.toMatchObject({ code: 1 });
        const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [systemAdminId]);
        expect(rows[0].password_hash).toBe('old-hash');
    });
    it('never prints the new password to stdout or stderr', async () => {
        const { stdout, stderr } = await runResetScript({
            DATABASE_URL: scopedUrl(SCHEMA),
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
            ADMIN_RESET_PASSWORD: 'NoLeakResetPassword12',
        });
        expect(stdout).not.toContain('NoLeakResetPassword12');
        expect(stderr).not.toContain('NoLeakResetPassword12');
    });
});
