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

export type ShipmentAction = 'CREATE_SHIPMENT' | 'RETRY_SHIPMENT' | 'CHANGE_COURIER' | 'MARK_SHIPPED' | 'LINK_EXISTING_PARCEL';

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
  /**
   * The failed creation got no definite answer from the courier (timeout, network drop,
   * 5xx, interrupted process): the parcel may exist. Retry/change-courier then require
   * `confirmNoExistingParcel`, or the admin links the existing parcel instead (§4.11).
   */
  outcomeUnknown: boolean;
  retryMayDuplicate: boolean;
  /** When the current CREATING attempt began (null outside CREATING). */
  creatingSince: string | null;
  /** A courier-sync failure that needs a person (unrecognized status, rejected credentials, parcel not found). */
  syncProblem: string | null;
  syncProblemAt: string | null;
  /** When shipment_status last changed. */
  statusChangedAt: string | null;
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
    if (has('shipment.retry')) actions.push('LINK_EXISTING_PARCEL');
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
  let shipment = await shipmentsRepository.getShipmentByOrderId(orderId);
  // An interrupted creation is recovered as soon as anyone looks, not only on the next poll run.
  if (shipment?.shipment_status === 'CREATING' && isStale(shipment.creating_started_at ?? shipment.updated_at)) {
    await recoverStuckCreations();
    shipment = await shipmentsRepository.getShipmentByOrderId(orderId);
  }
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
    outcomeUnknown: status === 'CREATION_FAILED' && (shipment?.creation_outcome_unknown ?? false),
    // A retry may duplicate a parcel only when the courier gave no definite answer AND the
    // failed courier cannot be looked up by merchant reference (§4.11).
    retryMayDuplicate:
      status === 'CREATION_FAILED' &&
      (shipment?.creation_outcome_unknown ?? false) &&
      !(failedCourier?.supports_reference_lookup ?? false),
    creatingSince: status === 'CREATING' ? iso(shipment?.creating_started_at ?? null) : null,
    syncProblem: shipment?.sync_problem ?? null,
    syncProblemAt: iso(shipment?.sync_problem_at ?? null),
    statusChangedAt: iso(shipment?.status_changed_at ?? null),
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
      deliveryInstructions: order.delivery_instructions,
    },
  };
}

const INTERRUPTED_MESSAGE =
  'Shipment creation was interrupted before the courier answered. The parcel may or may not exist — ' +
  'check the courier merchant panel, then link the parcel or confirm there is none before retrying.';

/** True when a CREATING attempt that began at `startedAt` is older than the recovery limit. */
function isStale(startedAt: Date | null): boolean {
  if (!startedAt) return true;
  return Date.now() - startedAt.getTime() > getEnv().SHIPMENT_CREATING_TIMEOUT_MINUTES * 60_000;
}

const sameInstant = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

type CreationOptions = { confirmNoExistingParcel?: boolean };

/**
 * The single creation path. Phase 1 (transaction): guards + `CREATING` lock.
 * Phase 2 (no transaction): the courier call. Phase 3 (transaction): outcome.
 *
 * Phase 3 re-reads the row under lock and matches `creating_started_at` to this attempt,
 * because the recovery sweep (or a later attempt) may have moved the row on meanwhile.
 */
