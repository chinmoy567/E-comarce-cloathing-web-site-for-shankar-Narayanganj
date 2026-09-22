import type { GeoLevel, GeoNode, ResolvedGeography } from '../types/geography.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * Read access to the internal Bangladesh administrative geography.
 *
 * Reference data, seeded from the official dataset by `scripts/seedGeography.ts`
 * (see `data/geography/README.md`). This layer exposes reads and the seed
 * upsert only — there is deliberately no create/update/delete API for
 * geography, because no requirement asks for Admin management of it and
 * 11-security-hardening's "do not expose unnecessary endpoints" rule makes an
 * unrequested CRUD surface a liability rather than a feature (task §15).
 *
 * Every query selects the public columns only (id, pcode, name); timestamps and
 * internal parent uuids are never returned to a caller.
 */

type GeoRow = { id: string; pcode: string; name: string };

const COLUMNS = 'id, pcode, name';

function toNode(row: GeoRow): GeoNode {
  return { id: row.id, pcode: row.pcode, name: row.name };
}

/** All 8 divisions, in official P-code order. */
export async function listDivisions(db?: Db): Promise<GeoNode[]> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<GeoRow>(
        `SELECT ${COLUMNS} FROM geo_divisions ORDER BY name ASC`,
      );
      return rows.map(toNode);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/**
 * Districts of one division.
 *
 * Returns `undefined` when the division id does not exist, so the caller can
 * tell "no such division" (404) apart from "a real division with no children"
 * (empty list). A plain empty array would conflate the two and let an invalid
 * id look like a valid one.
 */
export async function listDistrictsByDivision(
  divisionId: string,
  db?: Db,
): Promise<GeoNode[] | undefined> {
  return run(db, async (client) => {
    try {
      const parent = await client.query('SELECT 1 FROM geo_divisions WHERE id = $1', [divisionId]);
      if (parent.rowCount === 0) return undefined;

      const { rows } = await client.query<GeoRow>(
        `SELECT ${COLUMNS} FROM geo_districts WHERE division_id = $1 ORDER BY name ASC`,
        [divisionId],
      );
      return rows.map(toNode);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** Upazilas/thanas of one district. `undefined` when the district is unknown. */
export async function listUpazilasByDistrict(
  districtId: string,
  db?: Db,
): Promise<GeoNode[] | undefined> {
  return run(db, async (client) => {
    try {
      const parent = await client.query('SELECT 1 FROM geo_districts WHERE id = $1', [districtId]);
      if (parent.rowCount === 0) return undefined;

      const { rows } = await client.query<GeoRow>(
        `SELECT ${COLUMNS} FROM geo_upazilas WHERE district_id = $1 ORDER BY name ASC`,
        [districtId],
      );
      return rows.map(toNode);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/**
 * Resolves a division/district/upazila triple in ONE query that also proves the
 * parent-child relationships hold.
 *
 * This is the check that makes "Chattogram -> Dhaka" impossible: the joins
 * require the district to belong to the given division and the upazila to the
 * given district, so a set of individually-valid but mismatched ids returns
 * `undefined` rather than three happily-resolved rows. Doing it as one query
 * also removes the TOCTOU window three separate lookups would open.
 *
 * Returns `undefined` for any unknown id and for any inconsistent combination —
 * the caller reports which, without this layer inventing an error message.
 */
export async function resolveGeography(
  input: { divisionId: string; districtId: string; upazilaId: string },
  db?: Db,
): Promise<ResolvedGeography | undefined> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<{
        div_id: string;
        div_pcode: string;
        div_name: string;
        dis_id: string;
        dis_pcode: string;
        dis_name: string;
        upa_id: string;
        upa_pcode: string;
        upa_name: string;
      }>(
        `SELECT
           d.id  AS div_id, d.pcode  AS div_pcode, d.name  AS div_name,
           t.id  AS dis_id, t.pcode  AS dis_pcode, t.name  AS dis_name,
           u.id  AS upa_id, u.pcode  AS upa_pcode, u.name  AS upa_name
         FROM geo_upazilas u
         JOIN geo_districts t ON t.id = u.district_id
         JOIN geo_divisions d ON d.id = t.division_id
         WHERE u.id = $1 AND t.id = $2 AND d.id = $3`,
        [input.upazilaId, input.districtId, input.divisionId],
      );

      const row = rows[0];
      if (!row) return undefined;

      return {
        division: { id: row.div_id, pcode: row.div_pcode, name: row.div_name },
        district: { id: row.dis_id, pcode: row.dis_pcode, name: row.dis_name },
        upazila: { id: row.upa_id, pcode: row.upa_pcode, name: row.upa_name },
      };
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** Confirms one entity exists at a given level — used by the courier mapping. */
export async function geoEntityExists(
  level: GeoLevel,
  geoId: string,
  db?: Db,
): Promise<boolean> {
  // Table chosen from a fixed map, never interpolated from caller input.
  const table = {
    DIVISION: 'geo_divisions',
    DISTRICT: 'geo_districts',
    UPAZILA: 'geo_upazilas',
  }[level];

  return run(db, async (client) => {
    try {
      const { rowCount } = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [geoId]);
      return (rowCount ?? 0) > 0;
    } catch (err) {
      throw toDomainError(err);
    }
  });
}
