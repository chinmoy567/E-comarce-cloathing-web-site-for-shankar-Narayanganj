/**
 * Spec 08 — Purchase event (08-analytics-meta §6.3, §6.5, §6.6, §6.8).
 * Repositories and the CAPI client are stubbed; the assertions are on the
 * payload handed to Meta.
 */

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestEnv } from '../helpers/testEnv.ts';

applyTestEnv();

const sendMetaCapiEvent = vi.fn(async () => undefined);
const getOrderById = vi.fn();
const listByOrderId = vi.fn();
const query = vi.fn();
const claimPurchaseLog = vi.fn();

vi.mock('../../src/services/analytics/metaCapi.js', () => ({ sendMetaCapiEvent }));
vi.mock('../../src/lib/transaction.js', () => ({
  withTransaction: async (fn: (c: unknown) => unknown) => fn({ query }),
}));
vi.mock('../../src/repositories/orders.repository.js', () => ({ getOrderById }));
vi.mock('../../src/repositories/analytics.repository.js', () => ({ claimPurchaseLog }));
vi.mock('../../src/repositories/orderItems.repository.js', () => ({ listByOrderId }));

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/** The emitter is fire-and-forget; wait for its microtasks to settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  vi.clearAllMocks();
  claimPurchaseLog.mockResolvedValue('log-1');
  getOrderById.mockResolvedValue({
    id: 'order-1',
    order_number: 'FB-1001',
    customer_id: 'cust-1',
    total_amount: 850, // coupon-discounted final total, not the 1000 subtotal
    subtotal: 1000,
    full_name: 'Rahim Uddin',
    phone_number: '01712345678',
    bkash_transaction_id: 'TXN-SECRET-123',
  });
  listByOrderId.mockResolvedValue([
    { product_id: 'p1', product_variant_id: 'v1', quantity: 2, unitPrice: 500 },
  ]);
  query.mockResolvedValue({ rows: [{ email: 'Rahim@Example.com ' }] });
});

describe('emitPurchaseForOrder', () => {
  it('sends one Purchase with the stored discounted total, BDT, and a deterministic order-number event_id', async () => {
    const { emitPurchaseForOrder } = await import('../../src/services/analytics/purchaseEvent.js');
    emitPurchaseForOrder('order-1');
    await settle();

    expect(sendMetaCapiEvent).toHaveBeenCalledTimes(1);
    const [payload, , ctx] = sendMetaCapiEvent.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
      { orderId: string; logId: string; valueAmount: number },
    ];
    expect(payload.event_name).toBe('Purchase');
    expect(payload.event_id).toBe('purchase:FB-1001');
    expect(payload.value).toBe(850);
    expect(payload.currency).toBe('BDT');
    expect(payload.num_items).toBe(2);
    expect(payload.content_ids).toEqual(['v1']);
    expect(ctx.orderId).toBe('order-1');
    expect(ctx.logId).toBe('log-1');
    expect(ctx.valueAmount).toBe(850);
  });

  it('makes no outbound send when the Purchase slot is already claimed (exactly once, §6.3)', async () => {
    claimPurchaseLog.mockResolvedValueOnce(null);
    const { emitPurchaseForOrder } = await import('../../src/services/analytics/purchaseEvent.js');
    emitPurchaseForOrder('order-1');
    await settle();
    expect(sendMetaCapiEvent).not.toHaveBeenCalled();
  });

  it('hashes customer identifiers and never leaks the bKash Transaction ID (§6.5, §6.6)', async () => {
    const { emitPurchaseForOrder } = await import('../../src/services/analytics/purchaseEvent.js');
    emitPurchaseForOrder('order-1');
    await settle();

    const [payload, user] = sendMetaCapiEvent.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, string>,
    ];
    expect(user.em).toBe(sha('rahim@example.com'));
    expect(user.ph).toBe(sha('8801712345678')); // international form, hashed
    expect(user.fn).toBe(sha('rahim'));
    expect(user.ln).toBe(sha('uddin'));

    const serialized = JSON.stringify([payload, user]);
    expect(serialized).not.toContain('TXN-SECRET-123');
    expect(serialized).not.toContain('Rahim@Example.com');
    expect(serialized).not.toContain('01712345678');
  });

  it('swallows lookup failures so the confirmation is never affected (§6.8)', async () => {
    getOrderById.mockRejectedValueOnce(new Error('db down'));
    const { emitPurchaseForOrder } = await import('../../src/services/analytics/purchaseEvent.js');

    expect(() => emitPurchaseForOrder('order-1')).not.toThrow();
    await settle();
    expect(sendMetaCapiEvent).not.toHaveBeenCalled();
  });
});
