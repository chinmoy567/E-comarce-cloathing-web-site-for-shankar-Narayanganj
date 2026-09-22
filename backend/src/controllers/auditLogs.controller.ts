import type { NextFunction, Request, Response } from 'express';
import { listAuditLogs } from '../services/auditLog.service.js';
import { buildPagination } from '../lib/pagination.js';
import type { AuditLogsQuery } from '../validation/admin.validation.js';
import type { ApiListSuccess } from '../types/api.js';

export async function listAuditLogsController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // `validate({ query: auditLogsQuerySchema })` has already replaced
    // `req.query` with the parsed, coerced `AuditLogsQuery`.
    const { entityType, ...pagination } = req.query as unknown as AuditLogsQuery;
    const { items, total } = await listAuditLogs({ entityType }, pagination);
    res.status(200).json({
      data: items.map((entry) => ({
        id: entry.id,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
        actorUserId: entry.actorUserId,
        actorType: entry.actorType,
        createdAt: entry.createdAt.toISOString(),
      })),
      pagination: buildPagination(pagination, total),
    } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
