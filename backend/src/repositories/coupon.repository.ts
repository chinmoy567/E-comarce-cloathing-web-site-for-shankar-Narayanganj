import type pg from 'pg';
import type { PaginationQuery } from '../lib/pagination.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * Coupon CRUD and the transaction-safe usage-reservation primitive
 * (10-coupon-discount §8.24, §8.25).
 *
 * `recordCouponUsage` follows `inventory.repository.ts::conditionalDecrement`'s
 * pattern exactly: it takes the caller's `pg.PoolClient` explicitly and never
 * opens its own transaction, so it can only ever run inside a caller-managed
 * `withTransaction` block. This slice builds and tests it but does not call
 * it from any route/controller — spec 11's order-creation transaction is its
 * only intended call site (plan §4, §10).
 */

export type DiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';
export type CouponStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED';
export type CustomerEligibility = 'ALL_CUSTOMERS' | 'REGISTERED_CUSTOMERS_ONLY' | 'SPECIFIC_CUSTOMER';
export type ProductEligibility = 'ALL_PRODUCTS' | 'SPECIFIC_PRODUCTS' | 'SPECIFIC_CATEGORIES';

type CouponRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: string;
  minimum_order_amount: string | null;
  maximum_discount_amount: string | null;
  starts_at: Date;
  expires_at: Date;
  usage_limit: number | null;
  usage_count: number;
  per_customer_limit: number | null;
  customer_eligibility: CustomerEligibility;
  eligible_customer_id: string | null;
  product_eligibility: ProductEligibility;
  status: CouponStatus;
  is_archived: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type CouponRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  minimumOrderAmount: number | null;
  maximumDiscountAmount: number | null;
  startsAt: Date;
  expiresAt: Date;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  customerEligibility: CustomerEligibility;
  eligibleCustomerId: string | null;
  productEligibility: ProductEligibility;
  status: CouponStatus;
  isArchived: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const COLUMNS = `
  id, code, name, description, discount_type, discount_value,
  minimum_order_amount, maximum_discount_amount, starts_at, expires_at,
  usage_limit, usage_count, per_customer_limit, customer_eligibility,
  eligible_customer_id, product_eligibility, status, is_archived,
  created_by, updated_by, created_at, updated_at
`;

function toNumberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toRecord(row: CouponRow): CouponRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    minimumOrderAmount: toNumberOrNull(row.minimum_order_amount),
    maximumDiscountAmount: toNumberOrNull(row.maximum_discount_amount),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    usageLimit: row.usage_limit,
    usageCount: row.usage_count,
    perCustomerLimit: row.per_customer_limit,
    customerEligibility: row.customer_eligibility,
    eligibleCustomerId: row.eligible_customer_id,
    productEligibility: row.product_eligibility,
    status: row.status,
    isArchived: row.is_archived,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findById(id: string, db?: Db): Promise<CouponRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CouponRow>(`SELECT ${COLUMNS} FROM coupons WHERE id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/** Looks up a coupon by its normalized (trimmed + uppercased) code — §8.4a. */
export async function findByNormalizedCode(code: string, db?: Db): Promise<CouponRecord | null> {
  const normalized = code.trim().toUpperCase();
  return run(db, async (client) => {
    const { rows } = await client.query<CouponRow>(
      `SELECT ${COLUMNS} FROM coupons WHERE upper(btrim(code)) = $1`,
      [normalized],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export type ListCouponsFilter = {
  status?: CouponStatus;
  discountType?: DiscountType;
  search?: string;
  includeArchived?: boolean;
};

export async function list(
  filter: ListCouponsFilter,
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: CouponRecord[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (!filter.includeArchived) {
      conditions.push(`is_archived = false`);
    }
    if (filter.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }
    if (filter.discountType) {
      values.push(filter.discountType);
      conditions.push(`discount_type = $${values.length}`);
    }
    if (filter.search) {
      values.push(`%${filter.search}%`);
      conditions.push(`(code ILIKE $${values.length} OR name ILIKE $${values.length})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(pageSize, (page - 1) * pageSize);

    const { rows } = await client.query<CouponRow & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER()::text AS total
         FROM coupons
         ${where}
        ORDER BY created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: rows.map(toRecord),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}

export type CreateCouponInput = {
  code: string;
  name: string;
  description?: string | null;
  discountType: DiscountType;
  discountValue: number;
  minimumOrderAmount?: number | null;
  maximumDiscountAmount?: number | null;
  startsAt: Date;
  expiresAt: Date;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  customerEligibility?: CustomerEligibility;
  eligibleCustomerId?: string | null;
  status?: CouponStatus;
  createdBy: string;
};

