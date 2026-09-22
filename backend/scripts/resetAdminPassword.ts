import { createInterface } from 'node:readline/promises';
import pg from 'pg';
import { getEnv } from '../src/config/env.js';
import { hashPassword } from '../src/lib/password.js';
import { assertPasswordPolicy } from '../src/validation/password.validation.js';

/**
 * Out-of-band recovery for the seeded Admin's password (spec 03 §Backend work,
 * open question 4). Deliberately NOT an HTTP endpoint — a network-reachable
 * admin reset is a far larger attack surface than the problem it solves.
 *
 * Refuses to run unless `SUPABASE_SERVICE_ROLE_KEY` is present: the operator
 * must already hold database-level access, so this grants no privilege they
 * lack. Scoped to `is_system_admin = true` — it can never touch a Manager,
 * create an account, or change a role.
 */
async function readPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_RESET_PASSWORD;
  if (fromEnv) return fromEnv;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question('New Admin password: ');
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Refusing to run: SUPABASE_SERVICE_ROLE_KEY is not set.');
    process.exitCode = 1;
    return;
  }

  const password = await readPassword();
  if (!password) {
    console.error('A new password is required.');
    process.exitCode = 1;
    return;
  }

  assertPasswordPolicy(password);
  const passwordHash = await hashPassword(password);

  const env = getEnv();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ id: string }>(
      `UPDATE users SET password_hash = $1, must_change_password = true
        WHERE is_system_admin = true
        RETURNING id`,
      [passwordHash],
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      console.error('No system admin exists. Run `npm run seed:admin` first.');
      process.exitCode = 1;
      return;
    }

    const adminId = rows[0]!.id;

    // Recovery assumes the previous credential may be compromised.
    await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [adminId]);

    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, actor_type)
       VALUES ('user', $1, 'OUT_OF_BAND_ADMIN_RESET', 'SYSTEM')`,
      [adminId],
    );

    await client.query('COMMIT');
    console.log('System admin password reset; the account must change it at next login.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Reset failed:', err instanceof Error ? err.message : 'unknown error');
  process.exitCode = 1;
});
