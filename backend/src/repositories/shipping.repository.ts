/**
 * Shipping repository (spec 21) — zones, district mappings, append-only rates and the
 * unmatched-district tally. Every function takes an optional transaction client so
 * `computeShipping()` runs inside the order-creation transaction (spec 11).
 *
 * Rates are never updated or deleted: superseding a rate is an INSERT with a newer
 * `effective_from`, so a historical order's shipping amount stays explainable (§8.23's reasoning).
 */

import type { PaginationQuery } from '../lib/pagination.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

export type ShippingStrategy = 'FLAT' | 'FREE' | 'FREE_OVER_THRESHOLD';

export type ShippingZoneRow = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
};

export type ShippingRate = {
  id: string;
  zoneId: string;
  strategy: ShippingStrategy;
  flatAmount: number;
  freeOverAmount: number | null;
  effectiveFrom: Date;
  createdBy: string | null;
  createdAt: Date;
};

export type ShippingDistrictMapping = { district: string; metroOnly: boolean };

export type ShippingZoneWithDetails = ShippingZoneRow & {
  districts: ShippingDistrictMapping[];
  currentRate: ShippingRate | null;
};

export type UnmatchedDistrict = {
  district: string;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type ZoneRow = { id: string; code: string; name: string; is_default: boolean; sort_order: number };
type RateRow = {
  id: string;
  zone_id: string;
  strategy: ShippingStrategy;
  flat_amount: string;
  free_over_amount: string | null;
  effective_from: Date;
  created_by: string | null;
  created_at: Date;
};

const ZONE_COLUMNS = 'id, code, name, is_default, sort_order';
const RATE_COLUMNS = 'id, zone_id, strategy, flat_amount, free_over_amount, effective_from, created_by, created_at';

function toZone(row: ZoneRow): ShippingZoneRow {
  return { id: row.id, code: row.code, name: row.name, isDefault: row.is_default, sortOrder: row.sort_order };
}

function toRate(row: RateRow): ShippingRate {
  return {
    id: row.id,
    zoneId: row.zone_id,
    strategy: row.strategy,
    flatAmount: Number(row.flat_amount),
    freeOverAmount: row.free_over_amount !== null ? Number(row.free_over_amount) : null,
    effectiveFrom: row.effective_from,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** The case/whitespace-insensitive key used to match and tally district text. */
export function districtKey(district: string): string {
  return district.trim().toLowerCase();
}

/** Bounded key for the unmatched tally: a guest district is free text, so never store an unbounded string as a primary key. */
const UNMATCHED_TEXT_MAX = 200;

// ---------------------------------------------------------------------------
// Resolution reads (used by computeShipping)
// ---------------------------------------------------------------------------

export async function findZoneByDistrict(
  district: string,
  metroOnly: boolean,
  db?: Db,
): Promise<ShippingZoneRow | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<ZoneRow>(
      `SELECT z.id, z.code, z.name, z.is_default, z.sort_order
         FROM shipping_zone_districts d
         JOIN shipping_zones z ON z.id = d.zone_id
        WHERE lower(btrim(d.district)) = $1 AND d.metro_only = $2`,
      [districtKey(district), metroOnly],
    );
    return rows[0] ? toZone(rows[0]) : null;
  });
}

export async function findDefaultZone(db?: Db): Promise<ShippingZoneRow | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<ZoneRow>(
      `SELECT ${ZONE_COLUMNS} FROM shipping_zones WHERE is_default`,
    );
    return rows[0] ? toZone(rows[0]) : null;
  });
}

/** The newest rate whose `effective_from` has passed — "the current rate for this zone". */
export async function findCurrentRate(zoneId: string, now: Date, db?: Db): Promise<ShippingRate | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<RateRow>(
      `SELECT ${RATE_COLUMNS}
         FROM shipping_rates
        WHERE zone_id = $1 AND effective_from <= $2
        ORDER BY effective_from DESC, created_at DESC
        LIMIT 1`,
      [zoneId, now],
    );
    return rows[0] ? toRate(rows[0]) : null;
  });
}

/** Tallies a district that fell through to the default zone. Upsert, so it is safe to repeat. */
export async function recordUnmatchedDistrict(district: string, db?: Db): Promise<void> {
  await run(db, async (client) => {
    await client.query(
      `INSERT INTO shipping_unmatched_districts (district_key, district_text)
       VALUES ($1, $2)
       ON CONFLICT (district_key) DO UPDATE
         SET occurrences = shipping_unmatched_districts.occurrences + 1,
             last_seen_at = now()`,
      [districtKey(district).slice(0, UNMATCHED_TEXT_MAX), district.trim().slice(0, UNMATCHED_TEXT_MAX)],
    );
  });
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export async function findZoneById(id: string, db?: Db): Promise<ShippingZoneRow | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<ZoneRow>(`SELECT ${ZONE_COLUMNS} FROM shipping_zones WHERE id = $1`, [id]);
    return rows[0] ? toZone(rows[0]) : null;
  });
}

export async function listDistricts(zoneId: string, db?: Db): Promise<ShippingDistrictMapping[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ district: string; metro_only: boolean }>(
      `SELECT district, metro_only FROM shipping_zone_districts
        WHERE zone_id = $1 ORDER BY lower(district), metro_only DESC`,
      [zoneId],
    );
    return rows.map((r) => ({ district: r.district, metroOnly: r.metro_only }));
  });
}

