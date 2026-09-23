import type { NextFunction, Request, Response } from 'express';
import * as categoriesService from '../services/categories.service.js';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../validation/catalogue.validation.js';
import { buildPagination, type PaginationQuery } from '../lib/pagination.js';
import type { ApiListSuccess, ApiSuccess } from '../types/api.js';

function actorOf(req: Pick<Request, 'actor'>): categoriesService.Actor {
  return { userId: req.actor!.userId, role: req.actor!.role as 'ADMIN' | 'MANAGER' };
}

export async function listCategoriesController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pagination = req.query as unknown as PaginationQuery;
    const { items, total } = await categoriesService.listCategories(pagination);
    res.status(200).json({
      data: items,
      pagination: buildPagination(pagination, total),
    } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createCategoryController(
  req: Request<unknown, unknown, CreateCategoryInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await categoriesService.createCategory(actorOf(req), req.body);
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateCategoryController(
  req: Request<{ id: string }, unknown, UpdateCategoryInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await categoriesService.updateCategory(actorOf(req), req.params.id, req.body);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deleteCategoryController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await categoriesService.deleteCategory(actorOf(req), req.params.id);
    res.status(200).json({ data: { deleted: true } } satisfies ApiSuccess<{ deleted: true }>);
  } catch (err) {
    next(err);
  }
}
