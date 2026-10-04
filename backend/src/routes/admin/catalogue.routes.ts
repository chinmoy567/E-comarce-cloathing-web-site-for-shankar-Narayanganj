import { Router } from 'express';
import {
  createCategoryController,
  deleteCategoryController,
  listCategoriesController,
  updateCategoryController,
} from '../../controllers/categories.controller.js';
import {
  createAttributeController,
  createAttributeValueController,
  deleteAttributeValueController,
  listAttributesController,
} from '../../controllers/productAttributes.controller.js';
import {
  createProductController,
  deleteProductController,
  getProductController,
  listProductsController,
  updatePriceController,
  updateProductController,
  updateVisibilityController,
} from '../../controllers/products.controller.js';
import {
  createVariantController,
  deleteVariantController,
  updateStockController,
  updateVariantController,
} from '../../controllers/productVariants.controller.js';
import {
  deleteImageController,
  reorderProductImagesController,
  setPrimaryImageController,
  updateImageController,
  uploadProductImageController,
} from '../../controllers/productImages.controller.js';
import { createUploadLimit } from '../../middleware/uploadLimit.js';
import { PRODUCT_IMAGE_MAX_BYTES } from '../../config/constants.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import {
  attributeIdParamsSchema,
  attributeValueParamsSchema,
  categoryIdParamsSchema,
  createAttributeSchema,
  createAttributeValueSchema,
  createCategorySchema,
  createProductSchema,
  createProductVariantSchema,
  imageIdParamsSchema,
  listCategoriesQuerySchema,
  listProductsQuerySchema,
  productIdParamsSchema,
  reorderImagesSchema,
  updateImageSchema,
  uploadImageQuerySchema,
  updateCategorySchema,
  updatePriceSchema,
  updateProductSchema,
  updateStockSchema,
  updateVariantSchema,
  updateVisibilitySchema,
  variantIdParamsSchema,
} from '../../validation/catalogue.validation.js';

/**
 * Catalogue management (spec 05 §Routes). `requireAuth('admin')`,
 * `rateLimit('authenticatedCeiling')`, and `requirePasswordChanged` are
 * applied once at the `admin/index.ts` router level; each route below adds
 * only its own `requirePermission` gate, matching the `managers.routes.ts`
 * precedent.
 *
 * Price, visibility, and stock are separate endpoints from the general
 * `PATCH /products/:id` specifically so each carries its own distinct
 * permission (§5.18: Price Management, Product Visibility, Inventory
 * Management are separate matrix rows) — never folded into one handler with
 * internal branching.
 */
const router = Router();

// ---------------------------------------------------------------------------
// Categories — category.manage
// ---------------------------------------------------------------------------

router.get(
  '/categories',
  requirePermission('category.manage'),
  validate({ query: listCategoriesQuerySchema }),
  listCategoriesController,
);

router.post(
  '/categories',
  requirePermission('category.manage'),
  validate({ body: createCategorySchema }),
  createCategoryController,
);

router.patch(
  '/categories/:id',
  requirePermission('category.manage'),
  validate({ params: categoryIdParamsSchema, body: updateCategorySchema }),
  updateCategoryController,
);

router.delete(
  '/categories/:id',
  requirePermission('category.manage'),
  validate({ params: categoryIdParamsSchema }),
  deleteCategoryController,
);

// ---------------------------------------------------------------------------
// Attributes — product.attribute.manage
// ---------------------------------------------------------------------------

router.get('/attributes', requirePermission('product.attribute.manage'), listAttributesController);

router.post(
  '/attributes',
  requirePermission('product.attribute.manage'),
  validate({ body: createAttributeSchema }),
  createAttributeController,
);

router.post(
  '/attributes/:id/values',
  requirePermission('product.attribute.manage'),
  validate({ params: attributeIdParamsSchema, body: createAttributeValueSchema }),
  createAttributeValueController,
);

router.delete(
  '/attributes/:id/values/:valueId',
  requirePermission('product.attribute.manage'),
  validate({ params: attributeValueParamsSchema }),
  deleteAttributeValueController,
);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

// No dedicated "Product View" row in §5.18 — listing/reading are gated on
// product.update (Yes for both roles), per spec 05's footnote 1.
router.get(
  '/products',
  requirePermission('product.update'),
  validate({ query: listProductsQuerySchema }),
  listProductsController,
);

router.get(
  '/products/:id',
  requirePermission('product.update'),
  validate({ params: productIdParamsSchema }),
  getProductController,
);

router.post(
  '/products',
  requirePermission('product.create'),
  validate({ body: createProductSchema }),
  createProductController,
);

router.patch(
  '/products/:id',
  requirePermission('product.update'),
  validate({ params: productIdParamsSchema, body: updateProductSchema }),
  updateProductController,
);

router.delete(
  '/products/:id',
  requirePermission('product.delete'),
  validate({ params: productIdParamsSchema }),
  deleteProductController,
);

router.patch(
  '/products/:id/price',
  requirePermission('product.price.manage'),
  validate({ params: productIdParamsSchema, body: updatePriceSchema }),
  updatePriceController,
);

router.patch(
  '/products/:id/visibility',
  requirePermission('product.visibility.manage'),
  validate({ params: productIdParamsSchema, body: updateVisibilitySchema }),
  updateVisibilityController,
);

// ---------------------------------------------------------------------------
// Variants — product.variant.manage (stock adjust is inventory.manage)
// ---------------------------------------------------------------------------

router.post(
  '/products/:id/variants',
  requirePermission('product.variant.manage'),
  validate({ params: productIdParamsSchema, body: createProductVariantSchema }),
  createVariantController,
);

router.patch(
  '/variants/:id',
  requirePermission('product.variant.manage'),
  validate({ params: variantIdParamsSchema, body: updateVariantSchema }),
  updateVariantController,
);

router.delete(
  '/variants/:id',
  requirePermission('product.variant.manage'),
  validate({ params: variantIdParamsSchema }),
  deleteVariantController,
);

router.patch(
  '/variants/:id/stock',
  requirePermission('inventory.manage'),
  validate({ params: variantIdParamsSchema, body: updateStockSchema }),
  updateStockController,
);

// ---------------------------------------------------------------------------
// Product images — product.image.manage (the product's images come back on GET /products/:id)
// ---------------------------------------------------------------------------

// The 5 MB raw-body parser is mounted on this route only; the global 100 kb limit stays everywhere else.
router.post(
  '/products/:id/images',
  requirePermission('product.image.manage'),
  validate({ params: productIdParamsSchema, query: uploadImageQuerySchema }),
  createUploadLimit(PRODUCT_IMAGE_MAX_BYTES),
  uploadProductImageController,
);

router.patch(
  '/products/:id/images/order',
  requirePermission('product.image.manage'),
  validate({ params: productIdParamsSchema, body: reorderImagesSchema }),
  reorderProductImagesController,
);

router.patch(
  '/images/:id',
  requirePermission('product.image.manage'),
  validate({ params: imageIdParamsSchema, body: updateImageSchema }),
  updateImageController,
);

router.post(
  '/images/:id/primary',
  requirePermission('product.image.manage'),
  validate({ params: imageIdParamsSchema }),
  setPrimaryImageController,
);

router.delete(
  '/images/:id',
  requirePermission('product.image.manage'),
  validate({ params: imageIdParamsSchema }),
  deleteImageController,
);

export default router;
