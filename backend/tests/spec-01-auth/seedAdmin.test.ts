import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';

/**
 * Spec 03 §Backend work "Seed script", §5.12.1/§5.12.2 (idempotent, env-only,
 * never-logged), acceptance criteria 1–4, tests required item 7.
 *
 * The script has no exported function — it is a standalone CLI entry point
 * (`npm run seed:admin` -> `tsx scripts/seedAdmin.ts`) that reads
 * `SEED_ADMIN_USER_ID`/`SEED_ADMIN_PASSWORD` from its own process env and
 * connects directly with `pg.Client`, independent of `getEnv()`'s memoized
 * cache. Driving it as an actual child process is what proves its outputs
 * (exit code, stdout/stderr, and the absence of the plaintext password in
 * either stream) rather than the in-process behaviour of an imported function.
 */
const execFileAsync = promisify(execFile);
const SCHEMA = 'spec03_seed';

const PLAINTEXT_PASSWORD = 'Sup3rSecretSeed!';

const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));
// Invoke tsx's own CLI entry point with the current `node` binary directly,
// bypassing `npx`/a shell entirely — `npx` resolves to a `.cmd` shim on
// Windows that needs `cmd.exe` on PATH, which this sandboxed child process
// does not reliably inherit.
const TSX_CLI = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));

async function runSeedScript(env: Record<string, string | undefined>) {
  return execFileAsync(process.execPath, [TSX_CLI, 'scripts/seedAdmin.ts'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...env },
  });
}

