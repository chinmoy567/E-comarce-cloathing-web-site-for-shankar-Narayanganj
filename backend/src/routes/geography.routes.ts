import { Router } from 'express';
import {
  listDistrictsController,
  listDivisionsController,
  listUpazilasController,
} from '../controllers/geography.controller.js';
import { validate } from '../middleware/validate.js';
import { districtIdParams, divisionIdParams } from '../validation/geography.validation.js';

/**
 * Public geography reference data — the progressive Division -> District ->
 * Upazila selection the checkout and profile forms load (task §6, §11).
 *
 * Public and unauthenticated: a guest must be able to fill in a delivery
 * address before any account exists (02-customer §2.9). The data is the
 * published national administrative list and contains no customer information.
 *
 * No POST/PATCH/DELETE: the dataset is seeded reference data (task §15).
 */
const router = Router();

router.get('/divisions', listDivisionsController);

router.get('/divisions/:id/districts', validate({ params: divisionIdParams }), listDistrictsController);

router.get('/districts/:id/upazilas', validate({ params: districtIdParams }), listUpazilasController);

export default router;
