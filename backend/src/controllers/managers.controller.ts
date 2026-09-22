import type { NextFunction, Request, Response } from 'express';
import * as managersService from '../services/managers.service.js';
import type {
  CreateManagerInput,
  SetManagerPermissionsInput,
  UpdateManagerInput,
} from '../validation/admin.validation.js';
import { buildPagination, type PaginationQuery } from '../lib/pagination.js';
import type { ApiListSuccess, ApiSuccess } from '../types/api.js';

function actorOf(req: Pick<Request, 'actor'>): managersService.Actor {
  return { userId: req.actor!.userId, role: req.actor!.role as 'ADMIN' | 'MANAGER' };
}

export async function listManagersController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // `validate({ query: listManagersQuerySchema })` has already replaced
    // `req.query` with the parsed, coerced `PaginationQuery`.
    const pagination = req.query as unknown as PaginationQuery;
    const { items, total } = await managersService.listManagers(pagination);
    res.status(200).json({
      data: items.map((user) => ({
        id: user.id,
        userIdentifier: user.userIdentifier,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
      })),
      pagination: buildPagination(pagination, total),
    } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createManagerController(
  req: Request<unknown, unknown, CreateManagerInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await managersService.createManager(actorOf(req), req.body);
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function getManagerController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await managersService.getManager(req.params.id);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateManagerController(
  req: Request<{ id: string }, unknown, UpdateManagerInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await managersService.updateManager(actorOf(req), req.params.id, req.body);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deactivateManagerController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await managersService.deactivateManager(actorOf(req), req.params.id);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function reactivateManagerController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await managersService.reactivateManager(actorOf(req), req.params.id);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deleteManagerController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await managersService.deleteManager(actorOf(req), req.params.id);
    res.status(200).json({ data: { deleted: true } } satisfies ApiSuccess<{ deleted: true }>);
  } catch (err) {
    next(err);
  }
}

export async function setManagerPermissionsController(
  req: Request<{ id: string }, unknown, SetManagerPermissionsInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await managersService.setManagerPermissions(actorOf(req), req.params.id, req.body.permissions);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
