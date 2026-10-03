import type { NextFunction, Request, Response } from 'express';
import * as shippingAdmin from '../../services/shipping/shippingAdmin.service.js';
import { buildPagination, type PaginationQuery } from '../../lib/pagination.js';
import type { CreateRateRequest, CreateZoneRequest, UpdateZoneRequest } from '../../validation/shipping.validation.js';
import type { ApiListSuccess, ApiSuccess } from '../../types/api.js';

/**
 * Admin shipping controllers (spec 21, `system.configure`). Thin — validation happens in
 * middleware, business rules and auditing in `shippingAdmin.service.ts`.
 */

function actorOf(req: Pick<Request, 'actor'>): shippingAdmin.Actor {
  return { userId: req.actor!.userId };
}

export async function listZonesController(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ data: await shippingAdmin.listZones() } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createZoneController(
  req: Request<unknown, unknown, CreateZoneRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await shippingAdmin.createZone(actorOf(req), req.body);
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateZoneController(
  req: Request<{ id: string }, unknown, UpdateZoneRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await shippingAdmin.updateZone(actorOf(req), req.params.id, req.body);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function makeDefaultZoneController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await shippingAdmin.makeDefault(actorOf(req), req.params.id);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createRateController(
  req: Request<{ id: string }, unknown, CreateRateRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await shippingAdmin.createRate(actorOf(req), req.params.id, req.body);
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function listRatesController(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const pagination = req.query as unknown as PaginationQuery;
    const { items, total } = await shippingAdmin.listRates(req.params.id, pagination);
    res
      .status(200)
      .json({ data: items, pagination: buildPagination(pagination, total) } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function listUnmatchedDistrictsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pagination = req.query as unknown as PaginationQuery;
    const { items, total } = await shippingAdmin.listUnmatchedDistricts(pagination);
    res
      .status(200)
      .json({ data: items, pagination: buildPagination(pagination, total) } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
