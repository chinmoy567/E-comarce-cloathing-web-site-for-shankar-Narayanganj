import { describe, expect, it } from 'vitest';
import type { CourierAdapter, CourierShipmentRequest } from '../../../src/services/courier/types.js';

/**
 * Reusable adapter contract suite (04-courier §4.9, spec 14 test 10 and 12).
 *
 * `runCourierAdapterContract` is called once per adapter, so a third courier (or the
 * real Pathao/Steadfast adapters, once they exist and have recorded official
 * fixtures) inherits the whole suite by adding one call. The oracle below is
 * transcribed from §4.9 and §5.21.4 — it is NOT derived from src.
 *
 * `prepare` lets a real adapter install its recorded-fixture HTTP stub before each
 * case; it is not needed for in-memory adapters.
 */

/** 07-order-state-machine §5.21.4 shipment_status vocabulary (transcribed). */
export const SHIPMENT_STATUS_VOCABULARY = [
  'NOT_CREATED',
  'CREATING',
  'CREATED',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CREATION_FAILED',
  'DELIVERY_FAILED',
  'RETURNED',
];

export const SAMPLE_REQUEST: CourierShipmentRequest = {
  orderReference: 'FB-CONTRACT-0001',
  recipient: {
    name: 'Contract Tester',
    phone: '01712340001',
    division: 'Dhaka',
    district: 'Dhaka',
    areaUnitType: 'THANA',
    areaUnitName: 'Dhanmondi',
    wardUnitType: 'WARD',
    wardUnitName: 'Ward 15',
    detailedAddress: 'House 12, Road 3',
    postalCode: '1209',
  },
  items: [{ name: 'Cotton Panjabi', quantity: 2 }],
  orderAmount: 1800,
  codAmount: 1800,
  weightGrams: 600,
  deliveryInstructions: null,
};

const SECRET_NAME = /secret|token|password|api[_-]?key|client[_-]?id/i;

export function runCourierAdapterContract(
  name: string,
  adapter: CourierAdapter,
  prepare: () => void | Promise<void> = () => undefined,
): void {
  describe(`courier adapter contract: ${name} (§4.9)`, () => {
    it('has a key, a boolean isConfigured, and declares only non-secret config keys', () => {
      expect(typeof adapter.key).toBe('string');
      expect(adapter.key.length).toBeGreaterThan(0);
      expect(typeof adapter.isConfigured()).toBe('boolean');
      for (const field of adapter.configSchema) {
        expect(Object.keys(field).sort()).toEqual(['key', 'label', 'type']);
        expect(['string', 'number']).toContain(field.type);
        expect(field.key).not.toMatch(SECRET_NAME);
      }
    });

    it('createShipment returns exactly {courierOrderId, trackingUrl, rawProviderReference}; the id is not the order number (§4.15)', async () => {
      await prepare();
      const res = await adapter.createShipment(SAMPLE_REQUEST, {});
      expect(Object.keys(res).sort()).toEqual(['courierOrderId', 'rawProviderReference', 'trackingUrl']);
      expect(typeof res.courierOrderId).toBe('string');
      expect(res.courierOrderId.length).toBeGreaterThan(0);
      expect(res.courierOrderId).not.toBe(SAMPLE_REQUEST.orderReference);
      expect(res.trackingUrl === null || res.trackingUrl.startsWith('https://')).toBe(true);
      expect(res.rawProviderReference === null || typeof res.rawProviderReference === 'string').toBe(true);
    });

    it.each(['getShipmentDetails', 'trackShipment'] as const)(
      '%s returns the normalized shape with only shared-vocabulary statuses (§4.9)',
      async (op) => {
        await prepare();
        const created = await adapter.createShipment(SAMPLE_REQUEST, {});
        const t = await adapter[op](created.courierOrderId, {});
        expect(Object.keys(t).sort()).toEqual(['deliveryAreaSummary', 'estimatedDeliveryAt', 'events', 'status']);
        expect(SHIPMENT_STATUS_VOCABULARY).toContain(t.status);
        for (const ev of t.events) {
          expect(Object.keys(ev).sort()).toEqual(['description', 'occurredAt', 'status']);
          expect(SHIPMENT_STATUS_VOCABULARY).toContain(ev.status);
        }
      },
    );

    it('tracking exposes the delivery area only, never the full address or phone (§4.16)', async () => {
      await prepare();
      const created = await adapter.createShipment(SAMPLE_REQUEST, {});
      const t = await adapter.trackShipment(created.courierOrderId, {});
      const blob = JSON.stringify(t);
      expect(blob).not.toContain(SAMPLE_REQUEST.recipient.detailedAddress);
      expect(blob).not.toContain(SAMPLE_REQUEST.recipient.phone);
    });

    it('cancelShipment returns {cancelled: boolean, reason?: string}', async () => {
      await prepare();
      const created = await adapter.createShipment(SAMPLE_REQUEST, {});
      const r = await adapter.cancelShipment(created.courierOrderId, {});
      expect(typeof r.cancelled).toBe('boolean');
      expect(Object.keys(r).every((k) => k === 'cancelled' || k === 'reason')).toBe(true);
      if (r.reason !== undefined) expect(typeof r.reason).toBe('string');
    });

    it('findShipmentByReference, when implemented, returns null or the same result shape', async () => {
      if (!adapter.findShipmentByReference) return;
      await prepare();
      const found = await adapter.findShipmentByReference(SAMPLE_REQUEST.orderReference, {});
      if (found !== null) {
        expect(Object.keys(found).sort()).toEqual(['courierOrderId', 'rawProviderReference', 'trackingUrl']);
      }
    });
  });
}
