import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getEnv } from '../src/config/env.js';
/**
 * Loads the official Bangladesh administrative geography dataset.
 *
 * Reproducible, deterministic, versionable, idempotent, and safe to re-run
 * (task §12):
 *
 * - **Reproducible / versionable** — the rows come from a committed dataset
 *   file, `data/geography/bd-adm-cod-v03.json`, generated from the published
 *   OCHA COD-AB v03 workbook. The file carries its own `source` block naming
 *   the publisher, version and retrieval date, so what was loaded is always
 *   answerable. Regenerating it is a reviewable diff, not a silent change.
 * - **Deterministic** — rows are applied in official P-code order.
 * - **Idempotent** — every statement is an upsert keyed on the official
 *   `pcode`, so a second run updates names in place and inserts nothing new.
 *   Re-running never duplicates a row and never reassigns a uuid, which matters
 *   because `customers.division_id` and the courier mappings reference those
 *   uuids: a seed that recreated rows would orphan them.
 * - **Safe** — the whole load is one transaction, so a partial dataset is never
 *   visible; and it only ever inserts or updates, never deletes.
 *
 * This is deliberately NOT thousands of INSERT statements in a migration file:
 * the dataset is maintained upstream and will be re-published, so it belongs in
 * a re-runnable loader rather than frozen into forward-only migration history.
 */
const DATA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/geography/bd-adm-cod-v03.json');
export async function seedGeography(connectionString) {
    const url = connectionString ?? getEnv().DATABASE_URL;
    const dataset = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    // A malformed or truncated dataset file must fail loudly rather than seed a
    // partial hierarchy that later looks like missing districts.
    if (!dataset.divisions?.length || !dataset.districts?.length || !dataset.upazilas?.length) {
        throw new Error('Geography dataset is empty or malformed.');
    }
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        await client.query('BEGIN');
        // ON CONFLICT (pcode): the official identifier is the natural key, so a
        // re-run updates the name of an existing row instead of inserting a second
        // one. The uuid primary key is generated once and never changes.
        for (const division of dataset.divisions) {
            await client.query(`INSERT INTO geo_divisions (pcode, name) VALUES ($1, $2)
         ON CONFLICT (pcode) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`, [division.pcode, division.name]);
        }
        // The parent is resolved by its pcode in the same statement, so the seed
        // never carries uuids and a re-run cannot attach a child to a stale parent.
        for (const district of dataset.districts) {
            await client.query(`INSERT INTO geo_districts (pcode, name, division_id)
         SELECT $1, $2, d.id FROM geo_divisions d WHERE d.pcode = $3
         ON CONFLICT (pcode) DO UPDATE
           SET name = EXCLUDED.name, division_id = EXCLUDED.division_id, updated_at = now()`, [district.pcode, district.name, district.division_pcode]);
        }
        for (const upazila of dataset.upazilas) {
            await client.query(`INSERT INTO geo_upazilas (pcode, name, district_id, division_id)
         SELECT $1, $2, t.id, t.division_id FROM geo_districts t WHERE t.pcode = $3
         ON CONFLICT (pcode) DO UPDATE
           SET name = EXCLUDED.name,
               district_id = EXCLUDED.district_id,
               division_id = EXCLUDED.division_id,
               updated_at = now()`, [upazila.pcode, upazila.name, upazila.district_pcode]);
        }
        // Every dataset row must have landed. A row silently skipped because its
        // parent pcode was missing would produce a quietly incomplete hierarchy —
        // exactly the failure that is hardest to notice later, so it aborts here.
        const counts = await client.query(`SELECT (SELECT count(*) FROM geo_divisions) AS divisions,
              (SELECT count(*) FROM geo_districts) AS districts,
              (SELECT count(*) FROM geo_upazilas)  AS upazilas`);
        const row = counts.rows[0];
        if (!row)
            throw new Error('Geography seed verification returned no counts.');
        const actual = {
            divisions: Number(row.divisions),
            districts: Number(row.districts),
            upazilas: Number(row.upazilas),
        };
        if (actual.divisions !== dataset.divisions.length ||
            actual.districts !== dataset.districts.length ||
            actual.upazilas !== dataset.upazilas.length) {
            throw new Error(`Geography seed mismatch: expected ${dataset.divisions.length}/${dataset.districts.length}/${dataset.upazilas.length}, ` +
                `found ${actual.divisions}/${actual.districts}/${actual.upazilas}.`);
        }
        await client.query('COMMIT');
        return { ...actual, version: dataset.source.version ?? 'unknown' };
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        await client.end();
    }
}
// Executed directly (npm run seed:geography), not when imported by a test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    seedGeography()
        .then((result) => {
        console.log(`geography ${result.version}: ${result.divisions} divisions, ` +
            `${result.districts} districts, ${result.upazilas} upazilas.`);
        process.exit(0);
    })
        .catch((err) => {
        console.error(err instanceof Error ? err.message : 'Geography seed failed');
        process.exit(1);
    });
}
