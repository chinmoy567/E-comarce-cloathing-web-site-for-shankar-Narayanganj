import pg from 'pg';
import { getEnv } from '../src/config/env.js';
import { hashPassword } from '../src/lib/password.js';
import { assertPasswordPolicy } from '../src/validation/password.validation.js';

/**
 * Creates the single protected system Admin from env vars (spec 03 §5.12.1).
 *
 * Idempotent (§5.12.2): `ON CONFLICT DO NOTHING` targets the partial unique
 * index `users_single_system_admin_key` from spec 02's migration, so
 * concurrent or repeated runs cannot produce a second Admin.
 *
 * The plaintext password never reaches a database column, a log line, or a
 * tracked file — only `SEED_ADMIN_USER_ID` is ever named in output.
 */
async function main(): Promise<void> {
  const userId = process.env.SEED_ADMIN_USER_ID;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!userId || !password) {
    console.error('SEED_ADMIN_USER_ID and SEED_ADMIN_PASSWORD must both be set');
    process.exitCode = 1;
    return;
  }

  assertPasswordPolicy(password);

  const passwordHash = await hashPassword(password);

  const env = getEnv();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    const { rowCount } = await client.query(
      `INSERT INTO users (role, user_identifier, password_hash, is_system_admin, must_change_password)
       VALUES ('ADMIN', $1, $2, true, true)
       ON CONFLICT ((true)) WHERE is_system_admin DO NOTHING`,
      [userId, passwordHash],
    );

    if (rowCount && rowCount > 0) {
      console.log('System admin created.');
      await client.query(
        `INSERT INTO audit_logs (entity_type, action, actor_type)
         VALUES ('user', 'admin_seeded', 'SYSTEM')`,
      );
    } else {
      console.log('System admin already exists; no changes made.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : 'unknown error');
  process.exitCode = 1;
});
