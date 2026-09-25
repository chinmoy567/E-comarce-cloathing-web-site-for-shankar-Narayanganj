import { z } from 'zod';
import { paginationQuerySchema } from '../lib/pagination.js';
import { isValidCtaUrl } from '../lib/urlValidation.js';
import { visualThemeSchema } from '../services/homepageCms/contentConfig.schemas.js';

/**
 * Homepage CMS request schemas (13-homepage-cms §13, plan §4). `.strict()`
 * throughout (§11.6) — an unrecognized field, including a `sectionType` on
 * the update schema, is a 400, never silently ignored or applied.
 */

const sectionTypeSchema = z.enum(['HERO', 'CATEGORY_GRID', 'PRODUCT_CAROUSEL', 'CAMPAIGN_BANNER', 'PROMO_BANNER', 'CUSTOM_CONTENT']);
const cmsStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'DISABLED']);

const ctaUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => isValidCtaUrl(v), { message: 'Must be a relative storefront path or an allowed https:// URL.' });

const commonSectionFields = {
  title: z.string().trim().max(200).nullable().optional(),
  subtitle: z.string().trim().max(400).nullable().optional(),
  status: cmsStatusSchema.optional(),
  ctaLabel: z.string().trim().max(60).nullable().optional(),
  ctaUrl: ctaUrlSchema.nullable().optional(),
  secondaryCtaLabel: z.string().trim().max(60).nullable().optional(),
  secondaryCtaUrl: ctaUrlSchema.nullable().optional(),
  desktopImageUrl: z.string().url().max(2048).nullable().optional(),
  mobileImageUrl: z.string().url().max(2048).nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
};

export const createSectionSchema = z
  .object({
    sectionType: sectionTypeSchema,
    ...commonSectionFields,
    // Shape is per-`sectionType` — re-validated in the service against
    // `contentConfigSchemaFor(sectionType)`; `z.unknown()` here only ensures
    // the field is present and passed through as-is.
    contentConfig: z.unknown(),
  })
  .strict();
export type CreateSectionRequest = z.infer<typeof createSectionSchema>;

/** No `sectionType` field at all — its absence IS the API-level immutability enforcement (§13.4). */
export const updateSectionSchema = z
  .object({
    ...commonSectionFields,
    contentConfig: z.unknown().optional(),
  })
  .strict();
export type UpdateSectionRequest = z.infer<typeof updateSectionSchema>;

export const sectionIdParamsSchema = z.object({ id: z.string().uuid('Must be a valid id.') }).strict();

export const listSectionsQuerySchema = paginationQuerySchema;

export const reorderSectionsSchema = z
  .object({
    sectionIds: z.array(z.string().uuid()).min(1),
  })
  .strict();
export type ReorderSectionsRequest = z.infer<typeof reorderSectionsSchema>;

export const attachProductsSchema = z
  .object({
    productIds: z.array(z.string().uuid()),
  })
  .strict();
export type AttachProductsRequest = z.infer<typeof attachProductsSchema>;

export const attachCategoriesSchema = z
  .object({
    categoryIds: z.array(z.string().uuid()),
  })
  .strict();
export type AttachCategoriesRequest = z.infer<typeof attachCategoriesSchema>;

export const uploadImageQuerySchema = z
  .object({
    kind: z.enum(['section-desktop', 'section-mobile', 'campaign-hero']),
  })
  .strict();
export type UploadImageQuery = z.infer<typeof uploadImageQuerySchema>;

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const slugSchema = z
  .string()
  .trim()
  .min(1, 'Required.')
  .max(120, 'Must be at most 120 characters.')
  .regex(/^[a-z0-9-]+$/, 'May only contain lowercase letters, numbers, and hyphens.');

export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'Required.').max(120, 'Must be at most 120 characters.'),
    slug: slugSchema,
    description: z.string().trim().max(2000).nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    status: cmsStatusSchema.optional(),
    // Shape re-validated against `heroContentSchema` in the service.
    heroContent: z.unknown().optional(),
    visualTheme: visualThemeSchema.optional(),
  })
  .strict();
export type CreateCampaignRequest = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: slugSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    status: cmsStatusSchema.optional(),
    heroContent: z.unknown().optional(),
    visualTheme: visualThemeSchema.optional(),
  })
  .strict();
export type UpdateCampaignRequest = z.infer<typeof updateCampaignSchema>;

export const campaignIdParamsSchema = z.object({ id: z.string().uuid('Must be a valid id.') }).strict();

export const listCampaignsQuerySchema = paginationQuerySchema;
