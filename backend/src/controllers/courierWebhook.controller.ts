import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError, ValidationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import * as couriersRepository from '../repositories/couriers.repository.js';
import { recordWebhookDelivery } from '../repositories/shipmentSyncEvents.repository.js';
import { getAdapter } from '../services/courier/registry.js';
import type { CourierWebhookUpdate } from '../services/courier/types.js';
import { applyCourierStatusUpdate } from '../services/shipmentSync.service.js';
import type { ApiSuccess } from '../types/api.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Exact bytes of the body, captured by app.ts for /api/webhooks only (signature input). */
      rawBody?: Buffer;
    }
  }
}

const COURIER_CODE_FORMAT = /^[A-Z][A-Z0-9_]{1,31}$/;

async function audit(courierCode: string, signatureValid: boolean, raw: Buffer | undefined, httpStatus: number): Promise<void> {
  try {
    await recordWebhookDelivery({
      courierCode,
      signatureValid,
      // A digest only — the body contains customer data and is never retained (database skill §4).
      payloadDigest: createHash('sha256').update(raw ?? Buffer.alloc(0)).digest('hex'),
      httpStatusReturned: httpStatus,
    });
  } catch (err) {
    // Auditing must never turn an accepted update into a failure.
    logger.error({ err }, 'failed to record courier webhook delivery');
  }
}

const accepted = (res: Response): void => {
  res.status(200).json({ data: { received: true } } satisfies ApiSuccess<{ received: boolean }>);
};

/**
 * POST /api/webhooks/courier/:courierCode (04-courier §4.6, 11-security §11.8).
 *
 * Public but not anonymous in effect: the provider's signature is verified over the raw body
 * BEFORE the payload is parsed or acted on. An invalid signature is 401 and processes nothing.
 * Accepted, duplicate, stale and unknown-shipment updates all return 200, so a provider is
 * never encouraged to retry-storm because the platform correctly ignored a repeat; the
 * distinction lives in `shipment_sync_events.skip_reason`, not the HTTP status.
 */
export async function courierWebhookController(
  req: Request<{ courierCode: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const code = req.params.courierCode.toUpperCase();
    // An unknown or malformed courier is accepted and ignored (no oracle for valid courier codes).
    if (!COURIER_CODE_FORMAT.test(code)) return accepted(res);
    const courier = await couriersRepository.getByCode(code);
    const adapter = courier ? getAdapter(courier.adapter_key) : undefined;
    if (!courier || !adapter?.verifyWebhook || !adapter.parseWebhook) return accepted(res);

    const raw = req.rawBody;
    let valid = false;
    try {
      valid = !!raw && adapter.verifyWebhook(raw, req.headers);
    } catch {
      valid = false;
    }
    if (!valid) {
      await audit(code, false, raw, 401);
      throw new UnauthorizedError('Invalid webhook signature.');
    }

    let updates: CourierWebhookUpdate[];
    try {
      updates = adapter.parseWebhook(raw!);
    } catch {
      await audit(code, true, raw, 400);
      throw new ValidationError('The webhook payload could not be parsed.');
    }

    try {
      for (const update of updates) {
        await applyCourierStatusUpdate(
          {
            courierCode: courier.code,
            courierOrderId: update.courierOrderId,
            status: update.status,
            providerEventId: update.providerEventId,
            occurredAt: update.occurredAt,
            source: 'WEBHOOK',
          },
          req.requestId,
        );
      }
    } catch (err) {
      // An unexpected internal failure should be retried by the provider, so it is NOT a 200.
      await audit(code, true, raw, 500);
      throw err;
    }

    await audit(code, true, raw, 200);
    accepted(res);
  } catch (err) {
    next(err);
  }
}
