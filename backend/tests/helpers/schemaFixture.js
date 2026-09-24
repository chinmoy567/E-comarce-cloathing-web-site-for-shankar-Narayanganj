import pg from 'pg';
import { runMigrations } from '../../scripts/migrate.js';
import { liveDatabaseUrl } from '../setup.js';
/**
 * A disposable, fully-migrated schema for spec 02's constraint tests.
 *
 * The same reasoning as tests/migrate.test.ts: these are database constraints,
 * so a mock would assert nothing — the CHECK, the enum, and the partial unique
 * index either exist in Postgres or they do not. Each suite gets its own schema
 * so runs are repeatable and order-independent, and `public` is never touched.
 *
 * Schema names are hard-coded by each caller, never derived from input, since
 * an identifier cannot be parameterized.
 */
export const TEST_DATABASE_URL = liveDatabaseUrl();
/** `search_path` travels with the connection string, not with session state. */
export function scopedUrl(schema) {
    return `${TEST_DATABASE_URL}?options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}
export async function withAdminClient(sql) {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
        await client.query(sql);
    }
    finally {
        await client.end();
    }
}
/** Drops and recreates `schema`, then applies every migration into it. */
export async function resetSchema(schema) {
    await withAdminClient(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
    await runMigrations(scopedUrl(schema));
}
export async function dropSchema(schema) {
    await withAdminClient(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
}
/** Opens a client bound to the test schema. Caller closes it. */
export async function connect(schema) {
    const client = new pg.Client({ connectionString: scopedUrl(schema) });
    await client.connect();
    return client;
}
/** A valid customer row, for tests that need one without caring about details. */
export const SAMPLE_CUSTOMER = {
    fullName: 'Test Customer',
    phoneNumber: '01712345678',
    email: null,
    address: {
        division: 'Dhaka',
        district: 'Dhaka',
        areaUnitType: 'THANA',
        areaUnitName: 'Gulshan',
        wardUnitType: 'WARD',
        wardUnitName: 'Ward 19',
        detailedAddress: 'House 1, Road 2',
        postalCode: '1212',
    },
};
