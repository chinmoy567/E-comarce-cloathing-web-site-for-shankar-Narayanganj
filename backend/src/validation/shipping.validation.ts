import { z } from 'zod';
import { paginationQuerySchema } from '../lib/pagination.js';

/**
 * Shipping request schemas (spec 21). `.strict()` throughout — a client-supplied `shipping`,
 * `shipping_amount`, `subtotal` or `total` is a 400, never silently ignored (11-security-hardening
 * §11.4/§11.6). The client never sends `isMetropolitan`: it is derived server-side from `areaUnitType`.
 */

const areaUnitTypeSchema = z.enum(['UPAZILA', 'THANA']);
const districtSchema = z.string().trim().min(1, 'Required.').max(100, 'Must be at most 100 characters.');

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** GET /api/shipping/quote — advisory, coupon- and cart-unaware (base charge for a district). */
export const shippingQuoteQuerySchema = z
  .object({
    district: districtSchema,
    areaUnitType: areaUnitTypeSchema,
  })
  .strict();
export type ShippingQuoteQuery = z.infer<typeof shippingQuoteQuerySchema>;

const checkoutValidateLineSchema = z
  .object({
    productId: z.string().uuid('Must be a valid id.'),
    variantId: z.string().uuid('Must be a valid id.').nullable().optional(),
    quantity: z.coerce.number().int().positive('Must be a positive integer.'),
  })
  .strict();

/** POST /api/checkout/validate — advisory; createOrder() always recomputes. */
export const checkoutValidateSchema = z
  .object({
    lines: z.array(checkoutValidateLineSchema).min(1, 'Your cart is empty.').max(50, 'Too many items.'),
    couponCode: z.string().trim().max(64).nullable().optional(),
    // Omitted for a registered customer: the profile address is used.
    delivery: z.object({ district: districtSchema, areaUnitType: areaUnitTypeSchema }).strict().optional(),
  })
  .strict();
export type CheckoutValidateRequest = z.infer<typeof checkoutValidateSchema>;

// ---------------------------------------------------------------------------
// Admin (system.configure)
// ---------------------------------------------------------------------------

export const zoneIdParamsSchema = z.object({ id: z.string().uuid('Must be a valid id.') }).strict();

const districtMappingSchema = z
  .object({
    district: districtSchema,
    metroOnly: z.boolean(),
  })
  .strict();

const districtsSchema = z.array(districtMappingSchema).max(200, 'At most 200 districts.');

const zoneCodeSchema = z
  .string()
  .trim()
  .min(2, 'Must be at least 2 characters.')
  .max(40, 'Must be at most 40 characters.')
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Use uppercase letters, digits and underscores.');

const zoneNameSchema = z.string().trim().min(1, 'Required.').max(80, 'Must be at most 80 characters.');
const sortOrderSchema = z.coerce.number().int().min(0).max(10_000);

const MAX_AMOUNT = 1_000_000;
const amountSchema = z.coerce
  .number()
  .min(0, 'Must be zero or more.')
  .max(MAX_AMOUNT, 'Too large.')
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, { message: 'At most 2 decimal places.' });

export const createRateSchema = z
  .object({
    strategy: z.enum(['FLAT', 'FREE', 'FREE_OVER_THRESHOLD']),
    flatAmount: amountSchema.optional(),
    freeOverAmount: amountSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.strategy !== 'FREE' && v.flatAmount === undefined) {
      ctx.addIssue({ code: 'custom', path: ['flatAmount'], message: 'Required.' });
    }
    if (v.strategy === 'FREE' && v.flatAmount !== undefined && v.flatAmount !== 0) {
      ctx.addIssue({ code: 'custom', path: ['flatAmount'], message: 'Must be omitted or 0 for a free rate.' });
    }
    if (v.strategy === 'FREE_OVER_THRESHOLD' && v.freeOverAmount === undefined) {
      ctx.addIssue({ code: 'custom', path: ['freeOverAmount'], message: 'Required.' });
    }
    if (v.strategy !== 'FREE_OVER_THRESHOLD' && v.freeOverAmount !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['freeOverAmount'],
        message: 'Only allowed for a free-over-threshold rate.',
      });
    }
  });
export const createZoneSchema = z
  .object({
    code: zoneCodeSchema,
    name: zoneNameSchema,
    sortOrder: sortOrderSchema.optional(),
    districts: districtsSchema,
    // Optional initial rate; required whenever districts are assigned (a zone with no rate cannot price an order).
    rate: createRateSchema.optional(),
  })
  .strict();
export type CreateZoneRequest = z.infer<typeof createZoneSchema>;

/** `districts`, when present, is the FULL replacement list. */
export const updateZoneSchema = z
  .object({
    name: zoneNameSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    districts: districtsSchema.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.sortOrder !== undefined || v.districts !== undefined, {
    message: 'Provide at least one field to update.',
  });
export type UpdateZoneRequest = z.infer<typeof updateZoneSchema>;

export type CreateRateRequest = z.infer<typeof createRateSchema>;

export const listRatesQuerySchema = paginationQuerySchema;
export const listUnmatchedQuerySchema = paginationQuerySchema;
