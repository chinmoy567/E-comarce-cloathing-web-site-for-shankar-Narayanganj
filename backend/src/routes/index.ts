import { Router } from 'express';
import adminRoutes from './admin/index.js';
import customerAuthRoutes from './customer/auth.routes.js';
import customerOrdersRoutes from './customer/orders.routes.js';
import customerWishlistRoutes from './customer/wishlist.routes.js';
import geographyRoutes from './geography.routes.js';
import healthRoutes from './health.routes.js';
import { createCartRoutes } from './public/cart.routes.js';
import { createAnalyticsRoutes } from './public/analytics.routes.js';
import { createCouponsRoutes } from './public/coupons.routes.js';
import { createPublicCategoriesRoutes } from './public/categories.routes.js';
import { createHomepageRoutes } from './public/homepage.routes.js';
import { createOrderLookupRoutes } from './public/orderLookup.routes.js';
import { createPaymentProofRoutes } from './public/paymentProof.routes.js';
import { createPublicProductsRoutes } from './public/products.routes.js';
import { createCheckoutRoutes, createShippingRoutes } from './public/shipping.routes.js';
import { rateLimit } from '../middleware/rateLimit.js';
import webhookRoutes from './webhooks.routes.js';

/**
 * Route registry. Routes contain no business logic — they mount validation and
 * delegate to a controller (backend skill §2).
 */
const router = Router();

router.use('/health', healthRoutes);
router.use('/geography', geographyRoutes);
router.use('/admin', adminRoutes);
router.use('/customer/auth', customerAuthRoutes);
router.use('/customer/orders', customerOrdersRoutes);
router.use('/customer/wishlist', customerWishlistRoutes);

// Server-side cart (spec 09) — optional auth, rate-limited (publicCeiling), no-store.
router.use('/cart', createCartRoutes());

// Public lookups (spec 15): POST /orders/lookup (guest) and POST /track-order (courier id).
router.use('/', createOrderLookupRoutes());

// bKash payment screenshot upload (spec 06 private slice) — raw body, order number + phone, per-order limiter.
router.use('/', createPaymentProofRoutes());

// Inbound courier webhooks (spec 15) — signature-verified, rate-limited, no auth.
router.use('/webhooks', webhookRoutes);

// Public analytics endpoint — rate-limited, no auth required.
router.use('/analytics', rateLimit('publicCeiling'), createAnalyticsRoutes());

// Public coupon preview endpoint — rate-limited (couponValidate), no auth required.
router.use('/coupons', createCouponsRoutes());

// Public homepage endpoint — rate-limited (publicCeiling), no auth required.
router.use('/homepage', createHomepageRoutes());

// Public product browsing endpoints — rate-limited (publicCeiling), no auth required.
router.use('/products', createPublicProductsRoutes());

// Public shipping quote + checkout pricing preview (spec 21) — advisory, rate-limited (publicCeiling).
router.use('/shipping', createShippingRoutes());
router.use('/checkout', createCheckoutRoutes());

// Public category list — rate-limited (publicCeiling), no auth required.
router.use('/categories', createPublicCategoriesRoutes());

export default router;
