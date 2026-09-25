import type { NextFunction, Request, Response } from 'express';
import * as campaignsService from '../../services/homepageCms/campaigns.service.js';
import { buildPagination, type PaginationQuery } from '../../lib/pagination.js';
import type { ApiListSuccess, ApiSuccess } from '../../types/api.js';
import type {
  AttachCategoriesRequest,
  AttachProductsRequest,
  CreateCampaignRequest,
  UpdateCampaignRequest,
} from '../../validation/homepageCms.validation.js';

/** Admin campaign controllers (13-homepage-cms §13.7, plan §5). Thin — validation in middleware, business rules in the service. */

function actorOf(req: Pick<Request, 'actor'>): campaignsService.Actor {
  return { userId: req.actor!.userId, role: req.actor!.role as 'ADMIN' | 'MANAGER' };
}

export async function listCampaignsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pagination = req.query as unknown as PaginationQuery;
    const { items, total } = await campaignsService.listCampaigns(pagination);
    res.status(200).json({ data: items, pagination: buildPagination(pagination, total) } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function getCampaignController(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await campaignsService.getCampaign(req.params.id);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createCampaignController(
  req: Request<unknown, unknown, CreateCampaignRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await campaignsService.createCampaign(actorOf(req), req.body);
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateCampaignController(
  req: Request<{ id: string }, unknown, UpdateCampaignRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await campaignsService.updateCampaign(actorOf(req), req.params.id, req.body);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deleteCampaignController(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    await campaignsService.deleteCampaign(actorOf(req), req.params.id);
    res.status(200).json({ data: { deleted: true } } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function replaceCampaignProductsController(
  req: Request<{ id: string }, unknown, AttachProductsRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await campaignsService.replaceCampaignProducts(actorOf(req), req.params.id, req.body.productIds);
    res.status(200).json({ data: { replaced: true } } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function replaceCampaignCategoriesController(
  req: Request<{ id: string }, unknown, AttachCategoriesRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await campaignsService.replaceCampaignCategories(actorOf(req), req.params.id, req.body.categoryIds);
    res.status(200).json({ data: { replaced: true } } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
