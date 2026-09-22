import { Router } from 'express';
import geographyRoutes from './geography.routes.js';
import healthRoutes from './health.routes.js';

/**
 * Route registry. Routes contain no business logic — they mount validation and
 * delegate to a controller (backend skill §2).
 */
const router = Router();

router.use('/health', healthRoutes);
router.use('/geography', geographyRoutes);

export default router;
