/**
 * Cancel Shipment port (07-order-state-machine §5.21.7).
 *
 * If a shipment is `CREATED` or later when an order is cancelled, the courier's
 * Cancel Shipment must be called; a courier that cannot cancel must block the
 * cancellation rather than silently leaving the shipment active.
 */

import { withTransaction } from '../../lib/transaction.js';
import { append as appendAudit } from '../../repositories/audit.repository.js';
import * as couriersRepository from '../../repositories/couriers.repository.js';
import * as shipmentsRepository from '../../repositories/shipments.repository.js';
import type { ShipmentStatus } from '../../types/orderEnums.js';
import type { ActorType } from '../../types/enums.js';
import * as courierService from './courierService.js';
import { CourierCallError } from './types.js';

export type CancellationOutcome = { cancelled: boolean; reason?: string };

/** Shipment states where no parcel exists at the courier, so there is nothing to cancel. */
const NO_PARCEL: readonly ShipmentStatus[] = ['NOT_CREATED', 'CREATION_FAILED'];

export async function cancelCourierShipmentForOrder(
  orderId: string,
  actor: { userId?: string; type: ActorType },
  requestId?: string,
): Promise<CancellationOutcome> {
  const shipment = await shipmentsRepository.getShipmentByOrderId(orderId);
  if (!shipment || NO_PARCEL.includes(shipment.shipment_status)) return { cancelled: true };

  // An in-flight creation may be creating a parcel right now; cancelling the order underneath it is unsafe.
  if (shipment.shipment_status === 'CREATING') {
    return { cancelled: false, reason: 'Shipment creation is in progress. Try again once it has finished.' };
  }
  if (shipment.cancelled_with_courier_at) return { cancelled: true };
  if (!shipment.courier || !shipment.courier_order_id) {
    return { cancelled: false, reason: 'The shipment has no courier reference to cancel.' };
  }

  const courier = await couriersRepository.getByCode(shipment.courier);
  if (!courier) return { cancelled: false, reason: 'The shipment courier is no longer registered.' };
  if (!courier.supports_cancel) {
    return { cancelled: false, reason: `${courier.name} does not support cancelling a shipment. Cancel it with the courier directly.` };
  }

  let result;
  try {
    result = await courierService.cancelShipment(courier, shipment.id, shipment.courier_order_id);
  } catch (err) {
    return {
      cancelled: false,
      reason: err instanceof CourierCallError ? err.message : 'The courier could not be reached.',
    };
  }
  if (!result.cancelled) {
    return { cancelled: false, reason: result.reason ?? `${courier.name} refused to cancel the shipment.` };
  }

  await withTransaction(async (client) => {
    await shipmentsRepository.markCancelledWithCourier(client, orderId);
    await appendAudit(
      {
        entityType: 'shipment',
        entityId: shipment.id,
        action: 'shipment_cancelled_with_courier',
        previousValue: shipment.shipment_status,
        newValue: courier.code,
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId,
      },
      client,
    );
  });
  return { cancelled: true };
}
