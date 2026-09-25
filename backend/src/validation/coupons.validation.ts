import { z } from 'zod';
import { paginationQuerySchema } from '../lib/pagination.js';

/**
 * Coupon request schemas (10-coupon-discount §8, plan §3/§5). `.strict()`
 * throughout — a submitted `discountAmount`, `subtotal`, `total`, or any
 * other unrecognized field is a 400, never silently ignored (§8.16,
 * 11-security-hardening §11.6).
 */

// ---------------------------------------------------------------------------
// Public: POST /api/coupons/validate (§8.15a, §8.18)
// ---------------------------------------------------------------------------

const validateCouponLineSchema = z
  .object({
    variantId: z.string().uuid('Must be a valid id.'),
    quantity: z.coerce.number().int().positive('Must be a positive integer.'),
  })
  .strict();

export const validateCouponSchema = z
  .object({
    code: z.string().trim().min(1, 'Required.').max(64, 'Must be at most 64 characters.'),
    lines: z.array(validateCouponLineSchema).min(1, 'At least one cart line is required.'),
  })
  .strict();
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;

// ---------------------------------------------------------------------------
// Admin: coupon CRUD (§8.3, §8.24a)
// ---------------------------------------------------------------------------

const discountTypeSchema = z.enum(['PERCENTAGE', 'FIXED_AMOUNT']);
const couponStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'DISABLED']);
const customerEligibilitySchema = z.enum(['ALL_CUSTOMERS', 'REGISTERED_CUSTOMERS_ONLY', 'SPECIFIC_CUSTOMER']);

const codeSchema = z
  .string()
  .trim()
  .min(3, 'Must be at least 3 characters.')
  .max(32, 'Must be at most 32 characters.')
  .regex(/^[a-zA-Z0-9_-]+$/, 'May only contain letters, numbers, underscores, and hyphens.');

export const createCouponSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(1, 'Required.').max(120, 'Must be at most 120 characters.'),
    description: z.string().trim().max(2000).nullable().optional(),
    discountType: discountTypeSchema,
    discountValue: z.coerce.number().positive('Must be greater than zero.'),
    minimumOrderAmount: z.coerce.number().nonnegative().nullable().optional(),
    maximumDiscountAmount: z.coerce.number().positive().nullable().optional(),
    startsAt: z.coerce.date(),
    expiresAt: z.coerce.date(),
    usageLimit: z.coerce.number().int().positive().nullable().optional(),
    perCustomerLimit: z.coerce.number().int().positive().nullable().optional(),
    customerEligibility: customerEligibilitySchema.optional(),
    eligibleCustomerId: z.string().uuid().nullable().optional(),
    status: couponStatusSchema.optional(),
  })
  .strict();
export type CreateCouponRequest = z.infer<typeof createCouponSchema>;

export const updateCouponSchema = z
  .object({
    code: codeSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    discountType: discountTypeSchema.optional(),
    discountValue: z.coerce.number().positive().optional(),
    minimumOrderAmount: z.coerce.number().nonnegative().nullable().optional(),
    maximumDiscountAmount: z.coerce.number().positive().nullable().optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    usageLimit: z.coerce.number().int().positive().nullable().optional(),
    perCustomerLimit: z.coerce.number().int().positive().nullable().optional(),
    customerEligibility: customerEligibilitySchema.optional(),
    eligibleCustomerId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type UpdateCouponRequest = z.infer<typeof updateCouponSchema>;

export const setCouponStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'DISABLED']),
  })
  .strict();
export type SetCouponStatusRequest = z.infer<typeof setCouponStatusSchema>;

export const couponIdParamsSchema = z.object({ id: z.string().uuid('Must be a valid id.') }).strict();

export const listCouponsQuerySchema = paginationQuerySchema.extend({
  status: couponStatusSchema.optional(),
  discountType: discountTypeSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListCouponsQuery = z.infer<typeof listCouponsQuerySchema>;

export const listCouponUsagesQuerySchema = paginationQuerySchema;
