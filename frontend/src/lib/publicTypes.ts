/**
 * Public homepage response types (13-homepage-cms §13.15, plan §6), hand-
 * mirrored from `backend/src/types/homepageCms.ts` — the existing convention
 * for cross-boundary types in this project (no shared package for these).
 */

export type SectionType = 'HERO' | 'CATEGORY_GRID' | 'PRODUCT_CAROUSEL' | 'CAMPAIGN_BANNER' | 'PROMO_BANNER' | 'CUSTOM_CONTENT';

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
  visualTheme: { accentColor?: 'primary' | 'secondary' | 'accent'; bannerTreatment?: 'STANDARD' | 'FULL_BLEED' | 'SPLIT' } | null;
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

export type DisplayStatus = 'DRAFT' | 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'DISABLED';

export type PreviewSectionResponse = HomepageSectionResponse & { displayStatus: DisplayStatus };

export type PreviewResponse = {
  sections: PreviewSectionResponse[];
  metadata: HomepageMetadata | null;
};
