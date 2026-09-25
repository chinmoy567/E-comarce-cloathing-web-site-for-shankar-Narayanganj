import { describe, expect, it } from 'vitest';
import {
  validateCoupon,
  type CouponRecordForValidation,
  type CouponValidationLine,
} from '../../src/services/coupon/validateCoupon.js';

/**
 * Spec 10 — the coupon validation/calculation engine (S4, pure function).
 * Covers plan §8 items 1–9, 14–19 (money, ordering, lifecycle, eligibility,
 * non-enumeration). §8.14/§8.6/§8.22 values are transcribed here from the
 * PRD, never imported from src/ (test skill §0).
 */

const NOW = new Date('2026-10-05T12:00:00.000Z');

function line(overrides: Partial<CouponValidationLine> = {}): CouponValidationLine {
  return {
    variantId: '00000000-0000-4000-8000-000000000001',
    productId: '00000000-0000-4000-8000-000000000002',
    categoryId: '00000000-0000-4000-8000-000000000003',
    quantity: 1,
    unitPrice: 1000,
    lineTotal: 1000,
    ...overrides,
  };
}

function coupon(overrides: Partial<CouponRecordForValidation> = {}): CouponRecordForValidation {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    code: 'SAVE20',
    status: 'ACTIVE',
    isArchived: false,
    startsAt: new Date('2026-10-01T00:00:00.000Z'),
    expiresAt: new Date('2026-10-15T23:59:00.000Z'),
    usageLimit: null,
    usageCount: 0,
    perCustomerLimit: null,
    discountType: 'PERCENTAGE',
    discountValue: 20,
    maximumDiscountAmount: null,
    minimumOrderAmount: null,
    customerEligibility: 'ALL_CUSTOMERS',
    eligibleCustomerId: null,
    ...overrides,
  };
}

const GUEST = { customerId: '00000000-0000-4000-8000-000000000099', isRegistered: false };
const REGISTERED = { customerId: '00000000-0000-4000-8000-000000000098', isRegistered: true };

