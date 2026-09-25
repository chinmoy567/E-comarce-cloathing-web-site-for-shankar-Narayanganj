import { NotFoundError } from '../lib/errors.js';
import * as publicProductsRepository from '../repositories/publicProducts.repository.js';
import type { PaginationQuery } from '../lib/pagination.js';
import type { AttributeType } from '../types/catalogue.js';

/**
 * Public storefront product browsing/detail (spec 02 §"Browse products by
 * category", "Search and filter products", "View detailed product
 * information", "Select product variants"). Active products only — inactive
 * products are never reachable through this service.
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

export type ListPublicProductsFilter = {
  categoryId?: string;
  search?: string;
};

export async function listProducts(
  filter: ListPublicProductsFilter,
  pagination: PaginationQuery,
): Promise<{ items: PublicProductListItem[]; total: number }> {
  return publicProductsRepository.list(filter, pagination);
}

export type PublicVariantResponse = {
  id: string;
  sku: string | null;
  price: number;
  compareAtPrice: number | null;
  stockQuantity: number;
  inStock: boolean;
  attributes: Array<{ attributeId: string; type: AttributeType; name: string; valueId: string; value: string }>;
};

export type PublicProductImageResponse = {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
};

export type PublicProductDetailResponse = {
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
  images: PublicProductImageResponse[];
  variants: PublicVariantResponse[];
  minPrice: number;
  maxPrice: number;
  outOfStock: boolean;
};

export async function getProductBySlug(slug: string): Promise<PublicProductDetailResponse> {
  const product = await publicProductsRepository.findActiveBySlug(slug);
  if (!product) {
    throw new NotFoundError('Product not found.');
  }

  const [variants, images] = await Promise.all([
    publicProductsRepository.listActiveVariants(product.id),
    publicProductsRepository.listImages(product.id),
  ]);

  const variantResponses: PublicVariantResponse[] = variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    price: v.price ?? product.basePrice,
    compareAtPrice: v.compareAtPrice ?? product.compareAtPrice,
    stockQuantity: v.stockQuantity,
    inStock: v.stockQuantity > 0,
    attributes: v.attributeValues.map((av) => ({
      attributeId: av.attributeId,
      type: av.attributeType,
      name: av.attributeName,
      valueId: av.valueId,
      value: av.value,
    })),
  }));

  const prices = variantResponses.length > 0 ? variantResponses.map((v) => v.price) : [product.basePrice];
  const outOfStock = variantResponses.length === 0 || variantResponses.every((v) => !v.inStock);

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description,
    basePrice: product.basePrice,
    compareAtPrice: product.compareAtPrice,
    isFeatured: product.isFeatured,
    weightGrams: product.weightGrams,
    category: { id: product.categoryId, name: product.categoryName, slug: product.categorySlug },
    images: images.map((img) => ({
      id: img.id,
      url: img.storagePath,
      altText: img.altText,
      isPrimary: img.isPrimary,
    })),
    variants: variantResponses,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    outOfStock,
  };
}
