import { describe, expect, it } from 'vitest';
import { analyticsEventRequestSchema } from '../../src/validation/analytics.validation.ts';
import { buildMetaUserData } from '../../src/services/analytics/metaUserData.ts';

const base = {
  eventName: 'AddToCart',
  eventId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  eventSourceUrl: 'https://fabrillke.com/products/x',
};

describe('analytics ingestion schema (spec 18)', () => {
  it('accepts contents with ids and integer quantities plus fbp/fbc', () => {
    const r = analyticsEventRequestSchema.safeParse({
      ...base,
      payload: { contents: [{ id: 'v1', quantity: 2 }] },
      fbp: 'fb.1.1700000000.123456',
      fbc: 'fb.1.1700000000.AbC_d-1',
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ['a price inside contents', { contents: [{ id: 'v1', quantity: 1, price: 5 }] }],
    ['an item_price inside contents', { contents: [{ id: 'v1', quantity: 1, item_price: 5 }] }],
    ['a payload value', { value: 100 }],
    ['a fractional quantity', { contents: [{ id: 'v1', quantity: 1.5 }] }],
  ])('rejects %s', (_label, payload) => {
    expect(analyticsEventRequestSchema.safeParse({ ...base, payload }).success).toBe(false);
  });

  it('rejects Purchase, a top-level value, and a malformed fbp', () => {
    expect(analyticsEventRequestSchema.safeParse({ ...base, eventName: 'Purchase', payload: {} }).success).toBe(false);
    expect(analyticsEventRequestSchema.safeParse({ ...base, payload: {}, value: 1 }).success).toBe(false);
    expect(analyticsEventRequestSchema.safeParse({ ...base, payload: {}, fbp: 'not-a-cookie' }).success).toBe(false);
  });
});

describe('buildMetaUserData phone normalisation', () => {
  it('hashes a Bangladesh local number in international form', () => {
    const local = buildMetaUserData({ phone: '01712345678' });
    const intl = buildMetaUserData({ phone: '+880 1712-345678' });
    expect(local.ph).toBe(intl.ph);
    expect(local.ph).toMatch(/^[0-9a-f]{64}$/);
  });
});
