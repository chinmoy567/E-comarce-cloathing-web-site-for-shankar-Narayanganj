import type { NextFunction, Request, Response } from 'express';
import * as productsService from '../services/products.service.js';
import { ForbiddenError } from '../lib/errors.js';
import type {
  CreateProductVariantInput,
  UpdateStockInput,
  UpdateVariantInput,
} from '../validation/catalogue.validation.js';
import type { ApiSuccess } from '../types/api.js';

function actorOf(req: Pick<Request, 'actor'>): productsService.Actor {
  return { userId: req.actor!.userId, role: req.actor!.role as 'ADMIN' | 'MANAGER' };
}

/**
 * `PATCH /variants/:id` is gated on `product.variant.manage`, but a variant
 * row also carries its own price override. Per spec 05 §Security requirements,
 * price changes require `product.price.manage` specifically, on every route
 * that can write a price — a Manager holding only `product.variant.manage`
 * (e.g. scoped to sizes/colours) must not be able to change a price by going
 * through the variant route instead of `PATCH /products/:id/price`.
 */
function assertVariantPriceFieldsAllowed(req: Request<unknown, unknown, UpdateVariantInput>): void {
  const touchesPrice = req.body.price !== undefined || req.body.compareAtPrice !== undefined;
  if (touchesPrice && !req.actor!.permissions.includes('product.price.manage')) {
    throw new ForbiddenError('You do not have permission to perform this action.');
  }
}

export async function createVariantController(
  req: Request<{ id: string }, unknown, CreateProductVariantInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await productsService.createVariant(actorOf(req), req.params.id, req.body);
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateVariantController(
  req: Request<{ id: string }, unknown, UpdateVariantInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertVariantPriceFieldsAllowed(req);
    const result = await productsService.updateVariant(actorOf(req), req.params.id, req.body);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deleteVariantController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await productsService.deleteVariant(actorOf(req), req.params.id);
    res.status(200).json({ data: { deleted: true } } satisfies ApiSuccess<{ deleted: true }>);
  } catch (err) {
    next(err);
  }
}

/** Manual stock correction (`inventory.manage`) — requires a `reason` (validated 400 if missing). */
export async function updateStockController(
  req: Request<{ id: string }, unknown, UpdateStockInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await productsService.adjustStock(
      actorOf(req),
      req.params.id,
      req.body.stockQuantity,
      req.body.reason,
    );
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
