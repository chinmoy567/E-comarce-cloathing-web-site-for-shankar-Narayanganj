import { CourierCallError } from '../../../src/services/courier/types.js';
import type {
  CourierAdapter,
  CourierCancelResult,
  CourierShipmentRequest,
  CourierShipmentResult,
  NormalizedTracking,
} from '../../../src/services/courier/types.js';

/**
 * A scriptable in-memory CourierAdapter. It is NOT a recording of any provider:
 * real Pathao/Steadfast payloads are deferred until the official documentation is
 * available (CLAUDE.md §6). It exists so the courier service, the shipment service
 * and the HTTP routes run for real while only the outbound provider is replaced.
 */
export type CreateMode = 'ok' | 'fail' | 'timeout' | 'rawError';
export type CancelMode = 'ok' | 'refuse' | 'throw';

export const SECRET_IN_RAW_ERROR = 'TEST-ONLY-SECRET-TOKEN-9f3a';

export type FakeCourierAdapter = CourierAdapter & {
  readonly state: {
    creates: CourierShipmentRequest[];
    finds: string[];
    cancels: string[];
    createMode: CreateMode;
    cancelMode: CancelMode;
    /** What findShipmentByReference answers (null = no existing parcel). */
    findResult: CourierShipmentResult | null;
  };
  /** The next createShipment call blocks until release(); `entered` resolves once it is inside the adapter. */
  arm(): { entered: Promise<void>; release: () => void };
  reset(): void;
};

let counter = 0;

export function makeFakeCourierAdapter(key: string, opts: { withReferenceLookup?: boolean } = {}): FakeCourierAdapter {
  const state: FakeCourierAdapter['state'] = {
    creates: [],
    finds: [],
    cancels: [],
    createMode: 'ok',
    cancelMode: 'ok',
    findResult: null,
  };
  let gate: Promise<void> | null = null;
  let signalEntered: (() => void) | null = null;

  const tracking = (): NormalizedTracking => ({
    status: 'IN_TRANSIT',
    events: [{ status: 'IN_TRANSIT', occurredAt: null, description: 'Parcel is in transit.' }],
    estimatedDeliveryAt: null,
    deliveryAreaSummary: 'Dhanmondi, Dhaka',
  });

  const adapter: FakeCourierAdapter = {
    key,
    state,
    configSchema: [{ key: 'storeId', label: 'Store ID', type: 'string' }],
    isConfigured: () => true,

    async createShipment(req): Promise<CourierShipmentResult> {
      state.creates.push(req);
      if (signalEntered) {
        signalEntered();
        signalEntered = null;
      }
      if (gate) {
        const g = gate;
        gate = null;
        await g;
      }
      if (state.createMode === 'fail') throw new CourierCallError('Delivery zone is not serviceable.', 422);
      if (state.createMode === 'timeout') throw new CourierCallError('The courier did not respond in time.');
      if (state.createMode === 'rawError') throw new Error(`401 Unauthorized: bad credentials ${SECRET_IN_RAW_ERROR}`);
      counter += 1;
      return {
        courierOrderId: `TEST-ONLY-${key.toUpperCase()}-${counter}`,
        trackingUrl: null,
        rawProviderReference: 'TEST-ONLY-RAW-PROVIDER-REF',
      };
    },

    getShipmentDetails: async () => tracking(),
    trackShipment: async () => tracking(),

    async cancelShipment(courierOrderId): Promise<CourierCancelResult> {
      state.cancels.push(courierOrderId);
      if (state.cancelMode === 'throw') throw new CourierCallError('Courier API unreachable.', 503);
      if (state.cancelMode === 'refuse') return { cancelled: false, reason: 'Parcel already picked up by the rider.' };
      return { cancelled: true };
    },

    arm() {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      const entered = new Promise<void>((r) => (signalEntered = r));
      return { entered, release };
    },

    reset() {
      state.creates = [];
      state.finds = [];
      state.cancels = [];
      state.createMode = 'ok';
      state.cancelMode = 'ok';
      state.findResult = null;
      gate = null;
      signalEntered = null;
    },
  };

  if (opts.withReferenceLookup) {
    adapter.findShipmentByReference = async (orderReference) => {
      state.finds.push(orderReference);
      return state.findResult;
    };
  }
  return adapter;
}
