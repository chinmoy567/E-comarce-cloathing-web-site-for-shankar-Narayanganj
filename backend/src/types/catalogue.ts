/**
 * TypeScript mirrors of the catalogue database enums created in
 * `0006_catalogue.sql` (spec 05).
 *
 * Each list must stay identical to its Postgres enum; a value added in SQL
 * without a matching entry here is a bug the type system cannot catch.
 */

/**
 * 05-admin-operations §5.1 note: Active/Inactive are the two values of ONE
 * visibility status. OUT_OF_STOCK is deliberately absent — it is derived from
 * stock data at read time, never stored.
 */
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export function isProductStatus(value: unknown): value is ProductStatus {
  return typeof value === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(value);
}

/** 05-admin-operations §5.1 — size / colour / age group / other. */
export const ATTRIBUTE_TYPES = ['SIZE', 'COLOUR', 'AGE_GROUP', 'OTHER'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export function isAttributeType(value: unknown): value is AttributeType {
  return typeof value === 'string' && (ATTRIBUTE_TYPES as readonly string[]).includes(value);
}
