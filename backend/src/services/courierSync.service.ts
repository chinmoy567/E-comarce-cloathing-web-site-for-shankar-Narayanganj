/**
 * Courier refresh (spec 15, 04-courier §4.6): the polling job and the public Track Order
 * endpoint both ask the courier for a shipment's current state through here.
 *
 * Both are gated by `claimRefresh`, an atomic per-shipment TTL claim, so any number of
 * concurrent requests plus the poller produce at most ONE provider call per
 * TRACK_REFRESH_TTL_SECONDS — the public endpoint cannot be used to hammer a provider
 * (§4.16). The normalized result is cached on the shipment and any status change goes
 * through the idempotent applier; nothing here writes a status column.
 */

import { getEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as couriersRepository from '../repositories/couriers.repository.js';
import * as shipmentsRepository from '../repositories/shipments.repository.js';
import type { ShipmentRow } from '../repositories/shipments.repository.js';
import type { ShipmentStatus } from '../types/orderEnums.js';
import * as courierService from './courier/courierService.js';
import { applyCourierStatusUpdate } from './shipmentSync.service.js';

/** Shipment states in which the courier can still report something new. */
export const ACTIVE_TRACKING_STATUSES: readonly ShipmentStatus[] = [
  'CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED',
];

export type RefreshResult = { called: boolean; applied: boolean };

export async function refreshShipmentFromCourier(shipment: ShipmentRow): Promise<RefreshResult> {
  const none: RefreshResult = { called: false, applied: false };
  if (!shipment.courier || !shipment.courier_order_id || !ACTIVE_TRACKING_STATUSES.includes(shipment.shipment_status)) {
    return none;
  }
  const courier = await couriersRepository.getByCode(shipment.courier);
  if (!courier || !courier.is_enabled || !courier.supports_tracking) return none;

  // One caller per TTL window wins the claim; everyone else serves the cached snapshot.
  const claimed = await shipmentsRepository.claimRefresh(shipment.id, getEnv().TRACK_REFRESH_TTL_SECONDS);
  if (!claimed) return none;

  try {
    const tracking = await courierService.trackShipment(courier, shipment.id, shipment.courier_order_id);
    await shipmentsRepository.saveTrackingSnapshot(shipment.id, {
      events: tracking.events,
      estimatedDeliveryAt: tracking.estimatedDeliveryAt,
      deliveryAreaSummary: tracking.deliveryAreaSummary,
    });

    if (tracking.status === shipment.shipment_status) return { called: true, applied: false };

    const latest = [...tracking.events].reverse().find((e) => e.status === tracking.status);
    const outcome = await applyCourierStatusUpdate({
      courierCode: courier.code,
      courierOrderId: shipment.courier_order_id,
      status: tracking.status,
      providerEventId: null,
      occurredAt: latest?.occurredAt ?? null,
      source: 'POLL',
    });
    return { called: true, applied: outcome.applied };
  } catch (err) {
    // A provider failure must never break the caller or touch internal state (CLAUDE.md §6).
    logger.warn({ shipmentId: shipment.id, courier: courier.code, err: (err as Error).message }, 'courier refresh failed');
    return { called: true, applied: false };
  }
}

export type PollSummary = { examined: number; providerCalls: number; applied: number };

/** One polling pass. Run by the deployment's scheduler via scripts/pollCourierStatus.ts, never an in-process timer (§11.4). */
export async function pollCourierStatuses(limit = getEnv().COURIER_POLL_BATCH_SIZE): Promise<PollSummary> {
  const batch = await shipmentsRepository.listPollable(limit);
  const summary: PollSummary = { examined: batch.length, providerCalls: 0, applied: 0 };
  for (const shipment of batch) {
    const result = await refreshShipmentFromCourier(shipment);
    if (result.called) summary.providerCalls += 1;
    if (result.applied) summary.applied += 1;
  }
  return summary;
}