describe.skipIf(!TEST_DATABASE_URL)('seed:admin script', () => {
  let db: pg.Client;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    db = await new pg.Client({ connectionString: scopedUrl(SCHEMA) });
    await db.connect();
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    await dropSchema(SCHEMA);
  });

  beforeEach(async () => {
    await db.query('DELETE FROM audit_logs');
    await db.query('DELETE FROM users');
  });

  it('creates exactly one ADMIN row with is_system_admin and must_change_password true (acceptance 1)', async () => {
    const { stdout } = await runSeedScript({
      DATABASE_URL: scopedUrl(SCHEMA),
      SEED_ADMIN_USER_ID: 'seedadmin01',
      SEED_ADMIN_PASSWORD: PLAINTEXT_PASSWORD,
    });

    expect(stdout).toContain('System admin created.');

    const { rows } = await db.query<{
      role: string;
      is_system_admin: boolean;
      must_change_password: boolean;
      user_identifier: string;
    }>(`SELECT role, is_system_admin, must_change_password, user_identifier FROM users WHERE role = 'ADMIN'`);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_system_admin).toBe(true);
    expect(rows[0]!.must_change_password).toBe(true);
    expect(rows[0]!.user_identifier).toBe('seedadmin01');
  });

  it('appends an audit_logs row with actor_type SYSTEM, action admin_seeded', async () => {
    await runSeedScript({
      DATABASE_URL: scopedUrl(SCHEMA),
      SEED_ADMIN_USER_ID: 'seedadmin02',
      SEED_ADMIN_PASSWORD: PLAINTEXT_PASSWORD,
    });

    const { rows } = await db.query<{ actor_type: string; action: string }>(
      `SELECT actor_type, action FROM audit_logs WHERE action = 'admin_seeded'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_type).toBe('SYSTEM');
  });

  it('running the seed a second time prints "already exists", exits 0, still exactly one Admin (acceptance 2)', async () => {
    const env = {
      DATABASE_URL: scopedUrl(SCHEMA),
      SEED_ADMIN_USER_ID: 'seedadmin03',
      SEED_ADMIN_PASSWORD: PLAINTEXT_PASSWORD,
    };
    await runSeedScript(env);
    const second = await runSeedScript(env);

    expect(second.stdout).toContain('System admin already exists; no changes made.');

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE role = 'ADMIN'`,
    );
    expect(rows[0]!.count).toBe('1');
  });

  it('running the seed with a different SEED_ADMIN_USER_ID a second time still does not create a second Admin', async () => {
    await runSeedScript({
      DATABASE_URL: scopedUrl(SCHEMA),
      SEED_ADMIN_USER_ID: 'first-admin',
      SEED_ADMIN_PASSWORD: PLAINTEXT_PASSWORD,
    });
    await runSeedScript({
      DATABASE_URL: scopedUrl(SCHEMA),
      SEED_ADMIN_USER_ID: 'second-admin-attempt',
      SEED_ADMIN_PASSWORD: PLAINTEXT_PASSWORD,
    });

    const { rows } = await db.query<{ user_identifier: string }>(
      `SELECT user_identifier FROM users WHERE role = 'ADMIN'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_identifier).toBe('first-admin');
  });

  it('concurrent seed runs produce exactly one Admin (§5.12.2, test 7)', async () => {
    const env = {
      DATABASE_URL: scopedUrl(SCHEMA),
      SEED_ADMIN_USER_ID: 'concurrent-admin',
      SEED_ADMIN_PASSWORD: PLAINTEXT_PASSWORD,
    };

    const results = await Promise.allSettled([runSeedScript(env), runSeedScript(env), runSeedScript(env)]);
    for (const r of results) {
      expect(r.status).toBe('fulfilled'); // no run should exit non-zero
    }

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE role = 'ADMIN'`,
    );
    expect(rows[0]!.count).toBe('1');
  });

  // The script's own import chain calls `getEnv()`, which runs `dotenv.config()`
  // and re-populates any *absent* key from `backend/.env` (which has
  // development SEED_ADMIN_* values). Passing an empty string, not `undefined`,
  // is what actually reaches the script as "present but empty" — `undefined`
  // would just let dotenv silently refill it from `.env`, testing the wrong
  // thing.
  it('exits non-zero naming the missing variable when SEED_ADMIN_PASSWORD is unset, and prints no value (acceptance 3, 4)', async () => {
    await expect(
      runSeedScript({
        DATABASE_URL: scopedUrl(SCHEMA),
        SEED_ADMIN_USER_ID: 'no-password-admin',
        SEED_ADMIN_PASSWORD: '',
      }),
    ).rejects.toMatchObject({ code: 1 });

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE user_identifier = 'no-password-admin'`,
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('exits non-zero naming the missing variable when SEED_ADMIN_USER_ID is unset', async () => {
    await expect(
      runSeedScript({
        DATABASE_URL: scopedUrl(SCHEMA),
        SEED_ADMIN_USER_ID: '',
        SEED_ADMIN_PASSWORD: PLAINTEXT_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 1 });
  });

  it('the error message names both variables and never echoes a value', async () => {
    try {
      await runSeedScript({
        DATABASE_URL: scopedUrl(SCHEMA),
        SEED_ADMIN_USER_ID: '',
        SEED_ADMIN_PASSWORD: '',
      });
      throw new Error('expected the seed script to exit non-zero');
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? '';
      expect(stderr).toContain('SEED_ADMIN_USER_ID');
      expect(stderr).toContain('SEED_ADMIN_PASSWORD');
    }
  });

  it('rejects a password below the minimum policy without creating a row (§11.7)', async () => {
    await expect(
      runSeedScript({
        DATABASE_URL: scopedUrl(SCHEMA),
        SEED_ADMIN_USER_ID: 'weak-pw-admin',
        SEED_ADMIN_PASSWORD: 'short1',
      }),
    ).rejects.toMatchObject({ code: 1 });

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE user_identifier = 'weak-pw-admin'`,
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('never prints the plaintext password to stdout or stderr (acceptance 4)', async () => {
    const { stdout, stderr } = await runSeedScript({
      DATABASE_URL: scopedUrl(SCHEMA),
      SEED_ADMIN_USER_ID: 'no-leak-admin',
      SEED_ADMIN_PASSWORD: PLAINTEXT_PASSWORD,
    });
    expect(stdout).not.toContain(PLAINTEXT_PASSWORD);
    expect(stderr).not.toContain(PLAINTEXT_PASSWORD);
  });

  it('never stores the plaintext password in the database (§5.12.1)', async () => {
    await runSeedScript({
      DATABASE_URL: scopedUrl(SCHEMA),
      SEED_ADMIN_USER_ID: 'hash-check-admin',
      SEED_ADMIN_PASSWORD: PLAINTEXT_PASSWORD,
    });

    const { rows } = await db.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE user_identifier = 'hash-check-admin'`,
    );
    expect(rows[0]!.password_hash).not.toBe(PLAINTEXT_PASSWORD);
    expect(rows[0]!.password_hash).not.toContain(PLAINTEXT_PASSWORD);
    expect(rows[0]!.password_hash.startsWith('$2')).toBe(true); // bcrypt
  });
});
