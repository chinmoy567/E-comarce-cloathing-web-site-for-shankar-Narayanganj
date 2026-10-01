import type { NextFunction, Request, Response } from 'express';
import { buildPagination, type PaginationQuery } from '../../lib/pagination.js';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from '../../services/adminCustomers.service.js';
import type { ApiSuccess } from '../../types/api.js';
import type { AccountType } from '../../types/enums.js';

export async function listCustomersController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as PaginationQuery & { q?: string; accountType?: AccountType };
    const { items, total } = await service.listCustomers({ q: q.q, accountType: q.accountType }, q);
    res.json({ data: items, pagination: buildPagination(q, total) });
  } catch (err) {
    next(err);
  }
}

export async function getCustomerController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      data: await service.getCustomer(req.params.id as string, req.actor?.permissions ?? []),
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function listCustomerOrdersController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as PaginationQuery;
    const { items, total } = await service.listCustomerOrders(req.params.id as string, q, req.actor?.permissions ?? []);
    res.json({ data: items, pagination: buildPagination(q, total) });
  } catch (err) {
    next(err);
  }
}

export async function updateCustomerController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.actor?.userId;
    if (!userId) throw new UnauthorizedError('Authentication required.');
    const data = await service.updateCustomer(req.params.id as string, req.body, { userId }, req.requestId);
    res.json({ data } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
