/**
 * Shipment service — courier selection, creation, retry, change-courier and
 * hand-over (04-courier §4.1–4.5, §4.11; 05-admin §5.5, §5.6; 07 §5.21.5).
 *
 * ONE creation path serves create, retry and change-courier so their guards
 * cannot diverge. The `CREATING` status is the concurrency lock: it is a
 * committed row value (held across requests, processes and page reloads), and the
 * courier is called OUTSIDE the transaction so a slow provider never holds a row
 * lock. There is no automatic retry — a timeout may mean the parcel WAS created.
 *
 * A courier failure changes the shipment only: it never rejects a verified
 * payment, cancels a confirmed order, or marks anything Shipped (§3.5, §5.6).
 */

import type pg from 'pg';
import { getEnv } from '../config/env.js';
import { ConflictError, InvalidTransitionError, NotFoundError, UpstreamError, ValidationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { withTransaction } from '../lib/transaction.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import * as couriersRepository from '../repositories/couriers.repository.js';
import * as courierRequestsRepository from '../repositories/courierRequests.repository.js';
import { append as appendStatusHistory } from '../repositories/orderStatusHistory.repository.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import * as shipmentsRepository from '../repositories/shipments.repository.js';
import type { ShipmentFieldUpdate, ShipmentRow } from '../repositories/shipments.repository.js';
import type { ShipmentStatus } from '../types/orderEnums.js';
import type { ActorType } from '../types/enums.js';
import * as courierService from './courier/courierService.js';
import { CourierCallError, type CourierShipmentRequest, type CourierShipmentResult } from './courier/types.js';
import { isValidShipmentTransition } from './orderStateMachine.js';
import { startProcessing } from './orderStatus.service.js';

export type ShipmentActor = { userId: string; type: Extract<ActorType, 'USER'> };

export type ShipmentAction = 'CREATE_SHIPMENT' | 'RETRY_SHIPMENT' | 'CHANGE_COURIER' | 'MARK_SHIPPED';

export type ShipmentView = {
  status: ShipmentStatus;
  courierCode: string | null;
  courierName: string | null;
  courierOrderId: string | null;
  trackingUrl: string | null;
  codAmount: number | null;
  declaredWeightGrams: number | null;
  createdWithCourierAt: string | null;
  shippedAt: string | null;
  cancelledWithCourierAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastErrorCourier: string | null;
  retryMayDuplicate: boolean;
  allowedActions: ShipmentAction[];
};

type CreateMode = 'create' | 'retry' | 'change';

/** Shipment states that mean a parcel already exists at the courier. */
const PARCEL_EXISTS: readonly ShipmentStatus[] = [
  'CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED',
];

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Builds the courier tracking link from the registry template (backend-side only). */
export function resolveTrackingUrl(template: string | null, courierOrderId: string, fromAdapter: string | null): string | null {
  if (fromAdapter && fromAdapter.startsWith('https://')) return fromAdapter;
  if (!template) return null;
  return template.replace('{trackingId}', encodeURIComponent(courierOrderId));
}

function orderReady(order: ordersRepository.Order): 'OK' | 'ORDER_NOT_READY_FOR_SHIPMENT' | 'PAYMENT_NOT_VERIFIED' {
  if (order.order_status !== 'CONFIRMED' && order.order_status !== 'PROCESSING') return 'ORDER_NOT_READY_FOR_SHIPMENT';
  // §4.3: a bKash shipment needs verified payment; §4.4: COD needs no payment verification.
  if (order.payment_method === 'BKASH' && order.payment_status !== 'PAID_VERIFIED') return 'PAYMENT_NOT_VERIFIED';
  return 'OK';
}

/** The one place readiness + permissions become the buttons the panel shows (advisory; routes re-enforce). */
export function computeAllowedShipmentActions(
  order: ordersRepository.Order,
  shipmentStatus: ShipmentStatus,
  permissions: readonly string[],
): ShipmentAction[] {
  if (orderReady(order) !== 'OK') return [];
  const has = (k: string) => permissions.includes(k);
  const actions: ShipmentAction[] = [];
  if (shipmentStatus === 'NOT_CREATED' && has('shipment.create') && has('courier.select')) actions.push('CREATE_SHIPMENT');
  if (shipmentStatus === 'CREATION_FAILED') {
    if (has('shipment.retry')) actions.push('RETRY_SHIPMENT');
    if (has('shipment.courier.change') && has('courier.select')) actions.push('CHANGE_COURIER');
  }
  if (shipmentStatus === 'CREATED' && has('shipment.create')) actions.push('MARK_SHIPPED');
  return actions;
}

async function loadOrderOrThrow(orderId: string, db?: pg.PoolClient, forUpdate = false): Promise<ordersRepository.Order> {
  const order = await ordersRepository.getOrderById(orderId, { forUpdate, db });
  if (!order) throw new NotFoundError('Order not found.');
  return order;
}

export async function getShipmentView(orderId: string, permissions: readonly string[]): Promise<ShipmentView> {
  const order = await loadOrderOrThrow(orderId);
  const shipment = await shipmentsRepository.getShipmentByOrderId(orderId);
  const courier = shipment?.courier ? await couriersRepository.getByCode(shipment.courier) : null;
  const status: ShipmentStatus = shipment?.shipment_status ?? 'NOT_CREATED';
  const failedCourier = shipment?.last_error_courier ? await couriersRepository.getByCode(shipment.last_error_courier) : null;

  return {
    status,
    courierCode: shipment?.courier ?? null,
    courierName: courier?.name ?? null,
    courierOrderId: shipment?.courier_order_id ?? null,
    trackingUrl: shipment?.tracking_url ?? null,
    codAmount: shipment?.cod_amount != null ? Number(shipment.cod_amount) : null,
    declaredWeightGrams: shipment?.declared_weight_grams ?? null,
    createdWithCourierAt: iso(shipment?.created_with_courier_at ?? null),
    shippedAt: iso(shipment?.shipped_at ?? null),
    cancelledWithCourierAt: iso(shipment?.cancelled_with_courier_at ?? null),
    lastError: shipment?.courier_error ?? null,
    lastErrorAt: iso(shipment?.courier_error_at ?? null),
    lastErrorCourier: shipment?.last_error_courier ?? null,
    // A retry may duplicate a parcel when the failed courier cannot be looked up by merchant reference (§4.11).
    retryMayDuplicate: status === 'CREATION_FAILED' && !(failedCourier?.supports_reference_lookup ?? false),
    allowedActions: computeAllowedShipmentActions(order, status, permissions),
  };
}

/** Writes a validated shipment transition with its history + audit rows, inside the caller's transaction. */
export async function transitionInTx(
  client: pg.PoolClient,
  orderId: string,
  from: ShipmentStatus,
  to: ShipmentStatus,
  actor: { userId?: string; type: ActorType },
  requestId: string | undefined,
  fields: ShipmentFieldUpdate,
  auditNote?: string,
): Promise<ShipmentRow> {
  if (!isValidShipmentTransition(from, to)) {
    throw new InvalidTransitionError(`Invalid shipment status transition: ${from} → ${to}`);
  }
  const row = await shipmentsRepository.applyTransition(client, orderId, to, fields);
  await appendStatusHistory(
    {
      entityType: 'order',
      entityId: orderId,
      statusField: 'shipment_status',
      previousStatus: from,
      newStatus: to,
      reason: auditNote ?? null,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    },
    client,
  );
  await appendAudit(
    {
      entityType: 'order',
      entityId: orderId,
      action: 'shipment_status_change',
      previousValue: from,
      newValue: to,
      reason: auditNote,
      actorUserId: actor.userId,
      actorType: actor.type,
      requestId,
    },
    client,
  );
  return row;
}

/** Builds the provider-neutral request from the order row — amounts are the DISCOUNTED total (§4.2, §8.16b). */
async function buildCourierRequest(
  client: pg.PoolClient,
  order: ordersRepository.Order,
): Promise<{ request: CourierShipmentRequest; codAmount: number; weightGrams: number }> {
  const missing =
    !order.full_name || !order.phone_number || !order.division || !order.district ||
    !order.area_unit_type || !order.area_unit_name || !order.ward_unit_type || !order.ward_unit_name ||
    !order.detailed_address;
  if (missing) {
    throw new ConflictError('The order has no complete delivery address.', undefined, 'ORDER_NOT_READY_FOR_SHIPMENT');
  }

  const { rows } = await client.query<{ product_name: string; quantity: number; weight_grams: number | null }>(
    `SELECT oi.product_name, oi.quantity, p.weight_grams
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at ASC`,
    [order.id],
  );

  const known = rows.filter((r) => r.weight_grams != null && r.weight_grams > 0);
  const summed = known.reduce((n, r) => n + (r.weight_grams as number) * r.quantity, 0);
  const weightGrams = summed > 0 && known.length === rows.length ? summed : Math.max(summed, getEnv().DEFAULT_PARCEL_WEIGHT_GRAMS);

  // Prepaid bKash: the courier collects nothing, or the customer would pay twice (§4.4).
  const codAmount = order.payment_method === 'COD' ? order.total_amount : 0;

  return {
    codAmount,
    weightGrams,
    request: {
      orderReference: order.order_number,
      recipient: {
        name: order.full_name as string,
        phone: order.phone_number as string,
        division: order.division as string,
        district: order.district as string,
        areaUnitType: order.area_unit_type as 'UPAZILA' | 'THANA',
        areaUnitName: order.area_unit_name as string,
        wardUnitType: order.ward_unit_type as 'UNION' | 'WARD',
        wardUnitName: order.ward_unit_name as string,
        detailedAddress: order.detailed_address as string,
        postalCode: order.postal_code,
      },
      items: rows.map((r) => ({ name: r.product_name, quantity: r.quantity })),
      orderAmount: order.total_amount,
      codAmount,
      weightGrams,
      deliveryInstructions: null,
    },
  };
}

/**
 * The single creation path. Phase 1 (transaction): guards + `CREATING` lock.
 * Phase 2 (no transaction): the courier call. Phase 3 (transaction): outcome.
 */
async function runCreation(
  orderId: string,
  courierCodeInput: string | null,
  mode: CreateMode,
  actor: ShipmentActor,
  requestId?: string,
): Promise<void> {
  // ---- Phase 1: guard and take the lock -------------------------------------
  const prepared = await withTransaction(async (client) => {
    const order = await loadOrderOrThrow(orderId, client, true);
    const shipment = await shipmentsRepository.ensureShipmentRowLocked(client, orderId);
    const status = shipment.shipment_status;

    // §4.11 concurrent-creation guard: the committed CREATING row IS the lock.
    if (status === 'CREATING') {
      throw new ConflictError('A shipment is already being created for this order.', undefined, 'SHIPMENT_CREATION_IN_PROGRESS');
    }
    if (PARCEL_EXISTS.includes(status)) {
      if (mode === 'create') {
        throw new ConflictError('A shipment already exists for this order.', undefined, 'SHIPMENT_ALREADY_EXISTS');
      }
      throw new InvalidTransitionError('Retry and change courier are only allowed after a failed shipment creation.');
    }
    if (mode !== 'create' && status !== 'CREATION_FAILED') {
      throw new InvalidTransitionError('Retry and change courier are only allowed after a failed shipment creation.');
    }

    const readiness = orderReady(order);
    if (readiness === 'ORDER_NOT_READY_FOR_SHIPMENT') {
      throw new ConflictError('The order must be Confirmed or Processing before a shipment can be created.', undefined, readiness);
    }
    if (readiness === 'PAYMENT_NOT_VERIFIED') {
      throw new ConflictError('The bKash payment must be verified before a shipment can be created.', undefined, readiness);
    }

    const courierCode = mode === 'retry' ? shipment.courier : courierCodeInput;
    const courier = courierCode ? await couriersRepository.getByCode(courierCode, client) : null;
    if (!courier || !courier.is_enabled) {
      throw new ValidationError('That courier is not available.', undefined, 'COURIER_UNAVAILABLE');
    }

    const built = await buildCourierRequest(client, order);

    await transitionInTx(client, orderId, status, 'CREATING', actor, requestId, {
      courier: courier.code,
      clearError: true,
      codAmount: built.codAmount,
      declaredWeightGrams: built.weightGrams,
    }, `courier ${courier.code}`);

    return { shipmentId: shipment.id, previousStatus: status, courier, built };
  });

  const { shipmentId, courier, built } = prepared;

  // ---- Phase 2: the courier call, outside any transaction ---------------------
  let outcome: { result: CourierShipmentResult } | { error: string };
  try {
    let result: CourierShipmentResult | null = null;
    // After a failure the parcel may already exist (the failure could have been a timeout):
    // look it up by merchant reference BEFORE creating a second one (§4.11), where supported.
    if (prepared.previousStatus === 'CREATION_FAILED') {
      result = await courierService.findShipmentByReference(courier, shipmentId, built.request.orderReference);
    }
    result ??= await courierService.createShipment(courier, shipmentId, built.request);
    outcome = { result };
  } catch (err) {
    outcome = { error: err instanceof CourierCallError ? err.message : 'The courier could not complete the request.' };
  }

  // ---- Phase 3: record the outcome -------------------------------------------
  if ('result' in outcome) {
    const { result } = outcome;
    await withTransaction(async (client) => {
      const order = await loadOrderOrThrow(orderId, client, true);
      await transitionInTx(client, orderId, 'CREATING', 'CREATED', actor, requestId, {
        courierOrderId: result.courierOrderId,
        trackingUrl: resolveTrackingUrl(courier.tracking_url_template, result.courierOrderId, result.trackingUrl),
        createdWithCourierAt: true,
      }, `courier ${courier.code}`);
      // §5.21.4: the order is PROCESSING while the shipment progresses.
      if (order.order_status === 'CONFIRMED') await startProcessing(orderId, actor, requestId, client);
    });
    return;
  }

  // Failure changes the shipment only — no payment/order status is touched (§3.5, §4.11, §5.6).
  await withTransaction(async (client) => {
    await transitionInTx(client, orderId, 'CREATING', 'CREATION_FAILED', actor, requestId, {
      error: { message: outcome.error, courier: courier.code },
    }, `courier ${courier.code}`);
  });
  logger.warn({ orderId, courier: courier.code }, 'shipment creation failed');
  throw new UpstreamError(outcome.error, undefined, 'COURIER_REQUEST_FAILED');
}

export function createShipment(orderId: string, courierCode: string, actor: ShipmentActor, requestId?: string) {
  return runCreation(orderId, courierCode, 'create', actor, requestId);
}

export function retryShipment(orderId: string, actor: ShipmentActor, requestId?: string) {
  return runCreation(orderId, null, 'retry', actor, requestId);
}

export function changeCourier(orderId: string, courierCode: string, actor: ShipmentActor, requestId?: string) {
  return runCreation(orderId, courierCode, 'change', actor, requestId);
}

/** CREATED → SHIPPED: parcel hand-over (§5.21.9). Unreachable from CREATION_FAILED (§4.11, §5.6). */
export async function markShipped(orderId: string, actor: ShipmentActor, requestId?: string): Promise<void> {
  await withTransaction(async (client) => {
    await loadOrderOrThrow(orderId, client, true);
    const shipment = await shipmentsRepository.ensureShipmentRowLocked(client, orderId);
    if (shipment.shipment_status !== 'CREATED') {
      throw new InvalidTransitionError(`A shipment can only be marked shipped from Created (it is ${shipment.shipment_status}).`);
    }
    await transitionInTx(client, orderId, 'CREATED', 'SHIPPED', actor, requestId, { shippedAt: true });
  });
}

export async function listCourierRequests(orderId: string, page: { limit: number; offset: number }) {
  const shipment = await shipmentsRepository.getShipmentByOrderId(orderId);
  if (!shipment) return { items: [], total: 0 };
  return courierRequestsRepository.listForShipment(shipment.id, page);
}
