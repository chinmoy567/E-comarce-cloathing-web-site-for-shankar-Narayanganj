import { Router } from 'express';
import {
  getCustomerController,
  listCustomerOrdersController,
  listCustomersController,
  updateCustomerController,
} from '../../controllers/admin/customers.controller.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import { paginationQuerySchema } from '../../lib/pagination.js';
import {
  customerIdParamsSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from '../../validation/adminCustomers.validation.js';

/** Admin customer management (spec 13, 05-admin §5.7). Auth/rate-limit applied at the admin router level. */
const router = Router();

router.get('/', requirePermission('customer.view'), validate({ query: listCustomersQuerySchema }), listCustomersController);
router.get('/:id', requirePermission('customer.view'), validate({ params: customerIdParamsSchema }), getCustomerController);
router.get(
  '/:id/orders',
  requirePermission('customer.view'),
  validate({ params: customerIdParamsSchema, query: paginationQuerySchema }),
  listCustomerOrdersController,
);
router.patch(
  '/:id',
  requirePermission('customer.update'),
  validate({ params: customerIdParamsSchema, body: updateCustomerSchema }),
  updateCustomerController,
);

export default router;
