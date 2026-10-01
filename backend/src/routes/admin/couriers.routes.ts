import { Router } from 'express';
import {
  listCourierConfigController,
  listCouriersController,
  updateCourierConfigController,
} from '../../controllers/admin/shipment.controller.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import { courierCodeParamsSchema, updateCourierConfigSchema } from '../../validation/shipment.validation.js';

/**
 * Courier registry endpoints (spec 14). Auth and the rate limit are applied at
 * the mount points (admin/index.ts).
 *
 * `courier.select` (pick a courier per order) and `courier.manage` (reconfigure
 * a provider) are two distinct permissions (06-rbac §5.16).
 */
/** Mounted at `/api/admin/couriers`. */
export const couriersRouter = Router();
couriersRouter.get('/', requirePermission('courier.select'), listCouriersController);

/** Mounted at `/api/admin/courier-config`. */
export const courierConfigRouter = Router();
courierConfigRouter.get('/', requirePermission('courier.manage'), listCourierConfigController);
courierConfigRouter.patch(
  '/:code',
  validate({ params: courierCodeParamsSchema, body: updateCourierConfigSchema }),
  requirePermission('courier.manage'),
  updateCourierConfigController,
);
