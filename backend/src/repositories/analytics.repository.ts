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
 * Claims the single Purchase slot for an order BEFORE any outbound send. The
 * unique partial index makes this the exactly-once guard (§6.3): returns the
 * row id when claimed, or null when a Purchase row already exists. The row is
 * created as FAILED/'in-flight' (the status check allows no pending state), so
 * a crash mid-send is recorded as a failure and is never retried.
 */
export async function claimPurchaseLog(
  db: pg.PoolClient,
  input: { event_id: string; order_id: string; value_amount: number | null }
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `
    INSERT INTO meta_event_log (event_id, event_name, order_id, channel, status, error_message, value_amount)
    VALUES ($1, 'Purchase', $2, 'CAPI', 'FAILED', 'in-flight', $3)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [input.event_id, input.order_id, input.value_amount]
  );
  return result.rows[0]?.id ?? null;
}

export async function updateMetaEventLogOutcome(
  db: pg.PoolClient,
  id: string,
  outcome: {
    status: 'SENT' | 'FAILED' | 'SKIPPED';
    http_status?: number | null;
    error_message?: string | null;
  }
): Promise<void> {
  await db.query(
    `UPDATE meta_event_log SET status = $2, http_status = $3, error_message = $4, sent_at = now() WHERE id = $1`,
    [id, outcome.status, outcome.http_status ?? null, outcome.error_message ?? null]
  );
}

/** True once a Purchase row exists for the order (used for purchaseEventId). */
export async function hasPurchaseLog(db: Db, orderId: string): Promise<boolean> {
  return run(db, async (client) => {
    const r = await client.query(
      `SELECT 1 FROM meta_event_log WHERE event_name = 'Purchase' AND order_id = $1 LIMIT 1`,
      [orderId]
    );
    return r.rows.length > 0;
  });
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
