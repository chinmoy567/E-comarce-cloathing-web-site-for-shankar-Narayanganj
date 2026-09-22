import type { NextFunction, Request, Response } from 'express';
import * as permissionsRepository from '../repositories/permissions.repository.js';
import type { ApiSuccess } from '../types/api.js';

/** The permission catalogue is not sensitive (spec 03 §Routes) — no permission gate beyond `requireAuth('admin')`. */
export async function listPermissionsController(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const catalogue = await permissionsRepository.listAll();
    res.status(200).json({
      data: catalogue.map((entry) => ({
        key: entry.key,
        label: entry.label,
        adminTier: entry.adminTier,
        managerTier: entry.managerTier,
        isAdministrative: entry.isAdministrative,
      })),
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
