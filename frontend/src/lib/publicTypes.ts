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

export type CampaignVisualTheme = { accent?: 'PRIMARY' | 'DARK' | 'ACCENT'; treatment?: 'PLAIN' | 'BORDERED' };

export type CampaignHeroContent = {
  title?: string | null;
  subtitle?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  secondaryCtaLabel?: string | null;
  secondaryCtaUrl?: string | null;
  desktopImageUrl?: string | null;
  mobileImageUrl?: string | null;
};

export type HomepageCampaignSummary = {
  name: string;
  slug: string;
  visualTheme: CampaignVisualTheme | null;
  heroContent: CampaignHeroContent | null;
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

/**
 * Public product browsing types (spec 02), hand-mirrored from
 * `backend/src/services/publicProducts.service.ts`.
 */

export type PublicProductListItem = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  isFeatured: boolean;
  imageUrl: string | null;
  categoryId: string;
  categoryName: string;
  outOfStock: boolean;
};

export type ProductAttributeType = 'SIZE' | 'COLOUR' | 'AGE_GROUP' | 'OTHER';

export type PublicVariant = {
  id: string;
  sku: string | null;
  price: number;
  compareAtPrice: number | null;
  stockQuantity: number;
  inStock: boolean;
  attributes: Array<{ attributeId: string; type: ProductAttributeType; name: string; valueId: string; value: string }>;
};

export type PublicProductImage = {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
};

export type PublicProductDetail = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  isFeatured: boolean;
  weightGrams: number | null;
  category: { id: string; name: string; slug: string };
  images: PublicProductImage[];
  variants: PublicVariant[];
  minPrice: number;
  maxPrice: number;
  outOfStock: boolean;
};

export type PaginationBlock = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PublicCategory = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  imageUrl: string | null;
};

/**
 * Response of `POST /api/checkout/validate` (spec 21). Every figure is backend-computed; the browser
 * displays them and never derives a shipping amount, discount or total itself.
 */
export type CheckoutPricing = {
  currency: 'BDT';
  subtotal: number;
  discountAmount: number;
  shippingAmount: number;
  totalAmount: number;
  appliedCoupon: { code: string; discountAmount: number } | null;
  /** The coupon rejection message when the code no longer applies. */
  couponMessage: string | null;
  shipping: { zoneName: string; freeShippingApplied: boolean; freeShippingRemaining: number | null };
};
