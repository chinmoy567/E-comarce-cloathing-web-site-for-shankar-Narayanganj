import type { NextFunction, Request, Response } from 'express';
import { getDistricts, getDivisions, getUpazilas } from '../services/geography.service.js';
import type { ApiSuccess } from '../types/api.js';
import type { GeoNode } from '../types/geography.js';

/**
 * Geography lookup endpoints (task §6).
 *
 * Read-only by design — the dataset is seeded reference data and no requirement
 * asks for Admin management of it, so no mutation endpoint exists (task §15).
 *
 * Controllers never query the database; they call the service (backend skill §2).
 */

export async function listDivisionsController(
  _req: Request,
  res: Response<ApiSuccess<GeoNode[]>>,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json({ data: await getDivisions() });
  } catch (err) {
    next(err);
  }
}

export async function listDistrictsController(
  req: Request<{ id: string }>,
  res: Response<ApiSuccess<GeoNode[]>>,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json({ data: await getDistricts(req.params.id) });
  } catch (err) {
    next(err);
  }
}

export async function listUpazilasController(
  req: Request<{ id: string }>,
  res: Response<ApiSuccess<GeoNode[]>>,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json({ data: await getUpazilas(req.params.id) });
  } catch (err) {
    next(err);
  }
}
