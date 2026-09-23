import type { NextFunction, Request, Response } from 'express';
import * as productsService from '../services/products.service.js';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdatePriceInput,
  UpdateProductInput,
  UpdateVisibilityInput,
} from '../validation/catalogue.validation.js';
import { buildPagination } from '../lib/pagination.js';
import type { ApiListSuccess, ApiSuccess } from '../types/api.js';

function actorOf(req: Pick<Request, 'actor'>): productsService.Actor {
  return { userId: req.actor!.userId, role: req.actor!.role as 'ADMIN' | 'MANAGER' };
}

export async function listProductsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.query as unknown as ListProductsQuery;
    const { page, pageSize, categoryId, status, isFeatured, search } = query;
    const { items, total } = await productsService.listProducts(
      { categoryId, status, isFeatured, search },
      { page, pageSize },
    );
    res.status(200).json({
      data: items,
      pagination: buildPagination({ page, pageSize }, total),
    } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function getProductController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await productsService.getProduct(req.params.id);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createProductController(
  req: Request<unknown, unknown, CreateProductInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await productsService.createProduct(actorOf(req), req.body);
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateProductController(
  req: Request<{ id: string }, unknown, UpdateProductInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await productsService.updateProduct(actorOf(req), req.params.id, req.body);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deleteProductController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await productsService.deleteProduct(actorOf(req), req.params.id);
    res.status(200).json({ data: { deleted: true } } satisfies ApiSuccess<{ deleted: true }>);
  } catch (err) {
    next(err);
  }
}

export async function updatePriceController(
  req: Request<{ id: string }, unknown, UpdatePriceInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await productsService.updatePrice(actorOf(req), req.params.id, req.body);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateVisibilityController(
  req: Request<{ id: string }, unknown, UpdateVisibilityInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await productsService.updateVisibility(actorOf(req), req.params.id, req.body);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
