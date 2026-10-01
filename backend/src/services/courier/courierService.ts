/**
 * Courier service layer (04-courier §4.8, §4.9).
 *
 * Admin Panel → backend → THIS → provider adapter. Controllers never import an
 * adapter. Every call is timed, recorded in `courier_requests` as a digest (no
 * PII), and any failure is normalized into a CourierCallError whose message is
 * safe to show in the Order Panel — never credentials, a raw body, or a stack.
 */

import { createHash } from 'node:crypto';
import { logger } from '../../lib/logger.js';
import * as courierRequests from '../../repositories/courierRequests.repository.js';
import type { CourierOperation } from '../../repositories/courierRequests.repository.js';
import type { CourierRow } from '../../repositories/couriers.repository.js';
import { getAdapter } from './registry.js';
import {
  CourierCallError,
  type CourierAdapter,
  type CourierCancelResult,
  type CourierShipmentRequest,
  type CourierShipmentResult,
  type NormalizedTracking,
} from './types.js';

const CALL_TIMEOUT_MS = 30_000;
const GENERIC_FAILURE = 'The courier could not complete the request. Please try again or choose another courier.';

export class CourierUnavailableError extends Error {
  constructor(public readonly code: string) {
    super(`Courier ${code} is not available.`);
    this.name = 'CourierUnavailableError';
  }
}

function resolveAdapter(courier: CourierRow): CourierAdapter {
  const adapter = getAdapter(courier.adapter_key);
  if (!adapter) throw new CourierUnavailableError(courier.code);
  return adapter;
}

function digest(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

function safeMessage(err: unknown): { message: string; httpStatus: number | null } {
  if (err instanceof CourierCallError) {
    return { message: err.message.slice(0, 300), httpStatus: err.httpStatus };
  }
  return { message: GENERIC_FAILURE, httpStatus: null };
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CourierCallError('The courier did not respond in time.')), CALL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function call<T>(
  courier: CourierRow,
  operation: CourierOperation,
  shipmentId: string | null,
  payload: unknown,
  fn: (adapter: CourierAdapter, config: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const adapter = resolveAdapter(courier);
  const started = Date.now();
  try {
    const result = await withTimeout(fn(adapter, courier.config ?? {}));
    await courierRequests
      .record({
        shipmentId,
        courierCode: courier.code,
        operation,
        requestDigest: digest(payload),
        httpStatus: null,
        succeeded: true,
        errorMessage: null,
        durationMs: Date.now() - started,
      })
      .catch((e) => logger.error({ err: e }, 'failed to record courier request'));
    return result;
  } catch (err) {
    const { message, httpStatus } = safeMessage(err);
    logger.warn({ courier: courier.code, operation, httpStatus }, 'courier call failed');
    await courierRequests
      .record({
        shipmentId,
        courierCode: courier.code,
        operation,
        requestDigest: digest(payload),
        httpStatus,
        succeeded: false,
        errorMessage: message,
        durationMs: Date.now() - started,
      })
      .catch((e) => logger.error({ err: e }, 'failed to record courier request'));
    throw new CourierCallError(message, httpStatus);
  }
}

/** True when the courier's adapter exists and has its env credentials. */
export function isCourierConfigured(courier: CourierRow): boolean {
  return getAdapter(courier.adapter_key)?.isConfigured() ?? false;
}

export function configSchemaFor(courier: CourierRow) {
  return getAdapter(courier.adapter_key)?.configSchema ?? [];
}

/** NEVER retried internally: a timeout may mean the courier did create the parcel (§4.11). */
export function createShipment(courier: CourierRow, shipmentId: string, req: CourierShipmentRequest): Promise<CourierShipmentResult> {
  return call(courier, 'CREATE', shipmentId, req, (a, cfg) => a.createShipment(req, cfg));
}

/** Detects an already-created parcel before a retry. Null when unsupported or none found. */
export async function findShipmentByReference(
  courier: CourierRow,
  shipmentId: string,
  orderReference: string,
): Promise<CourierShipmentResult | null> {
  const adapter = resolveAdapter(courier);
  if (!courier.supports_reference_lookup || !adapter.findShipmentByReference) return null;
  return call(courier, 'DETAILS', shipmentId, { orderReference }, (a, cfg) => a.findShipmentByReference!(orderReference, cfg));
}

export function getShipmentDetails(courier: CourierRow, shipmentId: string | null, courierOrderId: string): Promise<NormalizedTracking> {
  return call(courier, 'DETAILS', shipmentId, { courierOrderId }, (a, cfg) => a.getShipmentDetails(courierOrderId, cfg));
}

export function trackShipment(courier: CourierRow, shipmentId: string | null, courierOrderId: string): Promise<NormalizedTracking> {
  return call(courier, 'TRACK', shipmentId, { courierOrderId }, (a, cfg) => a.trackShipment(courierOrderId, cfg));
}

export function cancelShipment(courier: CourierRow, shipmentId: string, courierOrderId: string): Promise<CourierCancelResult> {
  return call(courier, 'CANCEL', shipmentId, { courierOrderId }, (a, cfg) => a.cancelShipment(courierOrderId, cfg));
}