export async function create(input: CreateCouponInput, db?: Db): Promise<CouponRecord> {
  // §8.4a: normalized (trimmed + uppercased) before storage — the unique
  // index also enforces this at the database level regardless.
  const normalizedCode = input.code.trim().toUpperCase();

  return run(db, async (client) => {
    try {
      const { rows } = await client.query<CouponRow>(
        `INSERT INTO coupons (
           code, name, description, discount_type, discount_value,
           minimum_order_amount, maximum_discount_amount, starts_at, expires_at,
           usage_limit, per_customer_limit, customer_eligibility,
           eligible_customer_id, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING ${COLUMNS}`,
        [
          normalizedCode,
          input.name,
          input.description ?? null,
          input.discountType,
          input.discountValue,
          input.minimumOrderAmount ?? null,
          input.maximumDiscountAmount ?? null,
          input.startsAt,
          input.expiresAt,
          input.usageLimit ?? null,
          input.perCustomerLimit ?? null,
          input.customerEligibility ?? 'ALL_CUSTOMERS',
          input.eligibleCustomerId ?? null,
          input.status ?? 'DRAFT',
          input.createdBy,
        ],
      );
      return toRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export type UpdateCouponInput = {
  code?: string;
  name?: string;
  description?: string | null;
  discountType?: DiscountType;
  discountValue?: number;
  minimumOrderAmount?: number | null;
  maximumDiscountAmount?: number | null;
  startsAt?: Date;
  expiresAt?: Date;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  customerEligibility?: CustomerEligibility;
  eligibleCustomerId?: string | null;
  updatedBy: string;
};

export async function update(id: string, input: UpdateCouponInput, db?: Db): Promise<CouponRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];

  const assign = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.code !== undefined) assign('code', input.code.trim().toUpperCase());
  if (input.name !== undefined) assign('name', input.name);
  if (input.description !== undefined) assign('description', input.description);
  if (input.discountType !== undefined) assign('discount_type', input.discountType);
  if (input.discountValue !== undefined) assign('discount_value', input.discountValue);
  if (input.minimumOrderAmount !== undefined) assign('minimum_order_amount', input.minimumOrderAmount);
  if (input.maximumDiscountAmount !== undefined) assign('maximum_discount_amount', input.maximumDiscountAmount);
  if (input.startsAt !== undefined) assign('starts_at', input.startsAt);
  if (input.expiresAt !== undefined) assign('expires_at', input.expiresAt);
  if (input.usageLimit !== undefined) assign('usage_limit', input.usageLimit);
  if (input.perCustomerLimit !== undefined) assign('per_customer_limit', input.perCustomerLimit);
  if (input.customerEligibility !== undefined) assign('customer_eligibility', input.customerEligibility);
  if (input.eligibleCustomerId !== undefined) assign('eligible_customer_id', input.eligibleCustomerId);
  assign('updated_by', input.updatedBy);

  return run(db, async (client) => {
    try {
      const { rows } = await client.query<CouponRow>(
        `UPDATE coupons SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $1
          RETURNING ${COLUMNS}`,
        values,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export async function setStatus(
  id: string,
  status: CouponStatus,
  updatedBy: string,
  db?: Db,
): Promise<CouponRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CouponRow>(
      `UPDATE coupons SET status = $2, updated_by = $3, updated_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, status, updatedBy],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function setArchived(id: string, isArchived: boolean, db?: Db): Promise<CouponRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CouponRow>(
      `UPDATE coupons SET is_archived = $2, updated_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, isArchived],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/** Hard delete — callers must confirm zero usages first (§8.9). */
export async function remove(id: string, db?: Db): Promise<void> {
  return run(db, async (client) => {
    try {
      await client.query(`DELETE FROM coupons WHERE id = $1`, [id]);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** Total usage-row count for a coupon — used by the delete-vs-archive guard (§8.9). */
export async function countUsages(couponId: string, db?: Db): Promise<number> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM coupon_usages WHERE coupon_id = $1`,
      [couponId],
    );
    return Number(rows[0]!.count);
  });
}

/** This customer's completed-usage count for a coupon — §8.6 step 4, §8.24b. */
export async function countUsagesForCustomer(
  couponId: string,
  customerId: string,
  db?: Db,
): Promise<number> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM coupon_usages WHERE coupon_id = $1 AND customer_id = $2`,
      [couponId, customerId],
    );
    return Number(rows[0]!.count);
  });
}

export type CouponUsageRecord = {
  id: string;
  couponId: string;
  orderId: string;
  customerId: string;
  discountAmount: number;
  usedAt: Date;
};

type CouponUsageRow = {
  id: string;
  coupon_id: string;
  order_id: string;
  customer_id: string;
  discount_amount: string;
  used_at: Date;
};

function toUsageRecord(row: CouponUsageRow): CouponUsageRecord {
  return {
    id: row.id,
    couponId: row.coupon_id,
    orderId: row.order_id,
    customerId: row.customer_id,
    discountAmount: Number(row.discount_amount),
    usedAt: row.used_at,
  };
}

/** Distinct-customer count for the admin detail view (§8.30). */
export async function countDistinctCustomers(couponId: string, db?: Db): Promise<number> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(DISTINCT customer_id)::text AS count FROM coupon_usages WHERE coupon_id = $1`,
      [couponId],
    );
    return Number(rows[0]!.count);
  });
}

export async function listUsages(
  couponId: string,
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: CouponUsageRecord[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const { rows } = await client.query<CouponUsageRow & { total: string }>(
      `SELECT id, coupon_id, order_id, customer_id, discount_amount, used_at,
              count(*) OVER()::text AS total
         FROM coupon_usages
        WHERE coupon_id = $1
        ORDER BY used_at DESC
        LIMIT $2 OFFSET $3`,
      [couponId, pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map(toUsageRecord),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// recordCouponUsage — §8.25. Built and tested here; NOT called from any
// route or controller in this slice (plan §4, §10 — spec 11's order-creation
// transaction is the only intended future call site).
// ---------------------------------------------------------------------------

export type RecordCouponUsageInput = {
  couponId: string;
  orderId: string;
  customerId: string;
  discountAmount: number;
  perCustomerLimit: number | null;
};

export type RecordCouponUsageResult =
  | { ok: true; usage: CouponUsageRecord }
  | { ok: false; reason: 'USAGE_LIMIT_REACHED' | 'PER_CUSTOMER_LIMIT_REACHED' };

/**
 * Atomically reserves one coupon usage: the conditional counter UPDATE and
 * the per-customer re-count both happen on `client`, the caller's already-open
 * transaction — this function never opens its own transaction (matches
 * `inventory.repository.ts::conditionalDecrement`'s contract exactly), so it
 * can only ever run inside a caller-managed `withTransaction` block.
 */
export async function recordCouponUsage(
  client: pg.PoolClient,
  input: RecordCouponUsageInput,
): Promise<RecordCouponUsageResult> {
  try {
    // `SELECT ... FOR UPDATE` locks this coupon's row for the rest of the
    // transaction, serializing every concurrent `recordCouponUsage` call
    // against the SAME coupon — a second concurrent caller blocks here until
    // the first commits or rolls back. This is what makes the per-customer
    // re-count below race-free: two concurrent orders from the same customer
    // against `per_customer_limit: 1` cannot both observe "0 existing usages"
    // (§8.25).
    const { rows: lockedRows } = await client.query<{ id: string }>(
      `SELECT id FROM coupons WHERE id = $1 FOR UPDATE`,
      [input.couponId],
    );
    if (lockedRows.length === 0) {
      // Coupon does not exist — treat as usage-limit-reached rather than a
      // distinct error shape; a caller with a valid coupon id never hits this.
      return { ok: false, reason: 'USAGE_LIMIT_REACHED' };
    }

    if (input.perCustomerLimit !== null) {
      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM coupon_usages WHERE coupon_id = $1 AND customer_id = $2`,
        [input.couponId, input.customerId],
      );
      const currentCount = countRows[0] ? Number(countRows[0].count) : 0;
      if (currentCount >= input.perCustomerLimit) {
        return { ok: false, reason: 'PER_CUSTOMER_LIMIT_REACHED' };
      }
    }

    // The atomic conditional ceiling check — never read-then-write (§8.25).
    // Redundant with the row lock above for concurrency purposes, but kept as
    // the actual enforcement mechanism per §8.25's exact SQL.
    const { rows } = await client.query<{ id: string }>(
      `UPDATE coupons
          SET usage_count = usage_count + 1
        WHERE id = $1 AND (usage_limit IS NULL OR usage_count < usage_limit)
        RETURNING id`,
      [input.couponId],
    );
    if (rows.length === 0) {
      return { ok: false, reason: 'USAGE_LIMIT_REACHED' };
    }

    const { rows: usageRows } = await client.query<CouponUsageRow>(
      `INSERT INTO coupon_usages (coupon_id, order_id, customer_id, discount_amount)
       VALUES ($1,$2,$3,$4)
       RETURNING id, coupon_id, order_id, customer_id, discount_amount, used_at`,
      [input.couponId, input.orderId, input.customerId, input.discountAmount],
    );

    return { ok: true, usage: toUsageRecord(usageRows[0]!) };
  } catch (err) {
    throw toDomainError(err);
  }
}
