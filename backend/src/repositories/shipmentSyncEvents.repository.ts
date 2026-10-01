/**
 * Inbound courier update log (spec 15, 04-courier §4.6). Every webhook/poll update
 * is recorded with its outcome. Writes join the caller's transaction so the event
 * and the status change it caused commit together.
 */

import type pg from 'pg';
import type { ShipmentStatus } from '../types/orderEnums.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

export type SyncSource = 'WEBHOOK' | 'POLL';
export type SkipReason = 'DUPLICATE' | 'STALE' | 'INVALID_TRANSITION' | 'UNKNOWN_SHIPMENT' | 'UNRECOGNIZED_STATUS';

export type SyncEventInput = {
  shipmentId: string | null;
  courierCode: string;
  courierOrderId: string | null;
  source: SyncSource;
  reportedStatus: ShipmentStatus | null;
  providerEventId: string | null;
  dedupeKey: string;
  occurredAt: string | null;
  applied: boolean;
  skipReason: SkipReason | null;
};

export async function record(client: pg.PoolClient, input: SyncEventInput): Promise<void> {
  try {
    await client.query(
      `INSERT INTO shipment_sync_events
         (shipment_id, courier_code, courier_order_id, source, reported_status, provider_event_id,
          dedupe_key, occurred_at, applied, skip_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.shipmentId,
        input.courierCode,
        input.courierOrderId,
        input.source,
        input.reportedStatus,
        input.providerEventId,
        input.dedupeKey,
        input.occurredAt,
        input.applied,
        input.skipReason,
      ],
    );
  } catch (err) {
    throw toDomainError(err);
  }
}

/** True when an APPLIED event with this key already exists for the shipment. */
export async function appliedExists(client: pg.PoolClient, shipmentId: string, dedupeKey: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM shipment_sync_events WHERE shipment_id = $1 AND dedupe_key = $2 AND applied = true LIMIT 1`,
    [shipmentId, dedupeKey],
  );
  return rows.length > 0;
}

export type SyncEventRow = {
  source: SyncSource;
  reported_status: ShipmentStatus | null;
  applied: boolean;
  skip_reason: SkipReason | null;
  created_at: Date;
};

export async function listForShipment(shipmentId: string, limit = 50, db?: Db): Promise<SyncEventRow[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<SyncEventRow>(
      `SELECT source, reported_status, applied, skip_reason, created_at
         FROM shipment_sync_events WHERE shipment_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [shipmentId, limit],
    );
    return rows;
  });
}

/** Receipt audit for the webhook endpoint — a digest, never the body (it holds customer data). */
export async function recordWebhookDelivery(
  input: { courierCode: string; signatureValid: boolean; payloadDigest: string; httpStatusReturned: number },
  db?: Db,
): Promise<void> {
  await run(db, async (client) => {
    await client.query(
      `INSERT INTO courier_webhook_deliveries (courier_code, signature_valid, payload_digest, http_status_returned)
       VALUES ($1,$2,$3,$4)`,
      [input.courierCode, input.signatureValid, input.payloadDigest, input.httpStatusReturned],
    );
  });
}
