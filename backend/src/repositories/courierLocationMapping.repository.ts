import { ValidationError } from '../lib/errors.js';
import type { CourierLocationMapping, GeoLevel } from '../types/geography.js';
import { geoEntityExists } from './geography.repository.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * Storage for the internal-geography -> courier-location translation
 * (task §7-§9, 04-courier-shipment §4.2).
 *
 * This table is the ONLY place a provider's location ids may live. They are
 * never promoted into `geo_divisions`/`geo_districts`/`geo_upazilas`, so the
 * internal hierarchy stays independent of any courier and a provider renumbering
 * its catalogue cannot invalidate a customer's stored address.
 *
 * NOTHING IS SEEDED HERE. Pathao's city/zone/area ids and Steadfast's location
 * fields must be resolved from each provider's current official API when spec 14
 * is implemented (CLAUDE.md §6). Until then every lookup below returns
 * `undefined`, which the adapters surface as an actionable "unmapped location"
 * failure rather than a guess.
 */

type MappingRow = {
  id: string;
  courier_code: string;
  geo_level: GeoLevel;
  geo_id: string;
  courier_location_id: string;
  courier_location_name: string | null;
};

const COLUMNS = `
  id, courier_code, geo_level, geo_id, courier_location_id, courier_location_name
`;

function toMapping(row: MappingRow): CourierLocationMapping {
  return {
    id: row.id,
    courierCode: row.courier_code,
    geoLevel: row.geo_level,
    geoId: row.geo_id,
    courierLocationId: row.courier_location_id,
    courierLocationName: row.courier_location_name,
  };
}

/** One courier's mapping for one internal entity, or `undefined` if unmapped. */
export async function findMapping(
  courierCode: string,
  geoLevel: GeoLevel,
  geoId: string,
  db?: Db,
): Promise<CourierLocationMapping | undefined> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<MappingRow>(
        `SELECT ${COLUMNS} FROM courier_location_mappings
         WHERE courier_code = $1 AND geo_level = $2 AND geo_id = $3`,
        [courierCode, geoLevel, geoId],
      );
      const row = rows[0];
      return row ? toMapping(row) : undefined;
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export type MappingInput = {
  courierCode: string;
  geoLevel: GeoLevel;
  geoId: string;
  courierLocationId: string;
  courierLocationName?: string | null;
  sourceNote?: string | null;
};

/**
 * Records a mapping resolved from a provider's official API.
 *
 * `geo_id` is polymorphic across three tables and Postgres cannot express a
 * conditional foreign key, so the referenced entity is verified here before the
 * insert. Without this a mapping could point at a uuid that exists at a
 * different level — or at nothing — and the error would only surface later, as
 * a failed shipment.
 *
 * Idempotent: re-resolving the same location updates the stored id in place.
 */
export async function upsertMapping(
  input: MappingInput,
  db?: Db,
): Promise<CourierLocationMapping> {
  return run(db, async (client) => {
    const exists = await geoEntityExists(input.geoLevel, input.geoId, client);
    if (!exists) {
      throw new ValidationError('The mapping does not reference a known geography entity.', [
        { field: 'geoId', message: `No ${input.geoLevel.toLowerCase()} exists with this id.` },
      ]);
    }

    try {
      const { rows } = await client.query<MappingRow>(
        `INSERT INTO courier_location_mappings
           (courier_code, geo_level, geo_id, courier_location_id, courier_location_name, source_note)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (courier_code, geo_level, geo_id) DO UPDATE
           SET courier_location_id   = EXCLUDED.courier_location_id,
               courier_location_name = EXCLUDED.courier_location_name,
               source_note           = EXCLUDED.source_note,
               updated_at            = now()
         RETURNING ${COLUMNS}`,
        [
          input.courierCode,
          input.geoLevel,
          input.geoId,
          input.courierLocationId,
          input.courierLocationName ?? null,
          input.sourceNote ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('Mapping upsert returned no row.');
      return toMapping(row);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}
