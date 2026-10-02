/**
 * Spec 18 — the browser Pixel copy of Purchase must not be offered for a cancelled or
 * returned order (08-analytics-meta §6.3). Repositories are stubbed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestEnv } from '../helpers/testEnv.ts';

applyTestEnv();

const hasPurchaseLog = vi.fn();

vi.mock('../../src/repositories/analytics.repository.js', () => ({ hasPurchaseLog }));

const { purchaseEventIdForView } = await import('../../src/services/customerOrderViews.service.js');

const order = (status: string) => ({ id: 'o1', order_number: 'FBK-20261002-ABC123', order_status: status }) as never;

describe('purchaseEventIdForView', () => {
  beforeEach(() => hasPurchaseLog.mockReset());

  it('returns the deterministic id for a confirmed order that has a Purchase log', async () => {
    hasPurchaseLog.mockResolvedValue(true);
    expect(await purchaseEventIdForView(order('CONFIRMED'))).toBe('purchase:FBK-20261002-ABC123');
  });

  it('returns null before a Purchase was claimed', async () => {
    hasPurchaseLog.mockResolvedValue(false);
    expect(await purchaseEventIdForView(order('PENDING_CONFIRMATION'))).toBeNull();
  });

  it.each(['CANCELLED', 'RETURNED'])('returns null for a %s order even though a Purchase log exists', async (status) => {
    hasPurchaseLog.mockResolvedValue(true);
    expect(await purchaseEventIdForView(order(status))).toBeNull();
  });
});
