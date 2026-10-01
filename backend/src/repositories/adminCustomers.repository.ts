import type { PaginationQuery } from '../lib/pagination.js';
import type { AccountType } from '../types/enums.js';
import { run, type Db } from './db.js';

/**
 * Admin customer-panel queries (spec 13, 05-admin §5.7). Reads only, plus the
 * one limited contact/address correction. Order statistics are aggregated per
 * query; nothing here touches `account_type` or credentials (§2.9.8).
 */

export type AdminCustomerRow = {
  id: string;
  account_type: AccountType;
  full_name: string;
  phone_number: string;
  email: string | null;
  division: string;
  district: string;
  area_unit_type: string;
  area_unit_name: string;
  ward_unit_type: string;
  ward_unit_name: string;
  detailed_address: string;
  postal_code: string | null;
  created_at: Date;
  order_count: number;
  last_order_at: Date | null;
};

const SELECT = `
  c.id, c.account_type, c.full_name, c.phone_number, c.email,
  c.division, c.district, c.area_unit_type, c.area_unit_name,
  c.ward_unit_type, c.ward_unit_name, c.detailed_address, c.postal_code, c.created_at,
  COALESCE(o.order_count, 0)::int AS order_count, o.last_order_at
`;

const ORDER_STATS_JOIN = `
  LEFT JOIN (
    SELECT customer_id, count(*) AS order_count, max(created_at) AS last_order_at
      FROM orders GROUP BY customer_id
  ) o ON o.customer_id = c.id
`;

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function list(
  filter: { q?: string; accountType?: AccountType },
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: AdminCustomerRow[]; total: number }> {
  return run(db, async (client) => {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const param = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };
    if (filter.accountType) conditions.push(`c.account_type = ${param(filter.accountType)}`);
    if (filter.q) {
      const p = param(`%${escapeLike(filter.q)}%`);
      conditions.push(`(c.full_name ILIKE ${p} OR c.phone_number ILIKE ${p} OR c.email ILIKE ${p})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = param(pagination.pageSize);
    const offset = param((pagination.page - 1) * pagination.pageSize);

    const { rows } = await client.query<AdminCustomerRow & { total: string }>(
      `SELECT ${SELECT}, count(*) OVER()::text AS total
         FROM customers c ${ORDER_STATS_JOIN}
         ${where}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return { items: rows, total: rows[0] ? Number(rows[0].total) : 0 };
  });
}

export async function findById(id: string, db?: Db): Promise<AdminCustomerRow | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<AdminCustomerRow>(
      `SELECT ${SELECT} FROM customers c ${ORDER_STATS_JOIN} WHERE c.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  });
}

/** Payment-related aggregates - only returned to actors holding `payment.view` (§5.7). */
export async function paymentStats(
  id: string,
  db?: Db,
): Promise<{ totalPaid: number; pendingPayments: number; rejectedPayments: number }> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ total_paid: string; pending: string; rejected: string }>(
      `SELECT COALESCE(sum(total_amount) FILTER (WHERE payment_status IN ('PAID_VERIFIED','PAID_COLLECTED')), 0)::text AS total_paid,
              count(*) FILTER (WHERE payment_status IN ('PENDING_VERIFICATION','PENDING_COLLECTION'))::text AS pending,
              count(*) FILTER (WHERE payment_status = 'REJECTED')::text AS rejected
         FROM orders WHERE customer_id = $1`,
      [id],
    );
    const r = rows[0]!;
    return { totalPaid: Number(r.total_paid), pendingPayments: Number(r.pending), rejectedPayments: Number(r.rejected) };
  });
}

/** Contact/address correction only. `account_type`, credentials and the `users` table are never touched. */
export async function updateContact(
  id: string,
  patch: { fullName?: string; email?: string | null; detailedAddress?: string; postalCode?: string | null },
  db?: Db,
): Promise<AdminCustomerRow | null> {
  return run(db, async (client) => {
    const sets: string[] = [];
    const values: unknown[] = [id];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (patch.fullName !== undefined) add('full_name', patch.fullName);
    if (patch.email !== undefined) add('email', patch.email);
    if (patch.detailedAddress !== undefined) add('detailed_address', patch.detailedAddress);
    if (patch.postalCode !== undefined) add('postal_code', patch.postalCode);
    if (sets.length === 0) return findById(id, client);

    const res = await client.query(`UPDATE customers SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
    if (res.rowCount === 0) return null;
    return findById(id, client);
  });
}
