import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getEnv } from '../src/config/env.js';
/** Normalizes for comparison only — never written back to the row. */
function normalize(value) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
export async function backfillCustomerGeography(options = {}) {
    const url = options.connectionString ?? getEnv().DATABASE_URL;
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        const { rows: customers } = await client.query(`SELECT id, division, district, area_unit_name
         FROM customers
        WHERE division_id IS NULL`);
        const { rows: geo } = await client.query(`SELECT u.id AS upazila_id, u.name AS upazila_name,
              t.id AS district_id, t.name AS district_name,
              d.id AS division_id, d.name AS division_name
         FROM geo_upazilas u
         JOIN geo_districts t ON t.id = u.district_id
         JOIN geo_divisions d ON d.id = t.division_id`);
        // Key on the full chain: a bare upazila name is not unique nationally, so
        // matching on it alone is exactly the ambiguity this script must refuse.
        const byChain = new Map();
        for (const row of geo) {
            const key = `${normalize(row.division_name)}|${normalize(row.district_name)}|${normalize(row.upazila_name)}`;
            const bucket = byChain.get(key);
            if (bucket)
                bucket.push(row);
            else
                byChain.set(key, [row]);
        }
        const unresolved = [];
        let matched = 0;
        let updated = 0;
        for (const customer of customers) {
            const key = `${normalize(customer.division)}|${normalize(customer.district)}|${normalize(customer.area_unit_name)}`;
            const candidates = byChain.get(key);
            if (!candidates || candidates.length === 0) {
                unresolved.push({
                    id: customer.id,
                    division: customer.division,
                    district: customer.district,
                    areaUnitName: customer.area_unit_name,
                    reason: 'No official division/district/upazila chain matches this address text.',
                });
                continue;
            }
            if (candidates.length > 1) {
                unresolved.push({
                    id: customer.id,
                    division: customer.division,
                    district: customer.district,
                    areaUnitName: customer.area_unit_name,
                    reason: `Ambiguous: ${candidates.length} official entities match this text.`,
                });
                continue;
            }
            matched += 1;
            const match = candidates[0];
            if (!match)
                continue;
            if (options.apply) {
                // The composite FKs on `customers` re-check the chain at write time, so
                // even a bug in the matching above cannot store a mismatched triple.
                await client.query(`UPDATE customers
              SET division_id = $1, district_id = $2, upazila_id = $3, updated_at = now()
            WHERE id = $4 AND division_id IS NULL`, [match.division_id, match.district_id, match.upazila_id, customer.id]);
                updated += 1;
            }
        }
        return { total: customers.length, matched, updated, unresolved };
    }
    finally {
        await client.end();
    }
}
// Executed directly (npm run backfill:geography [-- --apply]).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const apply = process.argv.includes('--apply');
    backfillCustomerGeography({ apply })
        .then((result) => {
        console.log(`${apply ? 'APPLY' : 'DRY RUN'} — customers without geography ids: ${result.total}`);
        console.log(`matched unambiguously: ${result.matched}`);
        console.log(`updated: ${result.updated}`);
        if (result.unresolved.length > 0) {
            console.log(`\nUNRESOLVED (${result.unresolved.length}) — these need a human decision:`);
            for (const row of result.unresolved) {
                console.log(`  ${row.id}  "${row.division} / ${row.district} / ${row.areaUnitName}"  — ${row.reason}`);
            }
            console.log('\nNo geography was assigned to the rows above. Correct the address text, then re-run.');
        }
        if (!apply && result.matched > 0) {
            console.log('\nRe-run with `-- --apply` to write these matches.');
        }
        process.exit(0);
    })
        .catch((err) => {
        console.error(err instanceof Error ? err.message : 'Backfill failed');
        process.exit(1);
    });
}
