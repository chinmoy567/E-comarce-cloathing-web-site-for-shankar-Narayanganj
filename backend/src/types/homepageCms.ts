/**
 * Shared homepage-CMS types (13-homepage-cms, plan §3). `PublicProductSummary`
 * is the customer-safe projection every product-bearing surface (carousel,
 * later spec 07 pages) must use — no internal catalogue field is ever added
 * to it just because one call site wants it.
 */

export const SECTION_TYPES = [
  'HERO',
  'CATEGORY_GRID',
  'PRODUCT_CAROUSEL',
  'CAMPAIGN_BANNER',
  'PROMO_BANNER',
  'CUSTOM_CONTENT',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const CMS_STATUSES = ['DRAFT', 'ACTIVE', 'DISABLED'] as const;
export type CmsStatus = (typeof CMS_STATUSES)[number];

/** §13.7a/§13.10 — SCHEDULED/EXPIRED are computed-only, never stored. */
export type DisplayStatus = 'DRAFT' | 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'DISABLED';

export type PublicProductSummary = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  price: number;
  compareAtPrice: number | null;
  isFeatured: boolean;
  outOfStock: boolean;
};

export type PublicCategorySummary = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
};

export type HomepageCampaignSummary = {
  name: string;
  slug: string;
  visualTheme: unknown | null;
  heroContent: unknown | null;
};

export type HomepageSectionResponse = {
  id: string;
  sectionType: SectionType;
  title: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  secondaryCtaLabel: string | null;
  secondaryCtaUrl: string | null;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  campaign: HomepageCampaignSummary | null;
  contentConfig: unknown;
  products?: PublicProductSummary[];
  categories?: PublicCategorySummary[];
};

export type HomepageMetadata = {
  title: string | null;
  description: string | null;
  ogImageUrl: string | null;
};

export type HomepageResponse = {
  sections: HomepageSectionResponse[];
  metadata: HomepageMetadata | null;
};

export type PreviewSectionResponse = HomepageSectionResponse & { displayStatus: DisplayStatus };

export type PreviewResponse = {
  sections: PreviewSectionResponse[];
  metadata: HomepageMetadata | null;
};