export async function listZonesWithDetails(now: Date, db?: Db): Promise<ShippingZoneWithDetails[]> {
  return run(db, async (client) => {
    const { rows: zones } = await client.query<ZoneRow>(
      `SELECT ${ZONE_COLUMNS} FROM shipping_zones ORDER BY sort_order, code`,
    );
    const { rows: districts } = await client.query<{ zone_id: string; district: string; metro_only: boolean }>(
      `SELECT zone_id, district, metro_only FROM shipping_zone_districts ORDER BY lower(district), metro_only DESC`,
    );
    const { rows: rates } = await client.query<RateRow>(
      `SELECT DISTINCT ON (zone_id) ${RATE_COLUMNS}
         FROM shipping_rates
        WHERE effective_from <= $1
        ORDER BY zone_id, effective_from DESC, created_at DESC`,
      [now],
    );
    const rateByZone = new Map(rates.map((r) => [r.zone_id, toRate(r)]));
    return zones.map((z) => ({
      ...toZone(z),
      districts: districts
        .filter((d) => d.zone_id === z.id)
        .map((d) => ({ district: d.district, metroOnly: d.metro_only })),
      currentRate: rateByZone.get(z.id) ?? null,
    }));
  });
}

export async function listRates(
  zoneId: string,
  { page, pageSize }: PaginationQuery,
  db?: Db,
): Promise<{ items: ShippingRate[]; total: number }> {
  return run(db, async (client) => {
    const { rows } = await client.query<RateRow & { total: string }>(
      `SELECT ${RATE_COLUMNS}, count(*) OVER()::text AS total
         FROM shipping_rates
        WHERE zone_id = $1
        ORDER BY effective_from DESC, created_at DESC
        LIMIT $2 OFFSET $3`,
      [zoneId, pageSize, (page - 1) * pageSize],
    );
    return { items: rows.map(toRate), total: rows[0] ? Number(rows[0].total) : 0 };
  });
}

/** Unmatched districts, excluding any text that now has a mapping — adding the mapping clears it. */
export async function listUnmatchedDistricts(
  { page, pageSize }: PaginationQuery,
  db?: Db,
): Promise<{ items: UnmatchedDistrict[]; total: number }> {
  return run(db, async (client) => {
    const { rows } = await client.query<{
      district_text: string;
      occurrences: number;
      first_seen_at: Date;
      last_seen_at: Date;
      total: string;
    }>(
      `SELECT u.district_text, u.occurrences, u.first_seen_at, u.last_seen_at, count(*) OVER()::text AS total
         FROM shipping_unmatched_districts u
        WHERE NOT EXISTS (
                SELECT 1 FROM shipping_zone_districts d WHERE lower(btrim(d.district)) = u.district_key
              )
        ORDER BY u.last_seen_at DESC
        LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map((r) => ({
        district: r.district_text,
        occurrences: r.occurrences,
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Admin writes (callers pass their transaction client so the audit row commits with them)
// ---------------------------------------------------------------------------

export async function createZone(
  data: { code: string; name: string; sortOrder: number },
  db?: Db,
): Promise<ShippingZoneRow> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<ZoneRow>(
        `INSERT INTO shipping_zones (code, name, sort_order) VALUES ($1, $2, $3) RETURNING ${ZONE_COLUMNS}`,
        [data.code, data.name, data.sortOrder],
      );
      return toZone(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export async function updateZone(
  id: string,
  data: { name?: string; sortOrder?: number },
  db?: Db,
): Promise<ShippingZoneRow | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<ZoneRow>(
      `UPDATE shipping_zones
          SET name = COALESCE($2, name),
              sort_order = COALESCE($3, sort_order),
              updated_at = now()
        WHERE id = $1
        RETURNING ${ZONE_COLUMNS}`,
      [id, data.name ?? null, data.sortOrder ?? null],
    );
    return rows[0] ? toZone(rows[0]) : null;
  });
}

/**
 * Replaces the zone's district list with exactly `districts`. A duplicate against another zone
 * (same district at the same metro specificity) surfaces as a ConflictError via the unique index.
 */
export async function replaceDistricts(zoneId: string, districts: ShippingDistrictMapping[], db?: Db): Promise<void> {
  await run(db, async (client) => {
    try {
      await client.query('DELETE FROM shipping_zone_districts WHERE zone_id = $1', [zoneId]);
      for (const d of districts) {
        await client.query(
          'INSERT INTO shipping_zone_districts (zone_id, district, metro_only) VALUES ($1, $2, $3)',
          [zoneId, d.district.trim(), d.metroOnly],
        );
      }
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** Swaps the default zone in one transaction so the single-default partial unique index stays valid. */
export async function makeDefault(zoneId: string, db?: Db): Promise<void> {
  await run(db, async (client) => {
    // Serialise concurrent swaps so two admins cannot race into the single-default unique index (a 500).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('shipping_default_zone'))`);
    await client.query('UPDATE shipping_zones SET is_default = false, updated_at = now() WHERE is_default AND id <> $1', [zoneId]);
    await client.query('UPDATE shipping_zones SET is_default = true, updated_at = now() WHERE id = $1', [zoneId]);
  });
}

export async function insertRate(
  data: {
    zoneId: string;
    strategy: ShippingStrategy;
    flatAmount: number;
    freeOverAmount: number | null;
    createdBy: string;
    /**
     * Stamped from the APPLICATION clock — the same clock `findCurrentRate` is queried with
     * (spec 21 §8.5 "server clock only") — so a rate is visible to the very next request even when the
     * database host's clock is skewed. Defaults to now.
     */
    effectiveFrom?: Date;
  },
  db?: Db,
): Promise<ShippingRate> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<RateRow>(
        `INSERT INTO shipping_rates (zone_id, strategy, flat_amount, free_over_amount, created_by, effective_from)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${RATE_COLUMNS}`,
        [data.zoneId, data.strategy, data.flatAmount, data.freeOverAmount, data.createdBy, data.effectiveFrom ?? new Date()],
      );
      return toRate(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}
