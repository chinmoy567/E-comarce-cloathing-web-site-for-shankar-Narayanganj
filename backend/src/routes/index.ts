import { Router } from 'express';
import healthRoutes from './health.routes.js';

/**
 * Route registry. Routes contain no business logic — they mount validation and
 * delegate to a controller (backend skill §2).
 */
const router = Router();

router.use('/health', healthRoutes);

export default router;