// ---------------------------------------------------------------------------
// Test 1: Percentage calculation (§8.14a)
// ---------------------------------------------------------------------------
describe('percentage discount calculation (§8.14a, test 1)', () => {
  it('20% off ৳2,500 yields ৳500 (acceptance 11)', () => {
    const result = validateCoupon({
      coupon: coupon({ discountType: 'PERCENTAGE', discountValue: 20 }),
      lines: [line({ lineTotal: 2500, unitPrice: 2500 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.eligibleSubtotal).toBe(2500);
      expect(result.discountAmount).toBe(500);
    }
  });

  it('20% off ৳4,000 capped at ৳300 yields ৳300 (§8.10)', () => {
    const result = validateCoupon({
      coupon: coupon({ discountType: 'PERCENTAGE', discountValue: 20, maximumDiscountAmount: 300 }),
      lines: [line({ lineTotal: 4000, unitPrice: 4000 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(300);
  });

  it('7.5% of ৳1,333 rounds half-up to the nearest poisha', () => {
    const result = validateCoupon({
      coupon: coupon({ discountType: 'PERCENTAGE', discountValue: 7.5 }),
      lines: [line({ lineTotal: 1333, unitPrice: 1333 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
    // 1333 * 7.5 / 100 = 99.975 -> half-up to 99.98 (poisha: 9997.5 -> 9998).
    if (result.valid) expect(result.discountAmount).toBe(99.98);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Fixed-amount calculation (§8.14b)
// ---------------------------------------------------------------------------
describe('fixed-amount discount calculation (§8.14b, test 2)', () => {
  it('a ৳500 fixed coupon on a ৳200 subtotal clamps to ৳200, never negative (acceptance 12)', () => {
    const result = validateCoupon({
      coupon: coupon({ discountType: 'FIXED_AMOUNT', discountValue: 500 }),
      lines: [line({ lineTotal: 200, unitPrice: 200 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.discountAmount).toBe(200);
      expect(result.discountAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it('a ৳100 fixed coupon on a ৳3,000 subtotal yields exactly ৳100', () => {
    const result = validateCoupon({
      coupon: coupon({ discountType: 'FIXED_AMOUNT', discountValue: 100 }),
      lines: [line({ lineTotal: 3000, unitPrice: 3000 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Test 3: shipping is never an input (§8.14c)
// ---------------------------------------------------------------------------
describe('shipping is never an input to the engine (§8.14c, test 3)', () => {
  it('the discount and eligible subtotal are identical regardless of what a caller later adds as shipping', () => {
    const result = validateCoupon({
      coupon: coupon({ discountType: 'PERCENTAGE', discountValue: 10 }),
      lines: [line({ lineTotal: 3000, unitPrice: 3000 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      // Engine's CouponValidationInput has no shipping field at all — this
      // assertion documents that omission structurally, not just numerically.
      expect(result.eligibleSubtotal).toBe(3000);
      expect(result.discountAmount).toBe(300);
      expect((result as Record<string, unknown>).shipping).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4: minimum order boundary (§8.10)
// ---------------------------------------------------------------------------
describe('minimum order amount boundary (§8.10, test 4)', () => {
  it('exactly at the minimum passes', () => {
    const result = validateCoupon({
      coupon: coupon({ minimumOrderAmount: 2000 }),
      lines: [line({ lineTotal: 2000, unitPrice: 2000 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('one taka below the minimum fails with the exact message', () => {
    const result = validateCoupon({
      coupon: coupon({ minimumOrderAmount: 2000 }),
      lines: [line({ lineTotal: 1999, unitPrice: 1999 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'This coupon requires a minimum order of ৳2000.' });
  });
});

// ---------------------------------------------------------------------------
// Test 5: maximum discount cap boundary (§8.10)
// ---------------------------------------------------------------------------
describe('maximum discount cap boundary (§8.10, test 5)', () => {
  it('at the cap, the discount equals the cap exactly', () => {
    // 20% of 1500 = 300, cap = 300 -> exactly at the cap.
    const result = validateCoupon({
      coupon: coupon({ discountType: 'PERCENTAGE', discountValue: 20, maximumDiscountAmount: 300 }),
      lines: [line({ lineTotal: 1500, unitPrice: 1500 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(300);
  });

  it('just above the cap, the discount is clamped to the cap', () => {
    // 20% of 1501 = 300.20, cap = 300 -> clamped.
    const result = validateCoupon({
      coupon: coupon({ discountType: 'PERCENTAGE', discountValue: 20, maximumDiscountAmount: 300 }),
      lines: [line({ lineTotal: 1501, unitPrice: 1501 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Test 6: validation order (§8.6) — earliest failure wins
// ---------------------------------------------------------------------------
describe('validation order — earliest failing check wins (§8.6, test 6, acceptance 8)', () => {
  it('expired AND below minimum order returns the expired message (step 2 precedes step 7)', () => {
    const result = validateCoupon({
      coupon: coupon({
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
        minimumOrderAmount: 5000,
      }),
      lines: [line({ lineTotal: 100, unitPrice: 100 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'This coupon has expired.' });
  });

  it('disabled AND expired returns the generic invalid-code message (step 1 precedes step 2)', () => {
    const result = validateCoupon({
      coupon: coupon({
        status: 'DISABLED',
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'Invalid coupon code.' });
  });

  it('usage-limit-reached AND below minimum order returns the usage-limit message (step 3 precedes step 7)', () => {
    const result = validateCoupon({
      coupon: coupon({ usageLimit: 5, usageCount: 5, minimumOrderAmount: 5000 }),
      lines: [line({ lineTotal: 100, unitPrice: 100 })],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'This coupon has reached its usage limit.' });
  });
});

// ---------------------------------------------------------------------------
// Test 7: lifecycle rejection messages (§8.6, §8.22)
// ---------------------------------------------------------------------------
describe('lifecycle rejection messages (§8.6, §8.22, test 7, acceptance 7)', () => {
  it('DRAFT -> generic invalid-code message', () => {
    const result = validateCoupon({
      coupon: coupon({ status: 'DRAFT' }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'Invalid coupon code.' });
  });

  it('DISABLED -> generic invalid-code message', () => {
    const result = validateCoupon({
      coupon: coupon({ status: 'DISABLED' }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'Invalid coupon code.' });
  });

  it('archived -> generic invalid-code message regardless of status', () => {
    const result = validateCoupon({
      coupon: coupon({ status: 'ACTIVE', isArchived: true }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'Invalid coupon code.' });
  });

  it('not yet started -> specific message', () => {
    const result = validateCoupon({
      coupon: coupon({ startsAt: new Date('2026-11-01T00:00:00.000Z'), expiresAt: new Date('2026-11-15T00:00:00.000Z') }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'This coupon is not active yet.' });
  });

  it('expired -> specific message', () => {
    const result = validateCoupon({
      coupon: coupon({ startsAt: new Date('2026-01-01T00:00:00.000Z'), expiresAt: new Date('2026-02-01T00:00:00.000Z') }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'This coupon has expired.' });
  });
});

// ---------------------------------------------------------------------------
// Test 8: non-enumeration (§8.22, §8.28)
// ---------------------------------------------------------------------------
describe('non-enumeration — byte-identical responses (§8.22, §8.28, test 8, acceptance 6)', () => {
  it('nonexistent, DISABLED, and archived all produce the identical response', () => {
    const nonexistent = validateCoupon({
      coupon: null,
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: null,
      now: NOW,
    });
    const disabled = validateCoupon({
      coupon: coupon({ status: 'DISABLED' }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    const archived = validateCoupon({
      coupon: coupon({ isArchived: true }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    const draft = validateCoupon({
      coupon: coupon({ status: 'DRAFT' }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });

    expect(nonexistent).toEqual({ valid: false, message: 'Invalid coupon code.' });
    expect(disabled).toEqual(nonexistent);
    expect(archived).toEqual(nonexistent);
    expect(draft).toEqual(nonexistent);
  });
});

// ---------------------------------------------------------------------------
// Test 9: customer eligibility (§8.13)
// ---------------------------------------------------------------------------
describe('customer eligibility (§8.13, test 9, acceptance 10)', () => {
  it('ALL_CUSTOMERS works for a guest', () => {
    const result = validateCoupon({
      coupon: coupon({ customerEligibility: 'ALL_CUSTOMERS' }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('REGISTERED_CUSTOMERS_ONLY rejects a guest with the specific message', () => {
    const result = validateCoupon({
      coupon: coupon({ customerEligibility: 'REGISTERED_CUSTOMERS_ONLY' }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({
      valid: false,
      message: 'This coupon is available only to registered customers.',
    });
  });

  it('REGISTERED_CUSTOMERS_ONLY accepts a registered customer', () => {
    const result = validateCoupon({
      coupon: coupon({ customerEligibility: 'REGISTERED_CUSTOMERS_ONLY' }),
      lines: [line()],
      customer: REGISTERED,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('REGISTERED_CUSTOMERS_ONLY rejects when no customer identity is present at all', () => {
    const result = validateCoupon({
      coupon: coupon({ customerEligibility: 'REGISTERED_CUSTOMERS_ONLY' }),
      lines: [line()],
      customer: null,
      perCustomerUsageCount: null,
      now: NOW,
    });
    expect(result).toEqual({
      valid: false,
      message: 'This coupon is available only to registered customers.',
    });
  });
});

// ---------------------------------------------------------------------------
// Test 10: total usage limit (§8.8)
// ---------------------------------------------------------------------------
describe('total usage limit (§8.8, test 10, acceptance 9)', () => {
  it('blocks the next attempt once the limit is reached', () => {
    const result = validateCoupon({
      coupon: coupon({ usageLimit: 100, usageCount: 100 }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'This coupon has reached its usage limit.' });
  });

  it('one below the limit still succeeds', () => {
    const result = validateCoupon({
      coupon: coupon({ usageLimit: 100, usageCount: 99 }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 11: per-customer usage limit (§8.8)
// ---------------------------------------------------------------------------
describe('per-customer usage limit (§8.8, test 11)', () => {
  it('rejects a customer who has already used the coupon per_customer_limit times', () => {
    const result = validateCoupon({
      coupon: coupon({ perCustomerLimit: 1 }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 1,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'You have already used this coupon.' });
  });

  it('a different guest phone (different customerId) is unaffected — enforced by customer_id (§8.28 accepted residual risk)', () => {
    const result = validateCoupon({
      coupon: coupon({ perCustomerLimit: 1 }),
      lines: [line()],
      customer: { customerId: 'different-guest-id', isRegistered: false },
      perCustomerUsageCount: 0,
      now: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('works identically for a registered customer keyed by customerId', () => {
    const result = validateCoupon({
      coupon: coupon({ perCustomerLimit: 1 }),
      lines: [line()],
      customer: REGISTERED,
      perCustomerUsageCount: 1,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, message: 'You have already used this coupon.' });
  });

  it('a null perCustomerUsageCount (unknown at preview time) skips step 4 entirely', () => {
    const result = validateCoupon({
      coupon: coupon({ perCustomerLimit: 1 }),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: null,
      now: NOW,
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 16: server time only (§8.5)
// ---------------------------------------------------------------------------
describe('server time only — no client-supplied timestamp field exists (§8.5, test 16)', () => {
  it('the input type has no client-clock field; only `now` (server-set by the caller) drives expiry', () => {
    // The coupon is only valid across [2026-10-01, 2026-10-15]. Supplying
    // NOW as the server clock outside that window rejects it regardless of
    // any value a client might have tried to smuggle in — there is no such
    // field on CouponValidationInput to smuggle it into.
    const beforeStart = validateCoupon({
      coupon: coupon(),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(beforeStart).toEqual({ valid: false, message: 'This coupon is not active yet.' });

    const afterExpiry = validateCoupon({
      coupon: coupon(),
      lines: [line()],
      customer: GUEST,
      perCustomerUsageCount: 0,
      now: new Date('2026-12-01T00:00:00.000Z'),
    });
    expect(afterExpiry).toEqual({ valid: false, message: 'This coupon has expired.' });
  });
});
