import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import {
  ACCOUNT_TYPES,
  AREA_UNIT_TYPES,
  PERMISSION_TIERS,
  WARD_UNIT_TYPES,
  isAccountType,
  isAreaUnitType,
  isWardUnitType,
} from '../../src/types/enums.ts';
import { GEO_LEVELS } from '../../src/types/geography.ts';
import { ROLES } from '../../src/types/role.ts';

/**
 * Spec 02 — "TypeScript enums/types mirroring every database enum".
 *
 * The TS lists are hand-maintained mirrors of the Postgres enums, and nothing
 * in the compiler notices when a value is added on one side only. Comparing the
 * two against a live `pg_enum` turns that silent drift into a failing test —
 * which is the whole point of declaring them in one shared location.
 */
const SCHEMA = 'spec02_enum_parity';

/** TS mirror -> Postgres type name. */
const MIRRORS: ReadonlyArray<[string, readonly string[], string]> = [
  ['ROLES', ROLES, 'user_role'],
  ['ACCOUNT_TYPES', ACCOUNT_TYPES, 'account_type'],
  ['AREA_UNIT_TYPES', AREA_UNIT_TYPES, 'area_unit_type'],
  ['WARD_UNIT_TYPES', WARD_UNIT_TYPES, 'ward_unit_type'],
  ['PERMISSION_TIERS', PERMISSION_TIERS, 'permission_tier'],
  // Spec 08 prerequisite — the geography level enum (migration 0003).
  ['GEO_LEVELS', GEO_LEVELS, 'geo_level'],
];

describe.skipIf(!TEST_DATABASE_URL)('database enums match their TypeScript mirrors', () => {
  let client: pg.Client;
  /** Postgres type name -> its labels, in declaration order. */
  const actual = new Map<string, string[]>();

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    client = new pg.Client({ connectionString: scopedUrl(SCHEMA) });
    await client.connect();

    const { rows } = await client.query<{ type_name: string; labels: string[] }>(
      // json_agg, not array_agg: the driver hands a Postgres text[] back as the
      // literal '{A,B}' string, which would compare unequal to every mirror.
      `SELECT t.typname AS type_name,
              json_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1
        GROUP BY t.typname`,
      [SCHEMA],
    );
    for (const row of rows) actual.set(row.type_name, row.labels);
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await dropSchema(SCHEMA);
  });

  it.each(MIRRORS)('%s mirrors the %s enum exactly', (_name, mirror, typeName) => {
    expect(actual.get(typeName)).toEqual([...mirror]);
  });

  it('declares no database enum without a TypeScript mirror', () => {
    const mirrored = new Set(MIRRORS.map(([, , typeName]) => typeName));
    const unmirrored = [...actual.keys()].filter((name) => !mirrored.has(name));

    expect(unmirrored).toEqual([]);
  });

  it('user_role holds exactly the three documented roles (§5.19)', () => {
    // SUPER_ADMIN and STAFF are absent by construction, on both sides.
    expect(actual.get('user_role')).toEqual(['ADMIN', 'MANAGER', 'CUSTOMER']);
    expect(ROLES).not.toContain('SUPER_ADMIN');
    expect(ROLES).not.toContain('STAFF');
  });
});

describe('enum type guards', () => {
  it('accept every documented value and reject anything else', () => {
    for (const value of ACCOUNT_TYPES) expect(isAccountType(value)).toBe(true);
    for (const value of AREA_UNIT_TYPES) expect(isAreaUnitType(value)).toBe(true);
    for (const value of WARD_UNIT_TYPES) expect(isWardUnitType(value)).toBe(true);

    // Case matters: the stored form is upper-case, and a lower-case value
    // reaching the database would fail the enum cast anyway.
    expect(isAccountType('guest')).toBe(false);
    expect(isAreaUnitType('DISTRICT')).toBe(false);
    expect(isWardUnitType('')).toBe(false);
  });

  it('reject non-string input without throwing', () => {
    for (const guard of [isAccountType, isAreaUnitType, isWardUnitType]) {
      for (const value of [null, undefined, 0, {}, [], true]) {
        expect(guard(value)).toBe(false);
      }
    }
  });
});
