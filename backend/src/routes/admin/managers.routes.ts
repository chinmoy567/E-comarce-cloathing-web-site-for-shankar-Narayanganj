import { Router } from 'express';
import {
  createManagerController,
  deactivateManagerController,
  deleteManagerController,
  getManagerController,
  listManagersController,
  reactivateManagerController,
  setManagerPermissionsController,
  updateManagerController,
} from '../../controllers/managers.controller.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import {
  createManagerSchema,
  listManagersQuerySchema,
  managerIdParamsSchema,
  setManagerPermissionsSchema,
  updateManagerSchema,
} from '../../validation/admin.validation.js';

/**
 * Manager account and permission management (spec 03 §Routes table).
 * `requireAuth('admin')` and `requirePasswordChanged` are applied once at the
 * `admin/index.ts` router level; each route below adds only its own
 * `requirePermission` gate.
 *
 * Listing is gated on `user.manager.create` rather than a dedicated "view"
 * permission — §5.18 has no separate Manager-view row (spec 03 open question 3).
 */
const router = Router();

router.get(
  '/',
  requirePermission('user.manager.create'),
  validate({ query: listManagersQuerySchema }),
  listManagersController,
);

router.post(
  '/',
  requirePermission('user.manager.create'),
  validate({ body: createManagerSchema }),
  createManagerController,
);

router.get(
  '/:id',
  requirePermission('user.manager.update'),
  validate({ params: managerIdParamsSchema }),
  getManagerController,
);

router.patch(
  '/:id',
  requirePermission('user.manager.update'),
  validate({ params: managerIdParamsSchema, body: updateManagerSchema }),
  updateManagerController,
);

router.post(
  '/:id/deactivate',
  requirePermission('user.manager.update'),
  validate({ params: managerIdParamsSchema }),
  deactivateManagerController,
);

router.post(
  '/:id/reactivate',
  requirePermission('user.manager.update'),
  validate({ params: managerIdParamsSchema }),
  reactivateManagerController,
);

router.delete(
  '/:id',
  requirePermission('user.manager.delete'),
  validate({ params: managerIdParamsSchema }),
  deleteManagerController,
);

router.put(
  '/:id/permissions',
  requirePermission('permission.assign'),
  validate({ params: managerIdParamsSchema, body: setManagerPermissionsSchema }),
  setManagerPermissionsController,
);

export default router;
