import { Router } from 'express';
import {
  createSectionController,
  deleteSectionController,
  getSectionController,
  listSectionsController,
  replaceSectionCategoriesController,
  replaceSectionProductsController,
  reorderSectionsController,
  updateSectionController,
} from '../../controllers/admin/homepageSections.controller.js';
import { getPreviewController } from '../../controllers/admin/homepagePreview.controller.js';
import { uploadHomepageImageController } from '../../controllers/admin/homepageImages.controller.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import { createUploadLimit } from '../../middleware/uploadLimit.js';
import { HOMEPAGE_IMAGE_MAX_BYTES } from '../../config/constants.js';
import {
  attachCategoriesSchema,
  attachProductsSchema,
  createSectionSchema,
  listSectionsQuerySchema,
  reorderSectionsSchema,
  sectionIdParamsSchema,
  updateSectionSchema,
  uploadImageQuerySchema,
} from '../../validation/homepageCms.validation.js';

/**
 * Admin homepage sections, reorder, images, and preview (13-homepage-cms
 * §13.12, §13.14, plan §3.8). `requireAuth('admin')` and
 * `requirePasswordChanged` are applied once at `admin/index.ts` router level.
 * Every route below adds `requirePermission('cms.manage')` — the single
 * existing permission key that gates the whole feature (§13.14: no new key).
 */
const router = Router();

router.get('/sections', requirePermission('cms.manage'), validate({ query: listSectionsQuerySchema }), listSectionsController);

router.post('/sections', requirePermission('cms.manage'), validate({ body: createSectionSchema }), createSectionController);

router.get(
  '/sections/:id',
  requirePermission('cms.manage'),
  validate({ params: sectionIdParamsSchema }),
  getSectionController,
);

router.patch(
  '/sections/:id',
  requirePermission('cms.manage'),
  validate({ params: sectionIdParamsSchema, body: updateSectionSchema }),
  updateSectionController,
);

router.delete(
  '/sections/:id',
  requirePermission('cms.manage'),
  validate({ params: sectionIdParamsSchema }),
  deleteSectionController,
);

// Atomic: the full ordered id list, applied in one transaction (§13.12).
router.post(
  '/sections/reorder',
  requirePermission('cms.manage'),
  validate({ body: reorderSectionsSchema }),
  reorderSectionsController,
);

router.put(
  '/sections/:id/products',
  requirePermission('cms.manage'),
  validate({ params: sectionIdParamsSchema, body: attachProductsSchema }),
  replaceSectionProductsController,
);

router.put(
  '/sections/:id/categories',
  requirePermission('cms.manage'),
  validate({ params: sectionIdParamsSchema, body: attachCategoriesSchema }),
  replaceSectionCategoriesController,
);

router.post(
  '/images',
  requirePermission('cms.manage'),
  createUploadLimit(HOMEPAGE_IMAGE_MAX_BYTES),
  validate({ query: uploadImageQuerySchema }),
  uploadHomepageImageController,
);

// A genuinely separate route from the public endpoint (§13.12) — never a
// flag/param on it.
router.get('/preview', requirePermission('cms.manage'), getPreviewController);

export default router;
