import type { NextFunction, Request, Response } from 'express';
import { getHealth, type HealthResult } from '../services/health.service.js';
import type { ApiSuccess } from '../types/api.js';

/** Controllers never query the database; they call a service (backend skill §2). */
export async function healthController(
  _req: Request,
  res: Response<ApiSuccess<HealthResult>>,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json({ data: await getHealth() });
  } catch (err) {
    next(err);
  }
}
