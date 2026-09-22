import { Router } from 'express';
import { listPermissionsController } from '../../controllers/permissionsCatalogue.controller.js';

/** Catalogue read only — not sensitive, gated by `requireAuth('admin')` alone (spec 03 §Routes). */
const router = Router();

router.get('/', listPermissionsController);

export default router;
