import { run, type Db } from './db.js';

/**
 * `customer_risk_checks` access (spec 16 §Database changes, 09-fraud-risk-check §7.6).
 *
 * Append-only: `insert` and reads, no update/delete. The displayable projection
 * deliberately does NOT select `raw_result`; the raw payload is only reachable
 * through `getRaw`, an audit-only reader. There is no `SELECT *` path.
 */

export type RiskLevelValue = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' | 'CHECK_FAILED';

export type RiskCheckRecord = {
  id: string;
  customerId: string;
  orderId: string | null;
  phoneNumber: string;
  provider: string;
  riskScore: number | null;
  riskLevel: RiskLevelValue;
  totalOrders: number | null;
  successfulOrders: number | null;
  returnedOrders: number | null;
  checkedAt: Date;
  checkedBy: string | null;
  /** `users.user_identifier` of the triggering Admin/Manager, when still present. */
  checkedByUserIdentifier: string | null;
};

type Row = {
  id: string;
  customer_id: string;
  order_id: string | null;
  phone_number: string;
  provider: string;
  risk_score: string | null; // numeric comes back as string from pg
  risk_level: RiskLevelValue;
  total_orders: number | null;
  successful_orders: number | null;
  returned_orders: number | null;
  checked_at: Date;
  checked_by: string | null;
  checked_by_identifier: string | null;
};

// Explicit display columns — raw_result is intentionally absent.
const DISPLAY_COLUMNS = `
  c.id, c.customer_id, c.order_id, c.phone_number, c.provider, c.risk_score, c.risk_level,
  c.total_orders, c.successful_orders, c.returned_orders, c.checked_at, c.checked_by,
  u.user_identifier AS checked_by_identifier
`;

function toRecord(row: Row): RiskCheckRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    orderId: row.order_id,
    phoneNumber: row.phone_number,
    provider: row.provider,
    riskScore: row.risk_score === null ? null : Number(row.risk_score),
    riskLevel: row.risk_level,
    totalOrders: row.total_orders,
    successfulOrders: row.successful_orders,
    returnedOrders: row.returned_orders,
    checkedAt: row.checked_at,
    checkedBy: row.checked_by,
    checkedByUserIdentifier: row.checked_by_identifier,
  };
}

/** The most recent check for this customer across ALL of their orders (§7.6 — the cache key is customer_id). */
export async function findLatestForCustomer(customerId: string, db?: Db): Promise<RiskCheckRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${DISPLAY_COLUMNS}
         FROM customer_risk_checks c
         LEFT JOIN users u ON u.id = c.checked_by
        WHERE c.customer_id = $1
        ORDER BY c.checked_at DESC, c.id DESC
        LIMIT 1`,
      [customerId],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export type NewRiskCheck = {
  customerId: string;
  orderId: string;
  phoneNumber: string;
  provider: string;
  riskScore: number | null;
  riskLevel: RiskLevelValue;
  totalOrders: number | null;
  successfulOrders: number | null;
  returnedOrders: number | null;
  rawResult: unknown;
  checkedBy: string;
};

/** Appends one row (an explicit fresh check — never an upsert). Returns the displayable record. */
export async function insert(data: NewRiskCheck, db?: Db): Promise<RiskCheckRecord> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO customer_risk_checks
         (customer_id, order_id, phone_number, provider, risk_score, risk_level,
          total_orders, successful_orders, returned_orders, raw_result, checked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       RETURNING id`,
      [
        data.customerId,
        data.orderId,
        data.phoneNumber,
        data.provider,
        data.riskScore,
        data.riskLevel,
        data.totalOrders,
        data.successfulOrders,
        data.returnedOrders,
        data.rawResult === undefined ? null : JSON.stringify(data.rawResult),
        data.checkedBy,
      ],
    );
    const { rows: out } = await client.query<Row>(
      `SELECT ${DISPLAY_COLUMNS}
         FROM customer_risk_checks c
         LEFT JOIN users u ON u.id = c.checked_by
        WHERE c.id = $1`,
      [rows[0]!.id],
    );
    return toRecord(out[0]!);
  });
}

/** AUDIT ONLY: the provider's raw payload for one row. Never wire this into a response. */
export async function getRaw(id: string, db?: Db): Promise<unknown | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ raw_result: unknown }>(
      `SELECT raw_result FROM customer_risk_checks WHERE id = $1`,
      [id],
    );
    return rows[0]?.raw_result ?? null;
  });
}
