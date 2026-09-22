import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { seedGeography } from '../scripts/seedGeography.js';
import {
  geoEntityExists,
  listDistrictsByDivision,
  listDivisions,
  listUpazilasByDistrict,
  resolveGeography,
} from '../src/repositories/geography.repository.js';
import { connect, dropSchema, resetSchema, scopedUrl, TEST_DATABASE_URL } from './helpers/schemaFixture.js';

/**
 * Geography hierarchy integrity, against a real Postgres.
 *
 * These are database constraints and a real dataset load — a mock would assert
 * nothing, exactly as spec 02's schema tests argue. The suite builds its own
 * schema, seeds the official dataset into it, and drops it afterwards.
 */

const SCHEMA = 'geography_repo_test';

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('geography repository', () => {
  let client: pg.Client;
  // The repository opens its own connections through withTransaction, so the
  // search_path must travel with DATABASE_URL for the duration of this suite.
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    await seedGeography(scopedUrl(SCHEMA));
    client = await connect(SCHEMA);
  });

  afterAll(async () => {
    await client?.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await dropSchema(SCHEMA);
  });

  // 1. Division retrieval
  it('returns all 8 divisions', async () => {
    const divisions = await listDivisions();
    expect(divisions).toHaveLength(8);
    expect(divisions.map((d) => d.name)).toContain('Chattogram');
    // Only public columns are exposed (11-security-hardening).
    expect(Object.keys(divisions[0]!).sort()).toEqual(['id', 'name', 'pcode']);
  });

  // 2. District retrieval by division
  it('returns only the districts belonging to the given division', async () => {
    const [chattogram] = (await listDivisions()).filter((d) => d.name === 'Chattogram');
    const districts = await listDistrictsByDivision(chattogram!.id);

    expect(districts!.map((d) => d.name)).toContain('Cumilla');
    // Dhaka is a district of Dhaka division, never of Chattogram.
    expect(districts!.map((d) => d.name)).not.toContain('Dhaka');
  });

  // 3. Upazila retrieval by district
  it('returns only the upazilas belonging to the given district', async () => {
    const [chattogram] = (await listDivisions()).filter((d) => d.name === 'Chattogram');
    const districts = await listDistrictsByDivision(chattogram!.id);
    const cumilla = districts!.find((d) => d.name === 'Cumilla')!;

    const upazilas = await listUpazilasByDistrict(cumilla.id);
    expect(upazilas!.map((u) => u.name)).toContain('Daudkandi');
  });

  // 4. Union/Ward retrieval — SKIPPED BY DESIGN, not unimplemented.
  //
  // The authoritative dataset states "ADM4 (Ward level) is not officially
  // confirmed or maintained" and BBS publishes no union/ward geocode list, so
  // there is no level-4 table to retrieve from. Union/Ward remains the
  // free-text field of 02-customer §2.2. See data/geography/README.md.
  it.skip('returns unions/wards for an upazila — no authoritative ADM4 dataset exists', () => {});

  // 5. Invalid parent-child combinations
  it('rejects a mismatched but individually-valid combination', async () => {
    const divisions = await listDivisions();
    const chattogram = divisions.find((d) => d.name === 'Chattogram')!;
    const dhaka = divisions.find((d) => d.name === 'Dhaka')!;

    const cumilla = (await listDistrictsByDivision(chattogram.id))!.find((d) => d.name === 'Cumilla')!;
    const daudkandi = (await listUpazilasByDistrict(cumilla.id))!.find((u) => u.name === 'Daudkandi')!;
    const dhakaDistrict = (await listDistrictsByDivision(dhaka.id))!.find((d) => d.name === 'Dhaka')!;

    // The valid chain resolves.
    await expect(
      resolveGeography({ divisionId: chattogram.id, districtId: cumilla.id, upazilaId: daudkandi.id }),
    ).resolves.toMatchObject({ upazila: { name: 'Daudkandi' } });

    // Chattogram -> Dhaka is the task's own example of what must be impossible.
    await expect(
      resolveGeography({ divisionId: chattogram.id, districtId: dhakaDistrict.id, upazilaId: daudkandi.id }),
    ).resolves.toBeUndefined();

    // Upazila real, but not in the named district.
    await expect(
      resolveGeography({ divisionId: dhaka.id, districtId: dhakaDistrict.id, upazilaId: daudkandi.id }),
    ).resolves.toBeUndefined();
  });

  // 6. Invalid geographic IDs
  it('distinguishes an unknown parent from a childless one', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';

    // `undefined` (not an empty array) is what lets the service return 404
    // rather than pretending an invalid id is a valid empty division.
    await expect(listDistrictsByDivision(unknown)).resolves.toBeUndefined();
    await expect(listUpazilasByDistrict(unknown)).resolves.toBeUndefined();
    await expect(
      resolveGeography({ divisionId: unknown, districtId: unknown, upazilaId: unknown }),
    ).resolves.toBeUndefined();
    await expect(geoEntityExists('DISTRICT', unknown)).resolves.toBe(false);
  });

  // 7. Duplicate geography records
  it('refuses a duplicate pcode and a duplicate name within one parent', async () => {
    const { rows } = await client.query('SELECT id, pcode, name, division_id FROM geo_districts LIMIT 1');
    const district = rows[0];

    await expect(
      client.query('INSERT INTO geo_districts (pcode, name, division_id) VALUES ($1, $2, $3)', [
        district.pcode,
        'Some Other Name',
        district.division_id,
      ]),
    ).rejects.toMatchObject({ constraint: 'geo_districts_pcode_key' });

    await expect(
      client.query('INSERT INTO geo_districts (pcode, name, division_id) VALUES ($1, $2, $3)', [
        'BD9999',
        district.name,
        district.division_id,
      ]),
    ).rejects.toMatchObject({ constraint: 'geo_districts_division_name_key' });
  });

  it('refuses an upazila whose district/division pair is not real', async () => {
    const { rows: districts } = await client.query(
      'SELECT id, division_id FROM geo_districts ORDER BY pcode LIMIT 2',
    );
    const [a, b] = districts;

    // District from one row, division from another — a pair that exists nowhere.
    await expect(
      client.query(
        'INSERT INTO geo_upazilas (pcode, name, district_id, division_id) VALUES ($1, $2, $3, $4)',
        ['BD99999999', 'Nowhere', a.id, b.division_id === a.division_id ? '00000000-0000-4000-8000-000000000000' : b.division_id],
      ),
    ).rejects.toMatchObject({ constraint: 'geo_upazilas_district_division_fkey' });
  });

  // 8. Idempotent dataset import
  it('is idempotent — a second seed changes no counts and no ids', async () => {
    const before = await client.query('SELECT id, pcode FROM geo_upazilas ORDER BY pcode');

    const result = await seedGeography(scopedUrl(SCHEMA));
    expect(result).toMatchObject({ divisions: 8, districts: 64, upazilas: 507 });

    const after = await client.query('SELECT id, pcode FROM geo_upazilas ORDER BY pcode');
    expect(after.rowCount).toBe(before.rowCount);
    // Stable uuids matter: customers and courier mappings reference them, so a
    // re-seed that reassigned ids would orphan those rows.
    expect(after.rows).toEqual(before.rows);
  });

  it('loads the official counts with no orphans', async () => {
    const { rows } = await client.query(
      `SELECT (SELECT count(*) FROM geo_divisions) AS divisions,
              (SELECT count(*) FROM geo_districts) AS districts,
              (SELECT count(*) FROM geo_upazilas)  AS upazilas,
              (SELECT count(*) FROM geo_upazilas u
                 JOIN geo_districts t ON t.id = u.district_id
                WHERE t.division_id <> u.division_id) AS inconsistent`,
    );
    expect(rows[0]).toMatchObject({
      divisions: '8',
      districts: '64',
      upazilas: '507',
      inconsistent: '0',
    });
  });

  // 9 & 10. Customer address referencing geography
  it('accepts a consistent customer address and rejects an inconsistent one', async () => {
    const divisions = await listDivisions();
    const chattogram = divisions.find((d) => d.name === 'Chattogram')!;
    const dhaka = divisions.find((d) => d.name === 'Dhaka')!;
    const cumilla = (await listDistrictsByDivision(chattogram.id))!.find((d) => d.name === 'Cumilla')!;
    const daudkandi = (await listUpazilasByDistrict(cumilla.id))!.find((u) => u.name === 'Daudkandi')!;

    const insert = (phone: string, divisionId: string, districtId: string, upazilaId: string) =>
      client.query(
        `INSERT INTO customers
           (full_name, phone_number, division, district, area_unit_type, area_unit_name,
            ward_unit_type, ward_unit_name, detailed_address, division_id, district_id, upazila_id)
         VALUES ('T', $1, 'Chattogram', 'Cumilla', 'UPAZILA', 'Daudkandi', 'UNION', 'Union X',
                 'House 12', $2, $3, $4)`,
        [phone, divisionId, districtId, upazilaId],
      );

    await expect(insert('01711111111', chattogram.id, cumilla.id, daudkandi.id)).resolves.toBeTruthy();

    // Claiming Cumilla sits in Dhaka division — rejected by the composite FK,
    // independently of any application-layer validation.
    await expect(insert('01722222222', dhaka.id, cumilla.id, daudkandi.id)).rejects.toMatchObject({
      constraint: 'customers_district_division_fkey',
    });

    // An upazila id without its district is unstorable.
    await expect(
      client.query(
        `INSERT INTO customers
           (full_name, phone_number, division, district, area_unit_type, area_unit_name,
            ward_unit_type, ward_unit_name, detailed_address, division_id, upazila_id)
         VALUES ('T', '01733333333', 'C', 'C', 'UPAZILA', 'D', 'UNION', 'U', 'H', $1, $2)`,
        [chattogram.id, daudkandi.id],
      ),
    ).rejects.toMatchObject({ constraint: 'customers_geography_chain' });
  });
});