async function runCreation(
  orderId: string,
  courierCodeInput: string | null,
  mode: CreateMode,
  actor: ShipmentActor,
  requestId?: string,
  options: CreationOptions = {},
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

    // §4.11 no automatic duplicate: when the last attempt got no definite answer, the parcel may
    // already exist at the courier that failed. Unless that courier can be searched by our order
    // number, a person must check its panel first and say so explicitly.
    if (status === 'CREATION_FAILED' && shipment.creation_outcome_unknown && !options.confirmNoExistingParcel) {
      const failedCode = shipment.last_error_courier ?? shipment.courier;
      const failed = failedCode ? await couriersRepository.getByCode(failedCode, client) : null;
      if (!failed?.supports_reference_lookup) {
        throw new ConflictError(
          'The last attempt got no answer from the courier, so a parcel may already exist. Check the courier ' +
            'merchant panel: link the parcel if it is there, or confirm there is none before retrying.',
          undefined,
          'PARCEL_MAY_EXIST',
        );
      }
    }

    const built = await buildCourierRequest(client, order);

    const row = await transitionInTx(client, orderId, status, 'CREATING', actor, requestId, {
      courier: courier.code,
      clearError: true,
      codAmount: built.codAmount,
      declaredWeightGrams: built.weightGrams,
      creatingStartedAt: true,
      outcomeUnknown: false,
    }, `courier ${courier.code}`);

    return { shipmentId: shipment.id, previousStatus: status, courier, built, attemptStartedAt: row.creating_started_at };
  });

  const { shipmentId, courier, built, attemptStartedAt } = prepared;

  // ---- Phase 2: the courier call, outside any transaction ---------------------
  let outcome: { result: CourierShipmentResult } | { error: string; outcomeUnknown: boolean };
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
    outcome =
      err instanceof CourierCallError
        ? { error: err.message, outcomeUnknown: err.outcome === 'UNKNOWN' }
        : { error: 'The courier could not complete the request.', outcomeUnknown: true };
  }

  // ---- Phase 3: record the outcome -------------------------------------------
  if ('result' in outcome) {
    const { result } = outcome;
    try {
      await withTransaction(async (client) => {
        const order = await loadOrderOrThrow(orderId, client, true);
        const current = await shipmentsRepository.ensureShipmentRowLocked(client, orderId);
        const ours = current.shipment_status === 'CREATING' && sameInstant(current.creating_started_at, attemptStartedAt);

        if (current.shipment_status === 'CREATION_FAILED') {
          // Recovered as interrupted while this call was still running. The parcel is real, so
          // record it rather than leave the order looking parcel-less (and invite a duplicate).
          await transitionInTx(client, orderId, 'CREATION_FAILED', 'CREATING', { type: 'SYSTEM' }, requestId, {
            courier: courier.code,
            creatingStartedAt: true,
          }, `late courier response (${courier.code})`);
        } else if (!ours) {
          throw new ConflictError(
            `The courier created parcel ${result.courierOrderId}, but this order already has another shipment in progress or created. ` +
              'Check the courier merchant panel and cancel the extra parcel there.',
            undefined,
            'DUPLICATE_PARCEL_CREATED',
          );
        }

        await transitionInTx(client, orderId, 'CREATING', 'CREATED', actor, requestId, {
          courier: courier.code,
          courierOrderId: result.courierOrderId,
          trackingUrl: resolveTrackingUrl(courier.tracking_url_template, result.courierOrderId, result.trackingUrl),
          createdWithCourierAt: true,
          clearError: true,
          outcomeUnknown: false,
        }, `courier ${courier.code}`);
        // §5.21.4: the order is PROCESSING while the shipment progresses.
        if (order.order_status === 'CONFIRMED') await startProcessing(orderId, actor, requestId, client);
      });
    } catch (err) {
      // The parcel EXISTS at the courier but could not be recorded. Log the id so it can be
      // reconciled by hand; the order is never left free to create a silent second parcel.
      logger.error(
        { orderId, courier: courier.code, courierOrderId: result.courierOrderId, err: (err as Error).message },
        'courier parcel created but not recorded — reconcile manually',
      );
      throw err;
    }
    return;
  }

  // Failure changes the shipment only — no payment/order status is touched (§3.5, §4.11, §5.6).
  const failed = outcome;
  const error = { message: failed.error, courier: courier.code };
  await withTransaction(async (client) => {
    await loadOrderOrThrow(orderId, client, true);
    const current = await shipmentsRepository.ensureShipmentRowLocked(client, orderId);
    if (!sameInstant(current.creating_started_at, attemptStartedAt)) return; // a later attempt owns the row now
    if (current.shipment_status === 'CREATING') {
      await transitionInTx(client, orderId, 'CREATING', 'CREATION_FAILED', actor, requestId, {
        error,
        outcomeUnknown: failed.outcomeUnknown,
      }, `courier ${courier.code}`);
    } else if (current.shipment_status === 'CREATION_FAILED') {
      // Already recovered as interrupted; replace the guess with the courier's actual answer.
      await shipmentsRepository.updateFailureDetails(client, orderId, error, failed.outcomeUnknown);
    }
  });
  logger.warn({ orderId, courier: courier.code, outcomeUnknown: failed.outcomeUnknown }, 'shipment creation failed');
  throw new UpstreamError(failed.error, undefined, 'COURIER_REQUEST_FAILED');
}

