import type { NextFunction, Request, Response } from 'express';
import { buildPagination } from '../../lib/pagination.js';
import { UnauthorizedError } from '../../lib/errors.js';
import * as shipmentService from '../../services/shipment.service.js';
import * as courierConfig from '../../services/courierConfig.service.js';
import type { ApiSuccess } from '../../types/api.js';
import type { CreateShipmentBody, UpdateCourierConfigBody } from '../../validation/shipment.validation.js';

/**
 * Spec 14 controllers. Thin: parse, call the service, and let the central error
 * handler turn typed errors into the shared envelope. Every shipment endpoint
 * returns the same ShipmentView so the panel re-renders from one shape.
 */

function actorOf(req: Request): shipmentService.ShipmentActor {
  const userId = req.actor?.userId;
  if (!userId) throw new UnauthorizedError('Authentication required.');
  return { userId, type: 'USER' };
}

const permissionsOf = (req: Request) => req.actor?.permissions ?? [];

async function respondWithView(req: Request, res: Response): Promise<void> {
  const view = await shipmentService.getShipmentView(req.params.id as string, permissionsOf(req));
  res.json({ data: view } satisfies ApiSuccess<shipmentService.ShipmentView>);
}

export async function getShipmentController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await respondWithView(req, res);
  } catch (err) {
    next(err);
  }
}

export async function createShipmentController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { courierCode } = req.body as CreateShipmentBody;
    await shipmentService.createShipment(req.params.id as string, courierCode, actorOf(req), req.requestId);
    await respondWithView(req, res);
  } catch (err) {
    next(err);
  }
}

export async function retryShipmentController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await shipmentService.retryShipment(req.params.id as string, actorOf(req), req.requestId);
    await respondWithView(req, res);
  } catch (err) {
    next(err);
  }
}

export async function changeCourierController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { courierCode } = req.body as CreateShipmentBody;
    await shipmentService.changeCourier(req.params.id as string, courierCode, actorOf(req), req.requestId);
    await respondWithView(req, res);
  } catch (err) {
    next(err);
  }
}

export async function markShippedController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await shipmentService.markShipped(req.params.id as string, actorOf(req), req.requestId);
    await respondWithView(req, res);
  } catch (err) {
    next(err);
  }
}

export async function listShipmentRequestsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
    const result = await shipmentService.listCourierRequests(req.params.id as string, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    res.json({
      data: result.items.map((r) => ({
        operation: r.operation,
        succeeded: r.succeeded,
        httpStatus: r.http_status,
        durationMs: r.duration_ms,
        errorMessage: r.error_message,
        createdAt: r.created_at.toISOString(),
      })),
      pagination: buildPagination({ page, pageSize }, result.total),
    });
  } catch (err) {
    next(err);
  }
}

export async function listCouriersController(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ data: await courierConfig.listCourierOptions() } satisfies ApiSuccess<courierConfig.CourierOption[]>);
  } catch (err) {
    next(err);
  }
}

export async function listCourierConfigController(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ data: await courierConfig.listCourierConfig() } satisfies ApiSuccess<courierConfig.CourierConfigView[]>);
  } catch (err) {
    next(err);
  }
}

export async function updateCourierConfigController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = actorOf(req);
    const view = await courierConfig.updateCourierConfig(
      req.params.code as string,
      req.body as UpdateCourierConfigBody,
      actor,
      req.requestId,
    );
    res.json({ data: view } satisfies ApiSuccess<courierConfig.CourierConfigView>);
  } catch (err) {
    next(err);
  }
}
