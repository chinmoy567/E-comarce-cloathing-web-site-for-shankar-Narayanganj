/**
 * The single coupon validation-and-calculation engine (10-coupon-discount
 * §8.6, §8.14, §8.20). Both the public preview endpoint (`POST
 * /api/coupons/validate`) and, later, spec 11's order-creation revalidation
 * call this exact function — guest and registered customers share one
 * engine, never two implementations.
 *
 * All money arithmetic here is done in integer poisha (1 BDT = 100 poisha),
 * never floating point, so the half-up rounding in §8.14a is exact and this
 * function produces byte-identical results at preview time and at (future)
 * order-creation revalidation — a difference of even one poisha would make
 * spec 11's revalidation reject a legitimate order.
 */

export type CouponEligibility = {
  customerEligibility: 'ALL_CUSTOMERS' | 'REGISTERED_CUSTOMERS_ONLY' | 'SPECIFIC_CUSTOMER';
  eligibleCustomerId: string | null;
};

export type CouponRecordForValidation = {
  id: string;
  code: string;
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  isArchived: boolean;
  startsAt: Date;
  expiresAt: Date;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  maximumDiscountAmount: number | null;
  minimumOrderAmount: number | null;
} & CouponEligibility;

export type CouponValidationLine = {
  variantId: string;
  productId: string;
  categoryId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type CouponValidationCustomer = {
  customerId: string | null;
  isRegistered: boolean;
};

export type CouponValidationInput = {
  /** The coupon row looked up by normalized code, or null if no match. */
  coupon: CouponRecordForValidation | null;
  lines: CouponValidationLine[];
  customer: CouponValidationCustomer | null;
  /** This customer's completed-usage count for this coupon, or null when unknown (skips step 4 at preview time — see plan §2). */
  perCustomerUsageCount: number | null;
  /** Server clock only (§8.5) — never a client-supplied timestamp. */
  now: Date;
};

export type CouponValidationSuccess = {
  valid: true;
  couponId: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  eligibleSubtotal: number;
  discountAmount: number;
  message: string;
};

export type CouponValidationFailure = {
  valid: false;
  message: string;
};

export type CouponValidationResult = CouponValidationSuccess | CouponValidationFailure;

// ---------------------------------------------------------------------------
// §8.22 exact customer-facing messages.
// ---------------------------------------------------------------------------
const MSG_INVALID_CODE = 'Invalid coupon code.';
const MSG_NOT_STARTED = 'This coupon is not active yet.';
const MSG_EXPIRED = 'This coupon has expired.';
const MSG_USAGE_LIMIT_REACHED = 'This coupon has reached its usage limit.';
const MSG_ALREADY_USED = 'You have already used this coupon.';
const MSG_REGISTERED_ONLY = 'This coupon is available only to registered customers.';

function minimumOrderMessage(minimumOrderAmount: number): string {
  return `This coupon requires a minimum order of ৳${formatAmount(minimumOrderAmount)}.`;
}

function successMessage(discountAmount: number): string {
  return `Coupon applied successfully. You saved ৳${formatAmount(discountAmount)}.`;
}

// ---------------------------------------------------------------------------
// Decimal-safe money helpers — integer poisha, never floating point.
// ---------------------------------------------------------------------------

/** BDT amount (up to 2 decimal places) -> integer poisha. */
function toPoisha(amount: number): number {
  return Math.round(amount * 100);
}

/** Integer poisha -> BDT amount with exactly 2 decimal places. */
function fromPoisha(poisha: number): number {
  return Math.round(poisha) / 100;
}

function formatAmount(amount: number): string {
  return amount.toFixed(2).replace(/\.00$/, '');
}

/**
 * Half-up rounding of `numerator / denominator` poisha to the nearest whole
 * poisha — matches `numeric(12,2)` column semantics exactly, done with
 * integer arithmetic so there is no floating-point drift.
 */
function divideHalfUp(numerator: number, denominator: number): number {
  const quotient = numerator / denominator;
  return Math.floor(quotient + 0.5);
}

// ---------------------------------------------------------------------------
// The seven-step evaluation order (§8.6), stopping at the first failure.
// ---------------------------------------------------------------------------

export function validateCoupon(input: CouponValidationInput): CouponValidationResult {
  const { coupon, lines, customer, perCustomerUsageCount, now } = input;

  // Step 0/1: not found, DRAFT, DISABLED, or archived are all indistinguishable
  // (§8.22, §8.28 non-enumeration) — one identical message for every case.
  if (!coupon || coupon.status !== 'ACTIVE' || coupon.isArchived) {
    return { valid: false, message: MSG_INVALID_CODE };
  }

  // Step 2: validity window, server time only.
  if (now.getTime() < coupon.startsAt.getTime()) {
    return { valid: false, message: MSG_NOT_STARTED };
  }
  if (now.getTime() > coupon.expiresAt.getTime()) {
    return { valid: false, message: MSG_EXPIRED };
  }

  // Step 3: total usage limit.
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, message: MSG_USAGE_LIMIT_REACHED };
  }

  // Step 4: per-customer usage limit. Skipped when the caller has no
  // customer-usage count yet available (e.g. a guest preview before a phone
  // number has been supplied) — deferred to order-creation time, per plan §2.
  if (
    coupon.perCustomerLimit !== null &&
    perCustomerUsageCount !== null &&
    perCustomerUsageCount >= coupon.perCustomerLimit
  ) {
    return { valid: false, message: MSG_ALREADY_USED };
  }

  // Step 5: customer eligibility.
  if (coupon.customerEligibility === 'REGISTERED_CUSTOMERS_ONLY') {
    if (!customer || !customer.isRegistered) {
      return { valid: false, message: MSG_REGISTERED_ONLY };
    }
  }
  // SPECIFIC_CUSTOMER eligibility enforcement is deferred (§8.13, plan §10) —
  // ALL_CUSTOMERS and REGISTERED_CUSTOMERS_ONLY are the only enforced values.

  // Step 6: product/category eligibility — deliberately skipped in v1 (§8.12).
  // Every coupon behaves as ALL_PRODUCTS; eligibleLines is always every line.
  const eligibleLines = lines;

  const eligibleSubtotalPoisha = eligibleLines.reduce((sum, line) => sum + toPoisha(line.lineTotal), 0);
  const eligibleSubtotal = fromPoisha(eligibleSubtotalPoisha);

  // Step 7: minimum order amount, evaluated against the eligible subtotal.
  if (coupon.minimumOrderAmount !== null && eligibleSubtotal < coupon.minimumOrderAmount) {
    return { valid: false, message: minimumOrderMessage(coupon.minimumOrderAmount) };
  }

  // §8.14 calculation chain — runs only after every check passes.
  const discountAmount = computeDiscountPoisha(coupon, eligibleSubtotalPoisha);

  return {
    valid: true,
    couponId: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    eligibleSubtotal,
    discountAmount: fromPoisha(discountAmount),
    message: successMessage(fromPoisha(discountAmount)),
  };
}

/** §8.14a/§8.14b, in integer poisha. Never below zero (§8.14b). */
function computeDiscountPoisha(coupon: CouponRecordForValidation, eligibleSubtotalPoisha: number): number {
  if (coupon.discountType === 'PERCENTAGE') {
    // round(eligible_subtotal × discount_value / 100), half-up to the nearest poisha.
    const discountValuePoisha = toPoisha(coupon.discountValue);
    let discount = divideHalfUp(eligibleSubtotalPoisha * discountValuePoisha, 100 * 100);
    if (coupon.maximumDiscountAmount !== null) {
      discount = Math.min(discount, toPoisha(coupon.maximumDiscountAmount));
    }
    return Math.max(0, Math.min(discount, eligibleSubtotalPoisha));
  }

  // FIXED_AMOUNT: min(discount_value, eligible_subtotal), never negative.
  const discountValuePoisha = toPoisha(coupon.discountValue);
  return Math.max(0, Math.min(discountValuePoisha, eligibleSubtotalPoisha));
}
