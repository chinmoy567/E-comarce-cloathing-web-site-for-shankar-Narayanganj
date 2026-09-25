import { Router } from 'express';
import {
  createCouponController,
  deleteCouponController,
  getCouponController,
  listCouponsController,
  listCouponUsagesController,
  setCouponStatusController,
  updateCouponController,
} from '../../controllers/admin/coupons.controller.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import {
  couponIdParamsSchema,
  createCouponSchema,
  listCouponsQuerySchema,
  listCouponUsagesQuerySchema,
  setCouponStatusSchema,
  updateCouponSchema,
} from '../../validation/coupons.validation.js';

/**
 * Admin coupon management (10-coupon-discount §8.18, §8.19, plan §5).
 * `requireAuth('admin')` and `requirePasswordChanged` are applied once at
 * `admin/index.ts` router level; each route below adds only its own
 * `requirePermission` gate — activate/deactivate is a distinct route from
 * `PATCH` because §5.18 gives it its own permission row (`coupon.status`),
 * so a Manager holding only `coupon.update` cannot silently gain the ability
 * to flip a coupon live.
 */
const router = Router();

router.get('/', requirePermission('coupon.view'), validate({ query: listCouponsQuerySchema }), listCouponsController);

router.post('/', requirePermission('coupon.create'), validate({ body: createCouponSchema }), createCouponController);

router.get(
  '/:id',
  requirePermission('coupon.view'),
  validate({ params: couponIdParamsSchema }),
  getCouponController,
);

router.patch(
  '/:id',
  requirePermission('coupon.update'),
  validate({ params: couponIdParamsSchema, body: updateCouponSchema }),
  updateCouponController,
);

router.post(
  '/:id/status',
  requirePermission('coupon.status'),
  validate({ params: couponIdParamsSchema, body: setCouponStatusSchema }),
  setCouponStatusController,
);

router.delete(
  '/:id',
  requirePermission('coupon.delete'),
  validate({ params: couponIdParamsSchema }),
  deleteCouponController,
);

router.get(
  '/:id/usages',
  requirePermission('coupon.usage.view'),
  validate({ params: couponIdParamsSchema, query: listCouponUsagesQuerySchema }),
  listCouponUsagesController,
);

export default router;
