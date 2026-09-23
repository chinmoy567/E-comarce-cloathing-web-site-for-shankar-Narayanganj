import { Router } from 'express';
import {
  changePasswordController,
  loginController,
  logoutController,
  meController,
  refreshController,
} from '../../controllers/adminAuth.controller.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { adminLoginSchema, changePasswordSchema } from '../../validation/admin.validation.js';

/**
 * Back-office session lifecycle (spec 03 §Routes). Mounted directly under
 * `/api/admin/auth`, ahead of the router-level `requireAuth`/
 * `requirePasswordChanged` pair `admin/index.ts` applies to every other admin
 * route — login and refresh must be reachable with no session at all, and
 * change-password/logout/me must stay reachable even while a password change
 * is pending (spec 03 §Middleware, acceptance 6).
 */
const router = Router();

router.post('/login', rateLimit('adminLogin'), validate({ body: adminLoginSchema }), loginController);

router.post('/refresh', rateLimit('authenticatedCeiling'), refreshController);

router.post('/logout', requireAuth('admin'), rateLimit('authenticatedCeiling'), logoutController);

router.get('/me', requireAuth('admin'), rateLimit('authenticatedCeiling'), meController);

router.post(
  '/change-password',
  requireAuth('admin'),
  rateLimit('authenticatedCeiling'),
  validate({ body: changePasswordSchema }),
  changePasswordController,
);

export default router;
