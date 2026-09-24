import { z } from 'zod';
import { META_EVENTS } from '@shared/analytics';

/**
 * Analytics request schemas (spec 08 §Event ingestion).
 * `.strict()` — unknown fields are rejected, never ignored (11-security-hardening §11.6).
 */

/**
 * POST /api/analytics/event request body.
 * eventName excludes Purchase since it is server-initiated only (§6.3).
 * No value field is accepted from the client — all monetary values are computed
 * server-side (§8.31/§8.16 — never trust client economics).
 */
export const analyticsEventRequestSchema = z
  .object({
    eventName: z
      .enum([
        META_EVENTS.PAGE_VIEW,
        META_EVENTS.VIEW_CONTENT,
        META_EVENTS.SEARCH,
        META_EVENTS.ADD_TO_CART,
        META_EVENTS.INITIATE_CHECKOUT,
        META_EVENTS.ADD_PAYMENT_INFO,
      ]),
    eventId: z.string().uuid('Must be a valid UUID.'),
    eventSourceUrl: z.string().url('Must be a valid URL.'),
    payload: z
      .object({
        contentIds: z.array(z.string()).optional(),
        searchString: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export type AnalyticsEventRequest = z.infer<typeof analyticsEventRequestSchema>;
