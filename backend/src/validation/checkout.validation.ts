import { z } from 'zod';
import { paginationQuerySchema } from '../lib/pagination.js';

/**
 * Checkout request schemas (spec 11 — 02-customer §2.9.2/§2.9.3,
 * 03-payment-order §3.1).
 *
 * Deliberately SHAPE-ONLY for the guest fields sub-object — NOT the full
 * `guestCheckoutSchema` from `customer.validation.ts`. §2.9.3 requires
 * strict, ordered, fail-fast validation (stopping at the first failing
 * field), but `validate()`'s zod-based middleware runs `safeParse` and
 * reports every invalid field in parallel. Mounting `guestCheckoutSchema`
 * here would contradict that ordering. `checkout.service.ts` re-implements
 * the exact §2.9.3 step order itself; this schema only guards against
 * grossly malformed JSON (wrong types, missing keys) before it reaches the
 * service, using loose per-field types (mostly optional strings) so a
 * missing/empty field is still passed through to the service's own ordered
 * checks rather than rejected here out of order.
 */

const checkoutLineSchema = z
  .object({
    productId: z.string().uuid('Must be a valid id.'),
    variantId: z.string().uuid('Must be a valid id.').nullable().optional(),
    quantity: z.coerce.number().int().positive('Must be a positive integer.'),
  })
  .strict();

const guestFieldsShapeSchema = z
  .object({
    fullName: z.string().optional().default(''),
    phoneNumber: z.string().optional().default(''),
    email: z.string().nullable().optional(),
    division: z.string().optional().default(''),
    district: z.string().optional().default(''),
    areaUnitType: z.string().optional().default(''),
    areaUnitName: z.string().optional().default(''),
    wardUnitType: z.string().optional().default(''),
    wardUnitName: z.string().optional().default(''),
    detailedAddress: z.string().optional().default(''),
    postalCode: z.string().nullable().optional(),
  })
  .strict();

export const createOrderSchema = z
  .object({
    paymentMethod: z.enum(['BKASH', 'COD']),
    lines: z.array(checkoutLineSchema).min(1, 'Your cart is empty.'),
    couponCode: z.string().trim().max(64).nullable().optional(),
    idempotencyKey: z.string().min(1, 'An idempotency key is required.').max(128),
    guestFields: guestFieldsShapeSchema.nullable().optional(),
    bkashTransactionId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict();
export type CreateOrderRequest = z.infer<typeof createOrderSchema>;

export const guestOrderLookupQuerySchema = z
  .object({
    order_number: z.string().trim().min(1, 'Order number is required.').max(64),
    phone_number: z.string().trim().min(1, 'Phone number is required.').max(32),
  })
  .strict();
export type GuestOrderLookupQuery = z.infer<typeof guestOrderLookupQuerySchema>;

export const customerOrderHistoryQuerySchema = paginationQuerySchema;

export const customerOrderIdParamSchema = z.object({ id: z.string().uuid('Must be a valid id.') });
