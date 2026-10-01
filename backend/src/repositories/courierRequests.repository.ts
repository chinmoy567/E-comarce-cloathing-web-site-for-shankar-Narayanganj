/**
 * Audit of every provider call (spec 14). Stores a digest of the outbound
 * payload, never the payload itself, because it carries customer PII
 * (database skill §4). `error_message` is already-redacted provider text.
 */

import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

export type CourierOperation = 'CREATE' | 'DETAILS' | 'TRACK' | 'CANCEL';

export type CourierRequestInput = {
  shipmentId: string | null;
  courierCode: string;
  operation: CourierOperation;
  requestDigest: string;
  httpStatus: number | null;
  succeeded: boolean;
  errorMessage: string | null;
  durationMs: number | null;
};

export type CourierRequestRow = {
  operation: CourierOperation;
  succeeded: boolean;
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: Date;
};

/**
 * Records one provider call. Uses its own short transaction by default so a call
 * is logged even when the surrounding business transaction is not open.
 */
export async function record(input: CourierRequestInput, db?: Db): Promise<void> {
  try {
    await run(db, async (client) => {
      await client.query(
        `INSERT INTO courier_requests
           (shipment_id, courier_code, operation, request_digest, http_status, succeeded, error_message, duration_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.shipmentId,
          input.courierCode,
          input.operation,
          input.requestDigest,
          input.httpStatus,
          input.succeeded,
          input.errorMessage,
          input.durationMs,
        ],
      );
    });
  } catch (err) {
    throw toDomainError(err);
  }
}

/** Call history for the Order Panel — never the digest, never PII. */
export async function listForShipment(
  shipmentId: string,
  page: { limit: number; offset: number },
  db?: Db,
): Promise<{ items: CourierRequestRow[]; total: number }> {
  return run(db, async (client) => {
    const { rows } = await client.query<CourierRequestRow>(
      `SELECT operation, succeeded, http_status, duration_ms, error_message, created_at
         FROM courier_requests WHERE shipment_id = $1
        ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [shipmentId, page.limit, page.offset],
    );
    const count = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM courier_requests WHERE shipment_id = $1`,
      [shipmentId],
    );
    return { items: rows, total: Number(count.rows[0]?.n ?? 0) };
  });
}
