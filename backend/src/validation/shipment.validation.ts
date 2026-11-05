import { z } from 'zod';
import { paginationQuerySchema } from '../lib/pagination.js';

/** Courier codes are registry rows, not an enum (§4.9); the service checks the code exists. */
const courierCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/, 'Invalid courier code.');

// POST /orders/:id/shipment and /shipment/change-courier
export const createShipmentSchema = z.object({ courierCode }).strict();
export type CreateShipmentBody = z.infer<typeof createShipmentSchema>;

/**
 * Set only after a person has checked the courier's merchant panel and found no parcel for
 * this order. Required by the service when the last attempt's outcome is unknown (§4.11).
 */
const confirmNoExistingParcel = z.boolean().optional();

// POST /orders/:id/shipment/retry
export const retryShipmentSchema = z.object({ confirmNoExistingParcel }).strict();
export type RetryShipmentBody = z.infer<typeof retryShipmentSchema>;

// POST /orders/:id/shipment/change-courier
export const changeCourierSchema = z.object({ courierCode, confirmNoExistingParcel }).strict();
export type ChangeCourierBody = z.infer<typeof changeCourierSchema>;

// POST /orders/:id/shipment/link — the consignment id as the courier shows it; the service re-checks the format.
export const linkParcelSchema = z.object({ courierOrderId: z.string().trim().min(4).max(64) }).strict();
export type LinkParcelBody = z.infer<typeof linkParcelSchema>;

export const courierCodeParamsSchema = z.object({ code: courierCode }).strict();

export const shipmentRequestsQuerySchema = paginationQuerySchema;

/** https:// and exactly one {trackingId} placeholder (spec 14 §Contract additions). */
const trackingUrlTemplate = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('https://'), 'Must start with https://.')
  .refine((v) => v.split('{trackingId}').length === 2, 'Must contain exactly one {trackingId} placeholder.');

// PATCH /courier-config/:code — keys of `config` are checked against the adapter's schema in the service.
export const updateCourierConfigSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    displayOrder: z.number().int().min(0).max(10_000).optional(),
    trackingUrlTemplate: trackingUrlTemplate.nullable().optional(),
    config: z.record(z.string().max(64), z.union([z.string().max(200), z.number()])).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required.');
export type UpdateCourierConfigBody = z.infer<typeof updateCourierConfigSchema>;
