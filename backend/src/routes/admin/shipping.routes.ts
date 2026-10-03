import { Router } from 'express';
import {
  createRateController,
  createZoneController,
  listRatesController,
  listUnmatchedDistrictsController,
  listZonesController,
  makeDefaultZoneController,
  updateZoneController,
} from '../../controllers/admin/shipping.controller.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import {
  createRateSchema,
  createZoneSchema,
  listRatesQuerySchema,
  listUnmatchedQuerySchema,
  updateZoneSchema,
  zoneIdParamsSchema,
} from '../../validation/shipping.validation.js';

/**
 * Admin shipping zone/rate management (spec 21). `requireAuth('admin')` and `requirePasswordChanged`
 * are applied once at `admin/index.ts`; every route here is gated by `system.configure` (an
 * administrative permission a default Manager does not hold - 06-rbac 5.16/5.18). There is no
 * DELETE route: zones, districts and rates are never hard-deleted.
 */
const router = Router();

router.get('/zones', requirePermission('system.configure'), listZonesController);

router.post('/zones', requirePermission('system.configure'), validate({ body: createZoneSchema }), createZoneController);

router.patch(
  '/zones/:id',
  requirePermission('system.configure'),
  validate({ params: zoneIdParamsSchema, body: updateZoneSchema }),
  updateZoneController,
);

router.post(
  '/zones/:id/make-default',
  requirePermission('system.configure'),
  validate({ params: zoneIdParamsSchema }),
  makeDefaultZoneController,
);

router.get(
  '/zones/:id/rates',
  requirePermission('system.configure'),
  validate({ params: zoneIdParamsSchema, query: listRatesQuerySchema }),
  listRatesController,
);

router.post(
  '/zones/:id/rates',
  requirePermission('system.configure'),
  validate({ params: zoneIdParamsSchema, body: createRateSchema }),
  createRateController,
);

router.get(
  '/unmatched-districts',
  requirePermission('system.configure'),
  validate({ query: listUnmatchedQuerySchema }),
  listUnmatchedDistrictsController,
);

export default router;
