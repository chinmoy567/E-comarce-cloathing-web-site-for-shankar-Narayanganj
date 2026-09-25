import type { NextFunction, Request, Response } from 'express';
import * as couponsService from '../../services/coupon/coupons.service.js';
import type {
  CreateCouponRequest,
  ListCouponsQuery,
  SetCouponStatusRequest,
  UpdateCouponRequest,
} from '../../validation/coupons.validation.js';
import { buildPagination, type PaginationQuery } from '../../lib/pagination.js';
import type { ApiListSuccess, ApiSuccess } from '../../types/api.js';

/**
 * Admin coupon management controllers (10-coupon-discount §8.18, plan §5).
 * Thin — validation happens in middleware, business rules in
 * `services/coupon/coupons.service.ts`; every error reaches the centralized
 * `errorHandler` via `next(err)`.
 */

function actorOf(req: Pick<Request, 'actor'>): couponsService.Actor {
  return { userId: req.actor!.userId, role: req.actor!.role as 'ADMIN' | 'MANAGER' };
}

export async function listCouponsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, pageSize, status, discountType, search } = req.query as unknown as ListCouponsQuery;
    const { items, total } = await couponsService.listCoupons(
      { status, discountType, search },
      { page, pageSize },
    );
    res.status(200).json({ data: items, pagination: buildPagination({ page, pageSize }, total) } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function getCouponController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await couponsService.getCoupon(req.params.id);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createCouponController(
  req: Request<unknown, unknown, CreateCouponRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await couponsService.createCoupon(actorOf(req), {
      ...req.body,
      startsAt: req.body.startsAt.toISOString(),
      expiresAt: req.body.expiresAt.toISOString(),
    });
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateCouponController(
  req: Request<{ id: string }, unknown, UpdateCouponRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { startsAt, expiresAt, ...rest } = req.body;
    const result = await couponsService.updateCoupon(actorOf(req), req.params.id, {
      ...rest,
      ...(startsAt !== undefined ? { startsAt: startsAt.toISOString() } : {}),
      ...(expiresAt !== undefined ? { expiresAt: expiresAt.toISOString() } : {}),
    });
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function setCouponStatusController(
  req: Request<{ id: string }, unknown, SetCouponStatusRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await couponsService.setCouponStatus(actorOf(req), req.params.id, req.body.status);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deleteCouponController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await couponsService.deleteOrArchiveCoupon(actorOf(req), req.params.id);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function listCouponUsagesController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const pagination = req.query as unknown as PaginationQuery;
    const { items, total } = await couponsService.listUsages(req.params.id, pagination);
    res
      .status(200)
      .json({ data: items, pagination: buildPagination(pagination, total) } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
