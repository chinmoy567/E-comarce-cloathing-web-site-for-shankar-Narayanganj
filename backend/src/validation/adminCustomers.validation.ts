import { z } from 'zod';
import { paginationQuerySchema } from '../lib/pagination.js';

export const customerIdParamsSchema = z.object({ id: z.string().uuid('Must be a valid id.') }).strict();

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  accountType: z.enum(['GUEST', 'REGISTERED']).optional(),
});

/**
 * Contact/address corrections only (§5.7). `.strict()` - `accountType`, phone
 * (the login identity), credentials and any status field are rejected as 400,
 * so no admin path can shortcut §2.9.8's customer-initiated promotion.
 */
export const updateCustomerSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    detailedAddress: z.string().trim().min(1).max(500).optional(),
    postalCode: z.string().trim().max(20).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required.' });
