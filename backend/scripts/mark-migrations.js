/**
 * One-time script: Mark pre-existing migrations (0003-0006) as applied.
 * Usage: node backend/scripts/mark-migrations.js
 *
 * The database schema was created outside the migration system, so these
 * objects exist but aren't tracked in schema_migrations. This marks them
 * so 0007+ can run normally.
 */

import pg from 'pg';
import { getEnv } from '../src/config/env.js';

const { DATABASE_URL } = getEnv();
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env.local');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

async function main() {
  await client.connect();
  try {
    const migrations = [
      '0003_admin_sessions.sql',
      '0004_security_events.sql',
      '0005_catalogue.sql',
      '0006_orders.sql',
    ];

    for (const file of migrations) {
      try {
        await client.query(
          'INSERT INTO schema_migrations (id) VALUES ($1)',
          [file]
        );
        console.log('✓ Marked as applied:', file);
      } catch (e) {
        if (e.code === '23505') {
          // Unique constraint violation — already applied
          console.log('  Already tracked:', file);
        } else {
          throw e;
        }
      }
    }

    console.log('\nReady to run: npm run migrate');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
