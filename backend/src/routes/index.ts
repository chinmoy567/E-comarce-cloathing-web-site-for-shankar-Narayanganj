import { Router } from 'express';
import adminRoutes from './admin/index.js';
import customerAuthRoutes from './customer/auth.routes.js';
import customerOrdersRoutes from './customer/orders.routes.js';
import geographyRoutes from './geography.routes.js';
import healthRoutes from './health.routes.js';
import { createAnalyticsRoutes } from './public/analytics.routes.js';
import { createCouponsRoutes } from './public/coupons.routes.js';
import { createPublicCategoriesRoutes } from './public/categories.routes.js';
import { createHomepageRoutes } from './public/homepage.routes.js';
import { createOrderLookupRoutes } from './public/orderLookup.routes.js';
import { createPublicProductsRoutes } from './public/products.routes.js';
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

// Public lookups (spec 15): POST /orders/lookup (guest) and POST /track-order (courier id).
router.use('/', createOrderLookupRoutes());

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

// Public category list — rate-limited (publicCeiling), no auth required.
router.use('/categories', createPublicCategoriesRoutes());

export default router;
