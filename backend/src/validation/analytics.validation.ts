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
    eventSourceUrl: z
      .string()
      .max(2048)
      .url('Must be a valid URL.')
      .refine((value) => /^https?:\/\//i.test(value), 'Must be an http(s) URL.'),
    payload: z
      .object({
        contentIds: z.array(z.string().min(1).max(100)).max(50).optional(),
        // Ids and integer quantities only — a price/value key fails .strict() → 400.
        contents: z
          .array(
            z
              .object({ id: z.string().min(1).max(100), quantity: z.number().int().min(1).max(999) })
              .strict(),
          )
          .max(50)
          .optional(),
        searchString: z.string().max(200).optional(),
      })
      .strict(),
    // Meta's own browser cookies, forwarded because the API is a separate origin.
    fbp: z.string().max(256).regex(/^fb\.[0-9]\.[0-9]+\.[0-9]+$/, 'Invalid _fbp cookie.').optional(),
    fbc: z.string().max(256).regex(/^fb\.[0-9]\.[0-9]+\.[A-Za-z0-9_-]+$/, 'Invalid _fbc cookie.').optional(),
  })
  .strict();

export type AnalyticsEventRequest = z.infer<typeof analyticsEventRequestSchema>;