export function createShipment(orderId: string, courierCode: string, actor: ShipmentActor, requestId?: string) {
  return runCreation(orderId, courierCode, 'create', actor, requestId);
}

export function retryShipment(orderId: string, actor: ShipmentActor, requestId?: string, options: CreationOptions = {}) {
  return runCreation(orderId, null, 'retry', actor, requestId, options);
}

export function changeCourier(
  orderId: string,
  courierCode: string,
  actor: ShipmentActor,
  requestId?: string,
  options: CreationOptions = {},
) {
  return runCreation(orderId, courierCode, 'change', actor, requestId, options);
}

/**
 * Recovers interrupted creations (04-courier §4.11): a row still CREATING past
 * SHIPMENT_CREATING_TIMEOUT_MINUTES means the process died or restarted mid-call. It moves
 * to CREATION_FAILED with the outcome marked UNKNOWN, so the panel unlocks but a retry
 * still demands a check for an existing parcel. CREATING → CREATION_FAILED is the existing
 * system transition (07 §5.21.9); no new status. Returns the number recovered.
 */
export async function recoverStuckCreations(
  limit = 50,
  olderThanMinutes: number = getEnv().SHIPMENT_CREATING_TIMEOUT_MINUTES,
): Promise<number> {
  const minutes = olderThanMinutes;
  const recovered = await withTransaction(async (client) => {
    const stuck = await shipmentsRepository.listStuckCreating(client, minutes, limit);
    for (const row of stuck) {
      await transitionInTx(client, row.order_id, 'CREATING', 'CREATION_FAILED', { type: 'SYSTEM' }, undefined, {
        ...(row.courier ? { error: { message: INTERRUPTED_MESSAGE, courier: row.courier } } : {}),
        outcomeUnknown: true,
      }, 'shipment creation interrupted');
    }
    return stuck.length;
  });
  if (recovered > 0) logger.warn({ recovered }, 'recovered interrupted shipment creations');
  return recovered;
}

/** Courier consignment ids: letters, digits and dashes, as couriers issue them. */
const COURIER_ORDER_ID = /^[A-Za-z0-9][A-Za-z0-9-]{3,63}$/;

/**
 * Links a parcel that already exists at the courier to a CREATION_FAILED shipment — the
 * safe way out of an "outcome unknown" failure when the admin finds the parcel in the
 * courier's merchant panel (§4.11: never create a second one). The id is verified with
 * the courier first; where the courier reports the merchant reference, it must equal
 * this order's number. Uses only existing transitions: CREATION_FAILED → CREATING → CREATED.
 */
