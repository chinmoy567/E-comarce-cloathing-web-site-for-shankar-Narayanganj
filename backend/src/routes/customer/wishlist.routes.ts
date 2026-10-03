import { Router } from 'express';
import {
  addWishlistItemController,
  listWishlistController,
  removeWishlistItemController,
} from '../../controllers/cart.controller.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { addWishlistItemSchema, wishlistProductParamsSchema } from '../../validation/cart.validation.js';

/** Wishlist (spec 09) — registered customers only. Mounted at `/api/customer/wishlist`. */
const router = Router();

router.use(requireAuth('customer'), rateLimit('authenticatedCeiling'));

router.get('/', listWishlistController);
router.post('/', validate({ body: addWishlistItemSchema }), addWishlistItemController);
router.delete('/:productId', validate({ params: wishlistProductParamsSchema }), removeWishlistItemController);

export default router;
