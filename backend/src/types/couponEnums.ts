/**
 * TypeScript mirrors of the coupon database enums (migration 0009_coupons.sql).
 *
 * Each list must stay identical to its Postgres enum (checked by
 * backend/tests/shared/enums.parity.test.ts). `coupon.repository.ts` derives its
 * exported types from these lists so there is one source on the TypeScript side.
 */

/** 10-coupon-discount §8.2 — how a coupon's value is applied. */
export const DISCOUNT_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** Stored coupon statuses; SCHEDULED/EXPIRED are computed-only labels, never persisted. */
export const COUPON_STATUSES = ['DRAFT', 'ACTIVE', 'DISABLED'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

export const CUSTOMER_ELIGIBILITIES = ['ALL_CUSTOMERS', 'REGISTERED_CUSTOMERS_ONLY', 'SPECIFIC_CUSTOMER'] as const;
export type CustomerEligibility = (typeof CUSTOMER_ELIGIBILITIES)[number];

export const PRODUCT_ELIGIBILITIES = ['ALL_PRODUCTS', 'SPECIFIC_PRODUCTS', 'SPECIFIC_CATEGORIES'] as const;
export type ProductEligibility = (typeof PRODUCT_ELIGIBILITIES)[number];
