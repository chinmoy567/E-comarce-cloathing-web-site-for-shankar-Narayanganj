import { z } from 'zod';
import type { SectionType } from '../../types/homepageCms.js';

/**
 * Per-`section_type` `content_config` shapes (13-homepage-cms §13.3, §13.13,
 * plan §3). `.strict()` throughout — an unrecognized key is a 400, never
 * silently stored. Selected by `contentConfigSchemaFor(sectionType)`; the
 * service layer re-parses against the schema matching the section's own type,
 * since a single request body cannot itself carry which schema applies.
 */

export const heroContentConfigSchema = z
  .object({
    overlayPosition: z.enum(['left', 'center', 'right']).optional(),
  })
  .strict();

export const categoryGridContentConfigSchema = z
  .object({
    mode: z.enum(['ALL_ACTIVE_TOP_LEVEL', 'MANUAL']),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  })
  .strict();

const productCarouselAutomaticConfigSchema = z
  .object({
    mode: z.literal('AUTOMATIC'),
    rule: z.enum(['LATEST', 'FEATURED', 'CATEGORY', 'ON_SALE']),
    limit: z.number().int().min(1).max(24),
    categoryId: z.string().uuid().optional(),
    sort: z.literal('newest').optional(),
  })
  .strict();

const productCarouselManualConfigSchema = z
  .object({
    mode: z.literal('MANUAL'),
    sort: z.literal('manually_selected').optional(),
  })
  .strict();

// `.refine()` is applied after the union rather than on the AUTOMATIC branch
// alone, since `z.discriminatedUnion` requires each branch to be a plain
// ZodObject (a `.refine()`-wrapped branch is a ZodEffects, not assignable).
export const productCarouselContentConfigSchema = z
  .discriminatedUnion('mode', [productCarouselAutomaticConfigSchema, productCarouselManualConfigSchema])
  .refine((v) => v.mode !== 'AUTOMATIC' || v.rule !== 'CATEGORY' || v.categoryId !== undefined, {
    message: 'categoryId is required when rule is CATEGORY.',
    path: ['categoryId'],
  });

/** Content comes entirely from the linked `campaign_id` (§13.3). */
export const campaignBannerContentConfigSchema = z.object({}).strict();

export const promoBannerContentConfigSchema = z
  .object({
    linkType: z.enum(['CATEGORY', 'COUPON', 'URL']).optional(),
    categoryId: z.string().uuid().optional(),
    couponCode: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

/** `body` is sanitized in the service layer via `sanitizeHtml()` before persistence — this schema validates shape only. */
export const customContentContentConfigSchema = z
  .object({
    body: z.string().min(1).max(10_000),
  })
  .strict();

export function contentConfigSchemaFor(sectionType: SectionType) {
  switch (sectionType) {
    case 'HERO':
      return heroContentConfigSchema;
    case 'CATEGORY_GRID':
      return categoryGridContentConfigSchema;
    case 'PRODUCT_CAROUSEL':
      return productCarouselContentConfigSchema;
    case 'CAMPAIGN_BANNER':
      return campaignBannerContentConfigSchema;
    case 'PROMO_BANNER':
      return promoBannerContentConfigSchema;
    case 'CUSTOM_CONTENT':
      return customContentContentConfigSchema;
  }
}

/**
 * §13.13: "lightweight presentation data only... never arbitrary CSS/script
 * injection." Restricted to the design system's own named tokens (design
 * skill's `colors.primary/secondary/accent`) rather than a free hex/string
 * field, so a campaign cannot introduce an off-palette color.
 */
export const visualThemeSchema = z
  .object({
    accentColor: z.enum(['primary', 'secondary', 'accent']).optional(),
    bannerTreatment: z.enum(['STANDARD', 'FULL_BLEED', 'SPLIT']).optional(),
  })
  .strict();

/** §13.7: the same optional fields a HERO section's common fields use, so a campaign cannot introduce content a section could not hold. */
export const heroContentSchema = z
  .object({
    title: z.string().trim().max(200).nullable().optional(),
    subtitle: z.string().trim().max(400).nullable().optional(),
    ctaLabel: z.string().trim().max(60).nullable().optional(),
    ctaUrl: z.string().trim().max(2048).nullable().optional(),
    secondaryCtaLabel: z.string().trim().max(60).nullable().optional(),
    secondaryCtaUrl: z.string().trim().max(2048).nullable().optional(),
    desktopImageUrl: z.string().url().max(2048).nullable().optional(),
    mobileImageUrl: z.string().url().max(2048).nullable().optional(),
  })
  .strict();
