import { createHmac, timingSafeEqual } from 'node:crypto';
import { SHIPMENT_STATUSES, type ShipmentStatus } from '../../../src/types/orderEnums.js';
import type { CourierAdapter, CourierWebhookUpdate, NormalizedTracking } from '../../../src/services/courier/types.js';

/**
 * A scriptable in-memory CourierAdapter for spec 15 (status sync, Track Order).
 *
 * It is NOT a recording of any provider: real Pathao/Steadfast webhook signature schemes and
 * payloads are deferred until their current official documentation is consulted (CLAUDE.md §6).
 * The fake defines its own TEST-ONLY scheme — HMAC-SHA256 over the raw body in the
 * `x-fake-signature` header, JSON payload `{ events: [{ id, parcel, status, at }] }` — purely
 * so the provider-agnostic webhook framework runs for real end to end.
 */
export const WEBHOOK_SECRET = 'TEST-ONLY-WEBHOOK-SECRET-1b7e';
export const SIGNATURE_HEADER = 'x-fake-signature';

export const sign = (body: string): string => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

export type SyncFakeAdapter = CourierAdapter & {
  readonly state: {
    tracks: string[];
    trackResult: NormalizedTracking | null;
    trackThrows: boolean;
  };
  reset(): void;
};

export const tracking = (status: ShipmentStatus, extra: Partial<NormalizedTracking> = {}): NormalizedTracking => ({
  status,
  events: [{ status, occurredAt: '2026-10-01T10:00:00.000Z', description: `Parcel status: ${status}` }],
  estimatedDeliveryAt: null,
  deliveryAreaSummary: 'Courier Area, Courier District',
  ...extra,
});

export function makeSyncFakeAdapter(key: string): SyncFakeAdapter {
  const state: SyncFakeAdapter['state'] = { tracks: [], trackResult: null, trackThrows: false };

  const adapter: SyncFakeAdapter = {
    key,
    state,
    configSchema: [],
    isConfigured: () => true,
    createShipment: async () => {
      throw new Error('not used by the spec 15 tests');
    },
    getShipmentDetails: async () => tracking('IN_TRANSIT'),
    async trackShipment(courierOrderId) {
      state.tracks.push(courierOrderId);
      if (state.trackThrows) throw new Error('provider unreachable');
      return state.trackResult ?? tracking('IN_TRANSIT');
    },
    cancelShipment: async () => ({ cancelled: true }),

    verifyWebhook(rawBody, headers) {
      const given = headers[SIGNATURE_HEADER];
      if (typeof given !== 'string') return false;
      const expected = Buffer.from(sign(rawBody.toString('utf8')), 'hex');
      const actual = Buffer.from(given, 'hex');
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    },

    parseWebhook(rawBody): CourierWebhookUpdate[] {
      const parsed = JSON.parse(rawBody.toString('utf8')) as {
        events: Array<{ id?: string; parcel: string; status: string; at?: string }>;
      };
      return parsed.events.map((e) => ({
        courierOrderId: e.parcel,
        status: (SHIPMENT_STATUSES as readonly string[]).includes(e.status) ? (e.status as ShipmentStatus) : null,
        providerEventId: e.id ?? null,
        occurredAt: e.at ?? null,
      }));
    },

    reset() {
      state.tracks = [];
      state.trackResult = null;
      state.trackThrows = false;
    },
  };
  return adapter;
}
