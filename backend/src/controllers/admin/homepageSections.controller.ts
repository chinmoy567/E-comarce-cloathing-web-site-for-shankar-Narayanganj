import type { NextFunction, Request, Response } from 'express';
import * as homepageSectionsService from '../../services/homepageCms/homepageSections.service.js';
import { buildPagination, type PaginationQuery } from '../../lib/pagination.js';
import type { ApiListSuccess, ApiSuccess } from '../../types/api.js';
import type {
  AttachCategoriesRequest,
  AttachProductsRequest,
  CreateSectionRequest,
  ReorderSectionsRequest,
  UpdateSectionRequest,
} from '../../validation/homepageCms.validation.js';

/** Admin homepage-section controllers (13-homepage-cms §13.12, plan §5). Thin — validation in middleware, business rules in the service. */

function actorOf(req: Pick<Request, 'actor'>): homepageSectionsService.Actor {
  return { userId: req.actor!.userId, role: req.actor!.role as 'ADMIN' | 'MANAGER' };
}

export async function listSectionsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pagination = req.query as unknown as PaginationQuery;
    const { items, total } = await homepageSectionsService.listSections(pagination);
    res.status(200).json({ data: items, pagination: buildPagination(pagination, total) } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function getSectionController(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await homepageSectionsService.getSection(req.params.id);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createSectionController(
  req: Request<unknown, unknown, CreateSectionRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await homepageSectionsService.createSection(actorOf(req), req.body);
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateSectionController(
  req: Request<{ id: string }, unknown, UpdateSectionRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await homepageSectionsService.updateSection(actorOf(req), req.params.id, req.body);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deleteSectionController(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    await homepageSectionsService.deleteSection(actorOf(req), req.params.id);
    res.status(200).json({ data: { deleted: true } } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function reorderSectionsController(
  req: Request<unknown, unknown, ReorderSectionsRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await homepageSectionsService.reorderSections(actorOf(req), req.body.sectionIds);
    res.status(200).json({ data: { reordered: true } } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function replaceSectionProductsController(
  req: Request<{ id: string }, unknown, AttachProductsRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await homepageSectionsService.replaceSectionProducts(actorOf(req), req.params.id, req.body.productIds);
    res.status(200).json({ data: { replaced: true } } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function replaceSectionCategoriesController(
  req: Request<{ id: string }, unknown, AttachCategoriesRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await homepageSectionsService.replaceSectionCategories(actorOf(req), req.params.id, req.body.categoryIds);
    res.status(200).json({ data: { replaced: true } } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
