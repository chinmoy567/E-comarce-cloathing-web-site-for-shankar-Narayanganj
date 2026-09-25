/**
 * Mirrors of the back-office API response shapes (spec 03 §Request/response
 * types). Hand-maintained, like `apiTypes.ts`, since the frontend never
 * imports backend source directly.
 */

export type AdminRole = 'ADMIN' | 'MANAGER';

/** The 06-rbac §5.18 permission-key union. Kept as `string` here rather than a
 * literal union — the catalogue is the source of truth and is fetched at
 * runtime; a stale frontend copy of the key list would silently drift. */
export type PermissionKey = string;

export type PermissionTier = 'YES' | 'ASSIGNED' | 'NO';

export type PermissionCatalogueEntry = {
  key: PermissionKey;
  label: string;
  adminTier: PermissionTier;
  managerTier: PermissionTier;
  isAdministrative: boolean;
};

export type AdminUserSummary = {
  id: string;
  userIdentifier: string;
  role: AdminRole;
  isSystemAdmin: boolean;
};

export type AdminLoginResponse = {
  user: AdminUserSummary;
  permissions: PermissionKey[];
  mustChangePassword: boolean;
};

/**
 * `mustChangePassword` is not in the spec's literal `MeResponse` type, but the
 * backend includes it (see `backend/src/services/adminAuth.service.ts`
 * `MeResult`) so the shell can gate every page load, not only the login
 * response.
 */
export type MeResponse = AdminUserSummary & { permissions: PermissionKey[]; mustChangePassword: boolean };

export type ManagerListItem = {
  id: string;
  userIdentifier: string;
  isActive: boolean;
  createdAt: string;
};

export type ManagerDetail = {
  id: string;
  userIdentifier: string;
  role: 'MANAGER';
  isActive: boolean;
  permissions: PermissionKey[];
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Catalogue (spec 05 §Types) — mirrors backend/src/services/products.service.ts,
// backend/src/repositories/categories.repository.ts and
// backend/src/validation/catalogue.validation.ts exactly (camelCase, same
// optionality). `status` has exactly two values — OUT_OF_STOCK is never
// stored, only derived as `isOutOfStock` at read time (§5.1 note).
// ---------------------------------------------------------------------------

export type ProductStatus = 'ACTIVE' | 'INACTIVE';

export type AttributeType = 'SIZE' | 'COLOUR' | 'AGE_GROUP' | 'OTHER';

export type CategoryResponse = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
  status: ProductStatus;
  imageUrl: string | null;
};

export type AttributeValueResponse = {
  id: string;
  attributeId: string;
  value: string;
  displayOrder: number;
};

export type AttributeResponse = {
  id: string;
  type: AttributeType;
  name: string;
  displayOrder: number;
  values: AttributeValueResponse[];
};

export type VariantResponse = {
  id: string;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
  attributeValueIds: string[];
};

export type ProductImageResponse = {
  id: string;
  productId: string;
  storagePath: string;
  altText: string | null;
  displayOrder: number;
  isPrimary: boolean;
};

export type ProductResponse = {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  status: ProductStatus;
  isFeatured: boolean;
  weightGrams: number | null;
  variants: VariantResponse[];
  images: ProductImageResponse[];
  /** Derived: sum of active variants' stock. Never stored. */
  totalStock: number;
  /** Derived: totalStock === 0. Never a separate status (§5.1 note). */
  isOutOfStock: boolean;
};

export type CreateVariantRequest = {
  sku?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  stockQuantity: number;
  lowStockThreshold?: number;
  attributeValueIds: string[];
};

export type CreateProductRequest = {
  categoryId: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  basePrice: number;
  compareAtPrice?: number | null;
  weightGrams?: number | null;
  isFeatured?: boolean;
  variants: CreateVariantRequest[];
};

export type UpdateProductRequest = {
  categoryId?: string;
  name?: string;
  sku?: string | null;
  description?: string | null;
  basePrice?: number;
  compareAtPrice?: number | null;
  weightGrams?: number | null;
  isFeatured?: boolean;
  slug?: string;
};

