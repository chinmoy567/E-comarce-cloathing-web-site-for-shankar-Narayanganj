import { Router } from 'express';
import {
  createCampaignController,
  deleteCampaignController,
  getCampaignController,
  listCampaignsController,
  replaceCampaignCategoriesController,
  replaceCampaignProductsController,
  updateCampaignController,
} from '../../controllers/admin/campaigns.controller.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import {
  attachCategoriesSchema,
  attachProductsSchema,
  campaignIdParamsSchema,
  createCampaignSchema,
  listCampaignsQuerySchema,
  updateCampaignSchema,
} from '../../validation/homepageCms.validation.js';

/**
 * Admin campaigns (13-homepage-cms §13.7, §13.14, plan §3.8). Gated by the
 * same `cms.manage` permission as homepage sections — no new key.
 */
const router = Router();

router.get('/', requirePermission('cms.manage'), validate({ query: listCampaignsQuerySchema }), listCampaignsController);

router.post('/', requirePermission('cms.manage'), validate({ body: createCampaignSchema }), createCampaignController);

router.get('/:id', requirePermission('cms.manage'), validate({ params: campaignIdParamsSchema }), getCampaignController);

router.patch(
  '/:id',
  requirePermission('cms.manage'),
  validate({ params: campaignIdParamsSchema, body: updateCampaignSchema }),
  updateCampaignController,
);

router.delete('/:id', requirePermission('cms.manage'), validate({ params: campaignIdParamsSchema }), deleteCampaignController);

router.put(
  '/:id/products',
  requirePermission('cms.manage'),
  validate({ params: campaignIdParamsSchema, body: attachProductsSchema }),
  replaceCampaignProductsController,
);

router.put(
  '/:id/categories',
  requirePermission('cms.manage'),
  validate({ params: campaignIdParamsSchema, body: attachCategoriesSchema }),
  replaceCampaignCategoriesController,
);

export default router;
