import type pg from 'pg';
import { Db, run } from './db.js';

export interface MetaEventLogRow {
  event_id: string;
  event_name: string;
  order_id?: string | null;
  channel: 'CAPI';
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  http_status?: number | null;
  error_message?: string | null;
  value_amount?: number | null;
}

/**
 * Inserts a Meta event log entry. Called within a transaction by the CAPI client.
 * If a duplicate Purchase event is attempted (unique index violation on
 * (event_name, order_id) for Purchase rows), the insert is silently ignored
 * per the unique index constraint.
 */
export async function createMetaEventLog(
  db: pg.PoolClient,
  event: MetaEventLogRow
): Promise<{ id: string }> {
  const result = await db.query<{ id: string }>(
    `
    INSERT INTO meta_event_log (
      event_id,
      event_name,
      order_id,
      channel,
      status,
      http_status,
      error_message,
      value_amount
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [
      event.event_id,
      event.event_name,
      event.order_id ?? null,
      event.channel,
      event.status,
      event.http_status ?? null,
      event.error_message ?? null,
      event.value_amount ?? null,
    ]
  );

  return result.rows[0] ?? { id: '' };
}

/**
 * Retrieves a meta event log entry by event_id for deduplication checks.
 */
export async function getMetaEventLogByEventId(
  dbOrUndef: Db,
  eventId: string
): Promise<{ id: string; status: string } | undefined> {
  return run(dbOrUndef, async (db) => {
    const result = await db.query<{ id: string; status: string }>(
      'SELECT id, status FROM meta_event_log WHERE event_id = $1 LIMIT 1',
      [eventId]
    );
    return result.rows[0];
  });
}
