import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getEnv } from '../src/config/env.js';

/**
 * Forward-only migration runner (spec 01 §Migration runner).
 *
 * Each `NNNN_description.sql` file is applied in filename order, inside a
 * transaction, and recorded in `schema_migrations`. An already-recorded
 * migration is skipped, so repeated runs are safe and exit 0.
 *
 * Uses the direct PostgreSQL connection (DATABASE_URL) with parameterized
 * statements only — file contents are trusted repository files, identifiers
 * are never built from user input.
 */
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

const BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id         text        NOT NULL PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`;

export type MigrationResult = { applied: string[]; skipped: string[] };

export async function runMigrations(connectionString?: string): Promise<MigrationResult> {
  const url = connectionString ?? getEnv().DATABASE_URL;
  const client = new pg.Client({ connectionString: url });
  const applied: string[] = [];
  const skipped: string[] = [];

  await client.connect();
  try {
    await client.query(BOOTSTRAP_SQL);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
    const done = new Set(rows.map((row) => row.id));

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await client.end();
  }

  return { applied, skipped };
}

// Executed directly (npm run migrate), not when imported by a test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(({ applied, skipped }) => {
      for (const file of applied) console.log(`applied  ${file}`);
      for (const file of skipped) console.log(`skipped  ${file}`);
      console.log(`\n${applied.length} applied, ${skipped.length} already up to date.`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : 'Migration failed');
      process.exit(1);
    });
}
