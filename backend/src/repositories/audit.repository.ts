import type { PaginationQuery } from '../lib/pagination.js';
import type { ActorType } from '../types/enums.js';
import { run, type Db } from './db.js';

/**
 * The append-only audit trail (06-rbac §5.15 rule 10, §5.21.11,
 * database skill §2.4).
 *
 * This module deliberately exports `append` and reads ONLY. There is no update
 * and no delete function, so no caller anywhere in the system can rewrite
 * history — the guarantee is the absence of the code path, not a convention a
 * reviewer has to remember. A test asserts these exports.
 *
 * PII never belongs in `previousValue`/`newValue` beyond the specific field
 * that actually changed (database skill §4): audit a status transition with the
 * two statuses, not with a copy of the customer's address.
 */

export type AuditEntry = {
  /** e.g. 'order', 'payment', 'shipment', 'user', 'coupon'. */
  entityType: string;
  /** Null for system-level events with no single subject row. */
  entityId?: string | null;
  /** e.g. 'status_change', 'permission_grant'. */
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  /** Null together with actorType SYSTEM, for courier-sync and scheduled jobs. */
  actorUserId?: string | null;
  actorType: ActorType;
  /** The spec 01 per-request correlation id, when the action came from a request. */
  requestId?: string | null;
};

export type AuditRecord = {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  previousValue: unknown;
  newValue: unknown;
  reason: string | null;
  actorUserId: string | null;
  actorType: ActorType;
  requestId: string | null;
  createdAt: Date;
};

type AuditRow = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  previous_value: unknown;
  new_value: unknown;
  reason: string | null;
  actor_user_id: string | null;
  actor_type: ActorType;
  request_id: string | null;
  created_at: Date;
};

const COLUMNS = `
  id, entity_type, entity_id, action, previous_value, new_value,
  reason, actor_user_id, actor_type, request_id, created_at
`;

function toRecord(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    previousValue: row.previous_value,
    newValue: row.new_value,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}

/** jsonb columns take null or a JSON string, never `undefined`. */
function toJsonb(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * Appends one audit entry.
 *
 * Callers that audit a change should pass their transaction client, so the
 * change and its audit row commit together — an action can then never be
 * applied without its audit record.
 */
export async function append(entry: AuditEntry, db?: Db): Promise<AuditRecord> {
  return run(db, async (client) => {
    const { rows } = await client.query<AuditRow>(
      `INSERT INTO audit_logs (
         entity_type, entity_id, action, previous_value, new_value,
         reason, actor_user_id, actor_type, request_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${COLUMNS}`,
      [
        entry.entityType,
        entry.entityId ?? null,
        entry.action,
        toJsonb(entry.previousValue),
        toJsonb(entry.newValue),
        entry.reason ?? null,
        entry.actorUserId ?? null,
        entry.actorType,
        entry.requestId ?? null,
      ],
    );
    return toRecord(rows[0]!);
  });
}

/** One entity's history, newest first — the ordering the index serves. */
export async function listForEntity(
  entityType: string,
  entityId: string,
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: AuditRecord[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const { rows } = await client.query<AuditRow & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER()::text AS total
         FROM audit_logs
        WHERE entity_type = $1 AND entity_id = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4`,
      [entityType, entityId, pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map(toRecord),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}