export async function linkExistingParcel(
  orderId: string,
  courierOrderIdInput: string,
  actor: ShipmentActor,
  requestId?: string,
): Promise<void> {
  const courierOrderId = courierOrderIdInput.trim();
  if (!COURIER_ORDER_ID.test(courierOrderId)) {
    throw new ValidationError('Enter the consignment ID exactly as the courier shows it.', undefined, 'INVALID_COURIER_ORDER_ID');
  }

  const prepared = await withTransaction(async (client) => {
    const order = await loadOrderOrThrow(orderId, client, true);
    const shipment = await shipmentsRepository.ensureShipmentRowLocked(client, orderId);
    if (shipment.shipment_status !== 'CREATION_FAILED') {
      throw new InvalidTransitionError('A parcel can only be linked after a failed shipment creation.');
    }
    const readiness = orderReady(order);
    if (readiness !== 'OK') {
      throw new ConflictError('The order is not ready for shipment.', undefined, readiness);
    }
    const courierCode = shipment.last_error_courier ?? shipment.courier;
    const courier = courierCode ? await couriersRepository.getByCode(courierCode, client) : null;
    if (!courier) throw new ValidationError('That courier is not available.', undefined, 'COURIER_UNAVAILABLE');

    const taken = await shipmentsRepository.findByCourierAndOrderId(courier.code, courierOrderId, client);
    if (taken) {
      throw new ConflictError('That consignment ID is already linked to another order.', undefined, 'PARCEL_ALREADY_LINKED');
    }

    const row = await transitionInTx(client, orderId, 'CREATION_FAILED', 'CREATING', actor, requestId, {
      courier: courier.code,
      creatingStartedAt: true,
    }, `link existing parcel (${courier.code})`);
    return {
      shipmentId: shipment.id,
      courier,
      orderNumber: order.order_number,
      previousError: { message: shipment.courier_error ?? INTERRUPTED_MESSAGE, courier: courier.code },
      previousUnknown: shipment.creation_outcome_unknown,
      attemptStartedAt: row.creating_started_at,
    };
  });
  const { shipmentId, courier, orderNumber, attemptStartedAt } = prepared;

  // Verify with the courier, outside any transaction.
  let failure: { message: string; code: string } | null = null;
  try {
    const details = await courierService.getShipmentDetails(courier, shipmentId, courierOrderId);
    if (details.merchantReference && details.merchantReference !== orderNumber) {
      failure = {
        message: `Consignment ${courierOrderId} belongs to order ${details.merchantReference} at ${courier.name}, not ${orderNumber}.`,
        code: 'PARCEL_ORDER_MISMATCH',
      };
    }
  } catch (err) {
    // The courier answered with the parcel but an unmapped status: the parcel exists, so linking is right.
    if (!(err instanceof CourierCallError && err.unrecognizedStatus)) {
      failure = {
        message: `${courier.name} could not confirm consignment ${courierOrderId}: ${(err as Error).message}`,
        code: 'PARCEL_NOT_VERIFIED',
      };
    }
  }

  await withTransaction(async (client) => {
    const order = await loadOrderOrThrow(orderId, client, true);
    const current = await shipmentsRepository.ensureShipmentRowLocked(client, orderId);
    if (current.shipment_status !== 'CREATING' || !sameInstant(current.creating_started_at, attemptStartedAt)) {
      throw new ConflictError('The shipment changed while the parcel was being verified. Reload and try again.', undefined, 'SHIPMENT_CHANGED');
    }
    if (failure) {
      // Back to exactly where it was: still failed, still "outcome unknown" if it was.
      await transitionInTx(client, orderId, 'CREATING', 'CREATION_FAILED', actor, requestId, {
        error: prepared.previousError,
        outcomeUnknown: prepared.previousUnknown,
      }, `link rejected: ${failure.code}`);
      return;
    }
    await transitionInTx(client, orderId, 'CREATING', 'CREATED', actor, requestId, {
      courierOrderId,
      trackingUrl: resolveTrackingUrl(courier.tracking_url_template, courierOrderId, null),
      createdWithCourierAt: true,
      clearError: true,
      outcomeUnknown: false,
    }, `linked existing parcel ${courierOrderId} (${courier.code})`);
    if (order.order_status === 'CONFIRMED') await startProcessing(orderId, actor, requestId, client);
  });

  if (failure) throw new ValidationError(failure.message, undefined, failure.code);
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
