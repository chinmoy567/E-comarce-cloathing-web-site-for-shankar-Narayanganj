/**
 * Courier registry repository (04-courier §4.9) — couriers are rows, not an enum.
 * Credentials are never stored here; `config` holds non-secret settings only.
 */

import type pg from 'pg';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

export type CourierRow = {
  code: string;
  name: string;
  adapter_key: string;
  is_enabled: boolean;
  supports_cancel: boolean;
  supports_tracking: boolean;
  supports_reference_lookup: boolean;
  tracking_url_template: string | null;
  display_order: number;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `
  code, name, adapter_key, is_enabled, supports_cancel, supports_tracking,
  supports_reference_lookup, tracking_url_template, display_order, config,
  created_at, updated_at
`;

export async function getByCode(code: string, db?: Db): Promise<CourierRow | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CourierRow>(`SELECT ${COLUMNS} FROM couriers WHERE code = $1`, [code]);
    return rows[0] ?? null;
  });
}

/** Enabled couriers in display order — what the Create Shipment picker shows. */
export async function listEnabled(db?: Db): Promise<CourierRow[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<CourierRow>(
      `SELECT ${COLUMNS} FROM couriers WHERE is_enabled = true ORDER BY display_order ASC, code ASC`,
    );
    return rows;
  });
}

export async function listAll(db?: Db): Promise<CourierRow[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<CourierRow>(`SELECT ${COLUMNS} FROM couriers ORDER BY display_order ASC, code ASC`);
    return rows;
  });
}

export type CourierConfigUpdate = {
  isEnabled?: boolean;
  displayOrder?: number;
  trackingUrlTemplate?: string | null;
  config?: Record<string, unknown>;
};

/** Updates only the provided settings. Joins the caller's transaction. */
export async function updateConfig(
  client: pg.PoolClient,
  code: string,
  update: CourierConfigUpdate,
): Promise<CourierRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [code];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (update.isEnabled !== undefined) add('is_enabled', update.isEnabled);
  if (update.displayOrder !== undefined) add('display_order', update.displayOrder);
  if (update.trackingUrlTemplate !== undefined) add('tracking_url_template', update.trackingUrlTemplate);
  if (update.config !== undefined) add('config', JSON.stringify(update.config));
  if (sets.length === 0) return getByCode(code, client);

  try {
    const { rows } = await client.query<CourierRow>(
      `UPDATE couriers SET ${sets.join(', ')}, updated_at = now() WHERE code = $1 RETURNING ${COLUMNS}`,
      values,
    );
    return rows[0] ?? null;
  } catch (err) {
    throw toDomainError(err);
  }
}
