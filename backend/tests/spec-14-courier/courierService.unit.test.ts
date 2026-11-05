import { beforeEach, describe, expect, it, vi } from 'vitest';

// The call log is a DB write; this suite checks only the error contract, so the repository is stubbed.
vi.mock('../../src/repositories/courierRequests.repository.js', () => ({ record: vi.fn(async () => undefined) }));

import * as courierService from '../../src/services/courier/courierService.js';
import { registerAdapter, unregisterAdapter } from '../../src/services/courier/registry.js';
import { CourierCallError, type CourierAdapter } from '../../src/services/courier/types.js';
import type { CourierRow } from '../../src/repositories/couriers.repository.js';
import { SAMPLE_REQUEST } from './helpers/courierAdapterContract.ts';

/**
 * courierService re-wraps every adapter error into a sanitized CourierCallError. The
 * "did a parcel get created?" outcome and the unrecognized-status flag must survive that
 * re-wrap, or the shipment service would treat a timeout as a safe-to-retry rejection (0026).
 */
let behaviour: () => Promise<never>;
const adapter: CourierAdapter = {
  key: 'svcunit',
  configSchema: [],
  isConfigured: () => true,
  createShipment: () => behaviour(),
  getShipmentDetails: () => behaviour(),
  trackShipment: () => behaviour(),
  cancelShipment: () => behaviour(),
};
const courier = { code: 'SVCUNIT', adapter_key: 'svcunit', config: {}, supports_reference_lookup: false } as unknown as CourierRow;

const failure = async (p: Promise<unknown>) => (await p.catch((e: unknown) => e)) as CourierCallError;

describe('courierService error contract', () => {
  beforeEach(() => {
    unregisterAdapter();
    registerAdapter(adapter);
  });

  it('keeps NOT_CREATED from a definite rejection', async () => {
    behaviour = async () => {
      throw new CourierCallError('Rejected.', 422);
    };
    expect(await failure(courierService.createShipment(courier, 's1', SAMPLE_REQUEST))).toMatchObject({
      outcome: 'NOT_CREATED',
      httpStatus: 422,
      message: 'Rejected.',
    });
  });

  it('keeps an explicit NOT_CREATED with no HTTP status (refused locally)', async () => {
    behaviour = async () => {
      throw new CourierCallError('Bad phone.', null, { outcome: 'NOT_CREATED' });
    };
    expect((await failure(courierService.createShipment(courier, 's1', SAMPLE_REQUEST))).outcome).toBe('NOT_CREATED');
  });

  it('keeps UNKNOWN and the unrecognized-status flag', async () => {
    behaviour = async () => {
      throw new CourierCallError('Odd status (x).', null, { unrecognizedStatus: true });
    };
    expect(await failure(courierService.trackShipment(courier, 's1', 'ID1'))).toMatchObject({
      outcome: 'UNKNOWN',
      unrecognizedStatus: true,
    });
  });

  it('an unexpected exception becomes a generic message with outcome UNKNOWN and no raw text', async () => {
    behaviour = async () => {
      throw new Error('socket hang up at 10.0.0.5 token=SECRET-XYZ');
    };
    const err = await failure(courierService.createShipment(courier, 's1', SAMPLE_REQUEST));
    expect(err).toBeInstanceOf(CourierCallError);
    expect(err.outcome).toBe('UNKNOWN');
    expect(err.message).not.toContain('SECRET');
  });
});
