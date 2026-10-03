import { Router } from 'express';
import {
  addCartItemController,
  clearCartController,
  getCartController,
  removeCartItemController,
  updateCartItemController,
} from '../../controllers/cart.controller.js';
import { optionalAuth } from '../../middleware/optionalAuth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { addCartItemSchema, cartVariantParamsSchema, updateCartItemSchema } from '../../validation/cart.validation.js';

/**
 * Cart (spec 09). Unauthenticated by design (02-customer §2.9.1): identity is the customer session when
 * present, otherwise the httpOnly `cart_token` cookie. No route accepts a cart id.
 */
export function createCartRoutes(): Router {
  const router = Router();
  router.use(rateLimit('publicCeiling'), optionalAuth());

  router.get('/', getCartController);
  router.post('/items', validate({ body: addCartItemSchema }), addCartItemController);
  router.patch(
    '/items/:variantId',
    validate({ params: cartVariantParamsSchema, body: updateCartItemSchema }),
    updateCartItemController,
  );
  router.delete('/items/:variantId', validate({ params: cartVariantParamsSchema }), removeCartItemController);
  router.delete('/', clearCartController);

  return router;
}
