import type { Express } from 'express';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../../helpers/schemaFixture.ts';
import { applyTestEnv } from '../../helpers/testEnv.ts';
import { loginAsAdmin, type AdminSession } from '../../helpers/adminSession.ts';
import { resetEnvCache } from '../../../src/config/env.ts';
import { makeFakeRiskProvider, type FakeRiskProvider } from './fakeRiskProvider.ts';

/**
 * Shared real-Postgres fixture for the spec 16 suites: a freshly migrated disposable
 * schema, the real Express app, one Admin and one Manager account, and the scriptable
 * fake risk provider registered through the registry's setRiskProvider() seam.
 *
 * Every caller passes its own hard-coded `spec16_<area>` literal (never computed).
 */
export const PW = 'RiskCheckPass12';

export const ORDER_STATUSES = [
  'PENDING_CONFIRMATION',
  'COD_VERIFICATION_PENDING',
  'CONFIRMED',
  'PROCESSING',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type RiskSuite = {
  app: Express;
  schema: string;
  fake: FakeRiskProvider;
  adminId: string;
  managerId: string;
  q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Like q(), but refuses to run unless the connection is on this suite's schema (DDL safety). */
  scoped: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  admin: () => Promise<AdminSession>;
  manager: () => Promise<AdminSession>;
  newCustomer: (opts?: { type?: 'GUEST' | 'REGISTERED'; phone?: string; email?: string | null; name?: string }) => Promise<{ id: string; phone: string }>;
  newOrder: (customerId: string, opts?: { status?: OrderStatus; method?: 'COD' | 'BKASH' }) => Promise<{ id: string; orderNumber: string }>;
  snapshot: (orderId: string) => Promise<Record<string, unknown>>;
  riskRows: (customerId: string) => Promise<any[]>;
  url: (orderNumber: string) => string;
  resetLimiters: () => Promise<void>;
  teardown: () => Promise<void>;
};

export async function startRiskSuite(schema: string, env: Record<string, string> = {}): Promise<RiskSuite> {
  if (!/^spec16_[a-z_]+$/.test(schema)) throw new Error(`refusing unexpected schema name ${schema}`);
  if (!TEST_DATABASE_URL) throw new Error('no test database');

  await resetSchema(schema);
  applyTestEnv();
  process.env.DATABASE_URL = scopedUrl(schema);
  process.env.RL_PUBLIC_CEILING_MAX = '100000';
  process.env.RL_AUTHENTICATED_CEILING_MAX = '100000';
  process.env.RL_RISK_CHECK_MAX = '100000';
  Object.assign(process.env, env);
  resetEnvCache();

  const tx = await import('../../../src/lib/transaction.js');
  await tx.resetTransactionPool();
  const q: RiskSuite['q'] = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);
  const scoped: RiskSuite['scoped'] = (sql, params) =>
    tx.withTransaction(async (c) => {
      const current = (await c.query(`SELECT current_schema() AS s`)).rows[0].s;
      if (current !== schema) throw new Error(`refusing to run: connection is on schema ${current}, expected ${schema}`);
      return (await c.query(sql, params as any[])).rows;
    });

  const registry = await import('../../../src/services/fraud/providers/registry.js');
  const fake = makeFakeRiskProvider();
  registry.setRiskProvider(fake);

  const { hashPassword } = await import('../../../src/lib/password.js');
  const users = await import('../../../src/repositories/users.repository.js');
  const passwordHash = await hashPassword(PW);
  const adminId = (await users.create({ role: 'ADMIN', userIdentifier: 'r-admin', passwordHash, mustChangePassword: false })).id;
  const managerId = (await users.create({ role: 'MANAGER', userIdentifier: 'r-mgr', passwordHash, mustChangePassword: false })).id;

  const { createApp } = await import('../../../src/app.js');
  const app = createApp();

  let seq = 0;
  const newCustomer: RiskSuite['newCustomer'] = async (opts = {}) => {
    seq += 1;
    const phone = opts.phone ?? `01711${String(seq).padStart(6, '0')}`;
    const [c] = await q<{ id: string }>(
      `INSERT INTO customers (account_type, full_name, phone_number, email, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ($1,$2,$3,$4,'Dhaka','Dhaka','THANA','Gulshan','WARD','Ward 5','House 99 Secret Lane') RETURNING id`,
      [opts.type ?? 'REGISTERED', opts.name ?? 'Risk Customer', phone, opts.email === undefined ? `risk${seq}@example.com` : opts.email],
    );
    return { id: c!.id, phone };
  };

  const newOrder: RiskSuite['newOrder'] = async (customerId, opts = {}) => {
    seq += 1;
    const method = opts.method ?? 'COD';
    const orderNumber = `FBK-20261002-R${String(seq).padStart(5, '0')}`;
    const [o] = await q<{ id: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, total_amount,
                          full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address, internal_note)
       VALUES ($1,$2,$3,$4,$5,500,0,500,'Order Tester','01788888888','Dhaka','Dhaka','THANA','Gulshan','WARD','Ward 5','House 99 Secret Lane','ADMIN-ONLY-NOTE-do-not-leak')
       RETURNING id`,
      [orderNumber, customerId, method, opts.status ?? 'CONFIRMED', method === 'COD' ? 'PENDING_COLLECTION' : 'PENDING_VERIFICATION'],
    );
    return { id: o!.id, orderNumber };
  };

  const snapshot: RiskSuite['snapshot'] = async (orderId) => {
    const [o] = await q(`SELECT order_status, payment_status, updated_at FROM orders WHERE id=$1`, [orderId]);
    const [s] = await q(`SELECT count(*)::int AS n, max(shipment_status::text) AS status FROM shipments WHERE order_id=$1`, [orderId]);
    const [h] = await q(`SELECT count(*)::int AS n FROM order_status_history WHERE order_id=$1`, [orderId]);
    return { orderStatus: o.order_status, paymentStatus: o.payment_status, updatedAt: String(o.updated_at), shipments: s.n, shipmentStatus: s.status, historyRows: h.n };
  };

  const riskRows: RiskSuite['riskRows'] = (customerId) =>
    q(`SELECT * FROM customer_risk_checks WHERE customer_id=$1 ORDER BY checked_at, id`, [customerId]);

  return {
    app,
    schema,
    fake,
    adminId,
    managerId,
    q,
    scoped,
    admin: () => loginAsAdmin(app, 'r-admin', PW),
    manager: () => loginAsAdmin(app, 'r-mgr', PW),
    newCustomer,
    newOrder,
    snapshot,
    riskRows,
    url: (orderNumber) => `/api/admin/orders/${orderNumber}/risk-check`,
    resetLimiters: async () => {
      (await import('../../../src/lib/rateLimiterStore.js')).resetRateLimiterStore();
    },
    teardown: async () => {
      (await import('../../../src/services/fraud/providers/registry.js')).setRiskProvider();
      await (await import('../../../src/lib/transaction.js')).resetTransactionPool();
      await dropSchema(schema);
    },
  };
}

/** The exact RiskCheckResponse key set — transcribed from spec 16 "Types" + "Contract additions". */
export const RESPONSE_KEYS = [
  'available',
  'canTriggerFreshCheck',
  'checkedAt',
  'checkedByUserIdentifier',
  'message',
  'phoneNumber',
  'returnedOrders',
  'riskLevel',
  'riskScore',
  'successRatePercent',
  'successfulOrders',
  'totalOrders',
  'triggerBlockedReason',
];
