import { Router } from 'express';
import authRoutes from './auth.routes.js';
import managersRoutes from './managers.routes.js';
import auditLogsRoutes from './auditLogs.routes.js';
import permissionsRoutes from './permissions.routes.js';
import catalogueRoutes from './catalogue.routes.js';
import ordersRoutes from './orders.routes.js';
import couponsRoutes from './coupons.routes.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requirePasswordChanged } from '../../middleware/requirePasswordChanged.js';

/**
 * Back-office route registry (spec 03 §Routes table).
 *
 * `/auth` mounts its own per-route auth (login/refresh are public;
 * change-password/logout/me must stay reachable while a password change is
 * pending, per acceptance 6). Every other admin route requires a valid admin
 * session AND a completed forced password change — applied once here rather
 * than on each sub-router.
 */
const router = Router();

router.use('/auth', authRoutes);

router.use('/managers', requireAuth('admin'), rateLimit('authenticatedCeiling'), requirePasswordChanged, managersRoutes);
router.use('/audit-logs', requireAuth('admin'), rateLimit('authenticatedCeiling'), requirePasswordChanged, auditLogsRoutes);
router.use('/permissions', requireAuth('admin'), rateLimit('authenticatedCeiling'), requirePasswordChanged, permissionsRoutes);
router.use('/catalogue', requireAuth('admin'), rateLimit('authenticatedCeiling'), requirePasswordChanged, catalogueRoutes);
router.use('/orders', requireAuth('admin'), rateLimit('authenticatedCeiling'), requirePasswordChanged, ordersRoutes);
router.use('/coupons', requireAuth('admin'), rateLimit('authenticatedCeiling'), requirePasswordChanged, couponsRoutes);

export default router;
