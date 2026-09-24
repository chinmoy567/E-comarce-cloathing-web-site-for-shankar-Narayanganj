import { z } from 'zod';
import { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../types/orderEnums.js';
import { paginationQuerySchema } from '../lib/pagination.js';

// List orders with filtering & pagination
export const listOrdersSchema = paginationQuerySchema.extend({
  order_status: z.enum(ORDER_STATUSES).optional(),
  payment_status: z.enum(PAYMENT_STATUSES).optional(),
  payment_method: z.enum(PAYMENT_METHODS).optional(),
  created_after: z.coerce.date().optional(),
  created_before: z.coerce.date().optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersSchema>;

// Confirm order (transition to CONFIRMED)
export const confirmOrderSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

// Start processing (transition to PROCESSING)
export const startProcessingSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

// Cancel order (transition to CANCELLED)
export const cancelOrderSchema = z.object({
  reason: z.string().min(10).max(500),
});

// Verify payment (bKash or COD)
export const verifyPaymentSchema = z.object({
  bkashTransactionId: z.string().min(5).max(50).optional(),
});

// Reject payment
export const rejectPaymentSchema = z.object({
  reason: z.string().min(10).max(500),
});

// Resubmit payment (bKash only)
export const resubmitPaymentSchema = z.object({
  newBkashTransactionId: z.string().min(5).max(50),
});

// Check customer risk (fraud check)
export const checkCustomerRiskSchema = z.object({
  forceRefresh: z.boolean().optional().default(false),
});
