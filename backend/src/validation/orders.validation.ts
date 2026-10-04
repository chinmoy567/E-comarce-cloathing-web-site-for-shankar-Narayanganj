import { z } from 'zod';
import { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../types/orderEnums.js';
import { paginationQuerySchema } from '../lib/pagination.js';

/** Comma-separated query value -> validated enum array (a single value still works). */
function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .max(200)
    .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).max(10));
}

const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

const SHIPMENT_STATUS_FILTER = [
  'NOT_CREATED', 'CREATING', 'CREATED', 'SHIPPED', 'IN_TRANSIT',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'CREATION_FAILED', 'DELIVERY_FAILED', 'RETURNED',
] as const;

// List orders with filtering & pagination (05-admin §5.2, 03-payment-order §3.4)
export const listOrdersSchema = paginationQuerySchema.extend({
  order_status: csvEnum(ORDER_STATUSES).optional(),
  payment_status: csvEnum(PAYMENT_STATUSES).optional(),
  shipment_status: csvEnum(SHIPMENT_STATUS_FILTER).optional(),
  payment_method: z.enum(PAYMENT_METHODS).optional(),
  is_guest_order: queryBoolean.optional(),
  has_coupon: queryBoolean.optional(),
  has_cod_discrepancy: queryBoolean.optional(),
  // "Stale unconfirmed" saved view - a filter only, nothing is auto-cancelled (§3.4).
  stale: queryBoolean.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['created_at', 'total_amount', 'last_payment_rejected_at']).default('created_at'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  created_after: z.coerce.date().optional(),
  created_before: z.coerce.date().optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersSchema>;

// Confirm order (transition to CONFIRMED)
export const confirmOrderSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
}).strict();

// Start processing (transition to PROCESSING)
export const startProcessingSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
}).strict();

// Cancel order (transition to CANCELLED)
export const cancelOrderSchema = z.object({
  reason: z.string().min(10).max(500),
}).strict();

// Verify payment (bKash or COD)
export const verifyPaymentSchema = z.object({
  bkashTransactionId: z.string().min(5).max(50).optional(),
}).strict();

// Reject payment - 03-payment-order §3.4's listed reasons, with free text always required (§5.21.2).
export const PAYMENT_REJECTION_REASONS = [
  'INVALID_TRANSACTION_ID', 'TRANSACTION_MISMATCH', 'INCORRECT_AMOUNT',
  'UNVERIFIABLE', 'UNCLEAR_SCREENSHOT', 'PAYMENT_NOT_COMPLETED', 'OTHER',
] as const;
export const rejectPaymentSchema = z.object({
  reason: z.string().trim().min(10).max(500),
  reasonCode: z.enum(PAYMENT_REJECTION_REASONS).optional(),
}).strict();

// COD collection resolution (§5.21.3): COLLECTED, or NOT_RECOVERABLE with a mandatory reason.
export const codCollectionSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('COLLECTED'), reason: z.string().trim().max(500).optional() }).strict(),
  z.object({ outcome: z.literal('NOT_RECOVERABLE'), reason: z.string().trim().min(10).max(500) }).strict(),
]);

// COD confirmation (§5.4) - same transition as confirm, separate permission row.
export const codConfirmSchema = z.object({}).strict();

// PATCH /orders/:id - deliberately narrow whitelist (§5.2, §8.23). Status, amount, coupon and
// line-item fields are not in this schema, so `.strict()` rejects them with a 400.
export const updateOrderSchema = z.object({
  internalNote: z.string().trim().max(1000).nullable().optional(),
  // Sent to the courier at shipment creation; 250 is the shortest courier limit (Pathao `special_instruction`).
  deliveryInstructions: z.string().trim().max(250).nullable().optional(),
  contactName: z.string().trim().min(1).max(120).optional(),
  contactPhone: z.string().trim().min(6).max(20).optional(),
  detailedAddress: z.string().trim().min(1).max(500).optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required.' });

// Resubmit payment (bKash only)
export const resubmitPaymentSchema = z.object({
  newBkashTransactionId: z.string().min(5).max(50),
}).strict();

// Customer resubmission after a rejected bKash payment (03-payment-order §3.4). Ownership: order number (path) + phone.
export const customerResubmitPaymentSchema = z.object({
  phoneNumber: z.string().trim().min(6).max(20),
  bkashTransactionId: z.string().trim().min(5).max(50),
}).strict();

// Customer risk check (spec 16): no request body. Looked up by the store Order Number (e.g. FBK-20260920-AB12CD).
export const orderNumberParamsSchema = z.object({
  orderNumber: z.string().trim().regex(/^[A-Za-z0-9-]{6,40}$/, 'Invalid order number.'),
}).strict();

// :id path parameter — must be a UUID so a malformed id is a 400, not a DB cast error.
export const orderIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