export type UpdateStockRequest = { stockQuantity: number; reason: string };
export type UpdateVisibilityRequest = { status: ProductStatus };
export type UpdatePriceRequest = { basePrice?: number; compareAtPrice?: number | null };

// ---------------------------------------------------------------------------
// Coupons (spec 10 §Types) — mirrors
// backend/src/services/coupon/coupons.service.ts and
// backend/src/validation/coupons.validation.ts exactly (camelCase, same
// optionality).
// ---------------------------------------------------------------------------

export type CouponDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';
export type CouponStoredStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED';
export type CouponDisplayStatus = CouponStoredStatus | 'SCHEDULED' | 'EXPIRED' | 'ARCHIVED';
export type CouponCustomerEligibility = 'ALL_CUSTOMERS' | 'REGISTERED_CUSTOMERS_ONLY' | 'SPECIFIC_CUSTOMER';

export type CouponResponse = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discountType: CouponDiscountType;
  discountValue: number;
  minimumOrderAmount: number | null;
  maximumDiscountAmount: number | null;
  startsAt: string;
  expiresAt: string;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  customerEligibility: CouponCustomerEligibility;
  eligibleCustomerId: string | null;
  status: CouponStoredStatus;
  displayStatus: CouponDisplayStatus;
  isArchived: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CouponDetailResponse = CouponResponse & {
  distinctCustomerCount: number;
};

export type CouponUsageEntry = {
  id: string;
  couponId: string;
  orderId: string;
  customerId: string;
  discountAmount: number;
  usedAt: string;
};

export type CreateCouponRequest = {
  code: string;
  name: string;
  description?: string | null;
  discountType: CouponDiscountType;
  discountValue: number;
  minimumOrderAmount?: number | null;
  maximumDiscountAmount?: number | null;
  startsAt: string;
  expiresAt: string;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  customerEligibility?: CouponCustomerEligibility;
  eligibleCustomerId?: string | null;
  status?: CouponStoredStatus;
};

export type UpdateCouponRequest = Partial<Omit<CreateCouponRequest, 'status'>>;

// ---------------------------------------------------------------------------
// Homepage CMS (13-homepage-cms, plan §6)
// ---------------------------------------------------------------------------

export type SectionType = 'HERO' | 'CATEGORY_GRID' | 'PRODUCT_CAROUSEL' | 'CAMPAIGN_BANNER' | 'PROMO_BANNER' | 'CUSTOM_CONTENT';
export type CmsStoredStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED';
export type CmsDisplayStatus = CmsStoredStatus | 'SCHEDULED' | 'EXPIRED';

export type HomepageSectionAdminResponse = {
  id: string;
  sectionType: SectionType;
  title: string | null;
  subtitle: string | null;
  displayOrder: number;
  status: CmsStoredStatus;
  displayStatus: CmsDisplayStatus;
  ctaLabel: string | null;
  ctaUrl: string | null;
  secondaryCtaLabel: string | null;
  secondaryCtaUrl: string | null;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  campaignId: string | null;
  contentConfig: unknown;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateHomepageSectionRequest = {
  sectionType: SectionType;
  title?: string | null;
  subtitle?: string | null;
  status?: CmsStoredStatus;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  secondaryCtaLabel?: string | null;
  secondaryCtaUrl?: string | null;
  desktopImageUrl?: string | null;
  mobileImageUrl?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  campaignId?: string | null;
  contentConfig: unknown;
};

export type UpdateHomepageSectionRequest = Partial<Omit<CreateHomepageSectionRequest, 'sectionType'>>;

export type CampaignAdminResponse = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: CmsStoredStatus;
  displayStatus: CmsDisplayStatus;
  heroContent: unknown;
  visualTheme: unknown;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignDetailAdminResponse = CampaignAdminResponse & { linkedSectionCount: number };

export type CreateCampaignRequest = {
  name: string;
  slug: string;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  status?: CmsStoredStatus;
  heroContent?: unknown;
  visualTheme?: unknown;
};

export type UpdateCampaignRequest = Partial<CreateCampaignRequest>;

export type AuditLogEntry = {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  previousValue: unknown;
  newValue: unknown;
  actorUserId: string | null;
  actorType: 'USER' | 'SYSTEM';
  createdAt: string;
};
