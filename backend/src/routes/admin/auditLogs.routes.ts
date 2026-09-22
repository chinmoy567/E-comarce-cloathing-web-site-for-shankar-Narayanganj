import { Router } from 'express';
import { listAuditLogsController } from '../../controllers/auditLogs.controller.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import { auditLogsQuerySchema } from '../../validation/admin.validation.js';

const router = Router();

router.get('/', requirePermission('audit.view'), validate({ query: auditLogsQuerySchema }), listAuditLogsController);

export default router;
