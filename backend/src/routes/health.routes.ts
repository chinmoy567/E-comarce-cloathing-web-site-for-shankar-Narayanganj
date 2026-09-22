import { Router } from 'express';
import { healthController } from '../controllers/health.controller.js';

const router = Router();

// GET /api/health — public, no auth, no permission.
router.get('/', healthController);

export default router;
