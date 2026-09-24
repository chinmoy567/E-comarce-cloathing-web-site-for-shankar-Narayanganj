import { Router } from 'express';
import adminRoutes from './admin/index.js';
import geographyRoutes from './geography.routes.js';
import healthRoutes from './health.routes.js';
import { createAnalyticsRoutes } from './public/analytics.routes.js';
import { rateLimit } from '../middleware/rateLimit.js';

/**
 * Route registry. Routes contain no business logic — they mount validation and
 * delegate to a controller (backend skill §2).
 */
const router = Router();

router.use('/health', healthRoutes);
router.use('/geography', geographyRoutes);
router.use('/admin', adminRoutes);

// Public analytics endpoint — rate-limited, no auth required.
router.use('/analytics', rateLimit('publicCeiling'), createAnalyticsRoutes());

export default router;
