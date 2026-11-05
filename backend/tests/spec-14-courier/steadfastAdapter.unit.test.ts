import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../src/config/env.js';
import {
  buildCreateOrderBody,
  classifySteadfastStatus,
  mapSteadfastStatus,
  steadfastAdapter,
} from '../../src/services/courier/adapters/steadfast.adapter.js';
import { CourierCallError } from '../../src/services/courier/types.js';
import { runCourierAdapterContract, SAMPLE_REQUEST } from './helpers/courierAdapterContract.ts';

/**
 * Steadfast adapter against the response shapes in Steadfast's official API guide and webhook
 * page (steadfast.com.bd > API guide / Webhook), plus the live-verified 401 answer for an
 * unknown invoice (2026-11-06). No network: global fetch is stubbed.
 */

const ENV = {
  STEADFAST_BASE_URL: 'https://steadfast.test/api/v1',
  STEADFAST_API_KEY: 'TEST-ONLY-STEADFAST-KEY-52be',
  STEADFAST_SECRET_KEY: 'TEST-ONLY-STEADFAST-SECRET-9f0a',
  STEADFAST_WEBHOOK_TOKEN: 'TEST-ONLY-WEBHOOK-TOKEN-3c7d',
};

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
let calls: Call[] = [];
let createResponse: { status: number; body: unknown } | null = null;
let trackingsResponse: { status: number; body: unknown } | null = null;
let deliveryStatus = 'pending';
let fetchError: Error | null = null;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const CREATED = (invoice: string) => ({
  status: 200,
  message: 'Consignment has been created successfully.',
  consignment: {
    consignment_id: 1424107,
    invoice,
    tracking_code: '15BAEB8A',
    tracking_link: 'https://steadfast.com.bd/t/15BAEB8A',
    status: 'in_review',
  },
});

function installStub(): void {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (fetchError) throw fetchError;
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: String(init.method), headers, body });
    if (url.endsWith('/create_order')) return createResponse ? json(createResponse.status, createResponse.body) : json(200, CREATED(body.invoice));
    if (url.includes('/trackings_by_invoice/')) {
      return trackingsResponse
        ? json(trackingsResponse.status, trackingsResponse.body)
        : json(200, { status: 200, tracking: [{ consignment_id: 1424107, tracking_type: 1, text: 'Consignment created by Sender(API).' }] });
    }
    if (url.includes('/status_with_return_status_by_cid/')) return json(200, { status: 200, delivery_status: deliveryStatus });
    return new Response('Unauthorized Access', { status: 401 });
  });
}

beforeEach(() => {
  Object.assign(process.env, ENV);
  resetEnvCache();
  calls = [];
  createResponse = null;
  trackingsResponse = null;
  deliveryStatus = 'pending';
  fetchError = null;
  installStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
  resetEnvCache();
});

runCourierAdapterContract('steadfast (official doc fixtures)', steadfastAdapter);

const catchErr = async (p: Promise<unknown>): Promise<CourierCallError> => {
  try {
    await p;
  } catch (e) {
    return e as CourierCallError;
  }
  throw new Error('expected a rejection');
};

describe('steadfast adapter: configuration and requests', () => {
  it('is configured only with both keys', () => {
    expect(steadfastAdapter.isConfigured()).toBe(true);
    delete process.env.STEADFAST_SECRET_KEY;
    resetEnvCache();
    expect(steadfastAdapter.isConfigured()).toBe(false);
  });

  it('sends Api-Key and Secret-Key headers to POST /create_order and returns the consignment id + tracking link', async () => {
    const res = await steadfastAdapter.createShipment({ ...SAMPLE_REQUEST, orderReference: 'FBK-20261106-ABC234' }, {});
    expect(res).toEqual({ courierOrderId: '1424107', trackingUrl: 'https://steadfast.com.bd/t/15BAEB8A', rawProviderReference: '1424107' });
    const [call] = calls;
    expect(call!.url).toBe('https://steadfast.test/api/v1/create_order');
    expect(call!.method).toBe('POST');
    expect(call!.headers['Api-Key']).toBe(ENV.STEADFAST_API_KEY);
    expect(call!.headers['Secret-Key']).toBe(ENV.STEADFAST_SECRET_KEY);
    expect(call!.headers['Content-Type']).toBe('application/json');
  });

  it('builds the documented create_order body', () => {
    const body = buildCreateOrderBody({ ...SAMPLE_REQUEST, orderReference: 'FBK-20261106-ABC234', deliveryInstructions: 'Call before 3 PM' });
    expect(body).toEqual({
      invoice: 'FBK-20261106-ABC234',
      recipient_name: 'Contract Tester',
      recipient_phone: '01712340001',
      recipient_address: 'House 12, Road 3, Ward 15, Dhanmondi, Dhaka, 1209',
      cod_amount: 1800,
      note: 'Call before 3 PM',
      item_description: 'Cotton Panjabi x2',
      total_lot: 2,
      delivery_type: 0,
    });
  });

  it('sends cod_amount 0 for a prepaid order and rounds to whole taka', () => {
    expect(buildCreateOrderBody({ ...SAMPLE_REQUEST, codAmount: 0 }).cod_amount).toBe(0);
    expect(buildCreateOrderBody({ ...SAMPLE_REQUEST, codAmount: 1059.6 }).cod_amount).toBe(1060);
  });

  it('normalizes +880 phones, strips characters Steadfast drops, and truncates to the documented limits', () => {
    const body = buildCreateOrderBody({
      ...SAMPLE_REQUEST,
      recipient: { ...SAMPLE_REQUEST.recipient, phone: '+880 1712-340001', name: `<b>${'N'.repeat(150)}`, detailedAddress: 'A'.repeat(600) },
      deliveryInstructions: 'x'.repeat(600),
    });
    expect(body.recipient_phone).toBe('01712340001');
    expect(String(body.recipient_name)).not.toMatch(/[<>]/);
    expect(String(body.recipient_name).length).toBeLessThanOrEqual(100);
    expect(String(body.recipient_address).length).toBeLessThanOrEqual(490);
    expect(String(body.note).length).toBeLessThanOrEqual(480);
  });

  it('refuses locally (NOT_CREATED) an invalid phone, an unusable invoice, and a COD above the limit, without calling Steadfast', async () => {
    for (const req of [
      { ...SAMPLE_REQUEST, recipient: { ...SAMPLE_REQUEST.recipient, phone: '12345' } },
      { ...SAMPLE_REQUEST, orderReference: 'FBK 2026/11' },
      { ...SAMPLE_REQUEST, codAmount: 1_000_001 },
    ]) {
      const err = await catchErr(steadfastAdapter.createShipment(req, {}));
      expect(err).toBeInstanceOf(CourierCallError);
      expect(err.outcome).toBe('NOT_CREATED');
    }
    expect(calls).toHaveLength(0);
  });
});

describe('steadfast adapter: failures', () => {
  it('a 4xx rejection is NOT_CREATED and carries the field messages', async () => {
    createResponse = { status: 422, body: { status: 422, errors: { recipient_phone: ['The recipient phone format is invalid.'] } } };
    const err = await catchErr(steadfastAdapter.createShipment(SAMPLE_REQUEST, {}));
    expect(err.outcome).toBe('NOT_CREATED');
    expect(err.message).toContain('The recipient phone format is invalid.');
  });

  it('a rejection reported inside an HTTP 200 body is treated as that rejection', async () => {
    createResponse = { status: 200, body: { status: 400, errors: { invoice: ['INVOICE_IS_REQUIRED'] } } };
    const err = await catchErr(steadfastAdapter.createShipment(SAMPLE_REQUEST, {}));
    expect(err.httpStatus).toBe(400);
    expect(err.outcome).toBe('NOT_CREATED');
  });

  it('401 gives a credentials message that names no key', async () => {
    createResponse = { status: 401, body: 'Unauthorized Access' };
    const err = await catchErr(steadfastAdapter.createShipment(SAMPLE_REQUEST, {}));
    expect(err.outcome).toBe('NOT_CREATED');
    expect(err.message).toMatch(/API keys/);
    for (const v of Object.values(ENV)) expect(err.message).not.toContain(v);
  });

  it('429 is a rate-limit message; 5xx, network failure and a malformed 200 are UNKNOWN', async () => {
    createResponse = { status: 429, body: {} };
    expect((await catchErr(steadfastAdapter.createShipment(SAMPLE_REQUEST, {}))).message).toMatch(/rate-limiting/);

    createResponse = { status: 500, body: {} };
    expect((await catchErr(steadfastAdapter.createShipment(SAMPLE_REQUEST, {}))).outcome).toBe('UNKNOWN');

    createResponse = { status: 200, body: { status: 200, message: 'ok' } };
    expect((await catchErr(steadfastAdapter.createShipment(SAMPLE_REQUEST, {}))).outcome).toBe('UNKNOWN');

    fetchError = new Error('socket hang up');
    const err = await catchErr(steadfastAdapter.createShipment(SAMPLE_REQUEST, {}));
    expect(err.outcome).toBe('UNKNOWN');
    expect(err.message).toBe('Steadfast could not be reached.');
  });

  it('a duplicate invoice adopts the parcel Steadfast already holds for this order', async () => {
    createResponse = { status: 422, body: { status: 422, errors: { invoice: ['THIS_INVOICE_ALREADY_EXISTS'] } } };
    const res = await steadfastAdapter.createShipment(SAMPLE_REQUEST, {});
    expect(res.courierOrderId).toBe('1424107');
    expect(calls.map((c) => c.url)).toEqual([
      'https://steadfast.test/api/v1/create_order',
      `https://steadfast.test/api/v1/trackings_by_invoice/${SAMPLE_REQUEST.orderReference}`,
    ]);
  });

  it('a duplicate invoice whose parcel cannot be found is UNKNOWN (a person must link it)', async () => {
    createResponse = { status: 422, body: { status: 422, errors: { invoice: ['THIS_INVOICE_ALREADY_EXISTS'] } } };
    trackingsResponse = { status: 401, body: 'Unauthorized Access' };
    const err = await catchErr(steadfastAdapter.createShipment(SAMPLE_REQUEST, {}));
    expect(err.outcome).toBe('UNKNOWN');
    expect(err.message).toMatch(/already has a parcel/);
  });
});

describe('steadfast adapter: lookup, tracking and cancel', () => {
  it('findShipmentByReference returns the consignment, and null for an unknown invoice (401, live-verified)', async () => {
    expect(await steadfastAdapter.findShipmentByReference!('FBK-1', {})).toEqual({
      courierOrderId: '1424107', trackingUrl: null, rawProviderReference: '1424107',
    });
    trackingsResponse = { status: 401, body: 'Unauthorized Access' };
    expect(await steadfastAdapter.findShipmentByReference!('FBK-1', {})).toBeNull();
    trackingsResponse = { status: 200, body: { status: 200, tracking: [] } };
    expect(await steadfastAdapter.findShipmentByReference!('FBK-1', {})).toBeNull();
  });

  it('tracks through /status_with_return_status_by_cid and reports no merchant reference', async () => {
    deliveryStatus = 'cancelled_return_received';
    const t = await steadfastAdapter.trackShipment('1424107', {});
    expect(calls[0]!.url).toBe('https://steadfast.test/api/v1/status_with_return_status_by_cid/1424107');
    expect(t.status).toBe('RETURNED');
    expect(t.merchantReference).toBeNull();
    expect(t.events).toHaveLength(1);
  });

  it('a status needing a person is an unrecognized-status error while polling', async () => {
    deliveryStatus = 'partial_delivered';
    const err = await catchErr(steadfastAdapter.trackShipment('1424107', {}));
    expect(err.unrecognizedStatus).toBe(true);
    expect(err.message).toMatch(/partial delivery/);
  });

  it('cancel is never attempted at Steadfast', async () => {
    const r = await steadfastAdapter.cancelShipment('1424107', {});
    expect(r.cancelled).toBe(false);
    expect(r.reason).toMatch(/Steadfast merchant panel/);
    expect(calls).toHaveLength(0);
  });
});

describe('steadfast status map (official status reference)', () => {
  const expected: Record<string, string> = {
    in_review: 'CREATED',
    pending: 'CREATED',
    delivered_approval_pending: 'OUT_FOR_DELIVERY',
    partial_delivered_approval_pending: 'OUT_FOR_DELIVERY',
    cancelled_approval_pending: 'OUT_FOR_DELIVERY',
    unknown_approval_pending: 'OUT_FOR_DELIVERY',
    delivered: 'DELIVERED',
    hold: 'DELIVERY_FAILED',
    cancelled: 'DELIVERY_FAILED',
    cancelled_return_proccessing: 'DELIVERY_FAILED',
    cancelled_return_rider_assigned: 'DELIVERY_FAILED',
    cancelled_return_received: 'RETURNED',
  };
  it.each(Object.entries(expected))('%s -> %s', (raw, status) => {
    expect(mapSteadfastStatus(raw)).toBe(status);
  });

  it.each([
    'partial_delivered',
    'partial_delivered_return_proccessing',
    'partial_delivered_return_rider_assigned',
    'partial_delivered_return_received',
    'exceptional',
    'unknown',
    'something_new',
  ])('%s needs a person and never maps to a status', (raw) => {
    expect(classifySteadfastStatus(raw).kind).toBe('attention');
    expect(() => mapSteadfastStatus(raw)).toThrow(CourierCallError);
  });
});

describe('steadfast webhook', () => {
  const body = Buffer.from(JSON.stringify({
    notification_type: 'delivery_status',
    consignment_id: 12345,
    invoice: 'INV-67890',
    cod_amount: 1500.0,
    status: 'delivered',
    delivery_charge: 100.0,
    tracking_message: 'Your package has been delivered successfully.',
    updated_at: '2025-03-02 12:45:30',
  }));
  const sig = (raw: Buffer, token = ENV.STEADFAST_WEBHOOK_TOKEN) => createHmac('sha256', token).update(raw).digest('hex');
  const good = () => ({ authorization: `Bearer ${ENV.STEADFAST_WEBHOOK_TOKEN}`, 'x-signature': sig(body), 'idempotency-key': 'idem-1' });

  it('accepts only a matching Bearer token AND HMAC signature', () => {
    expect(steadfastAdapter.verifyWebhook!(body, good())).toBe(true);
    expect(steadfastAdapter.verifyWebhook!(body, { ...good(), authorization: 'Bearer wrong' })).toBe(false);
    expect(steadfastAdapter.verifyWebhook!(body, { ...good(), 'x-signature': sig(body, 'other-token') })).toBe(false);
    expect(steadfastAdapter.verifyWebhook!(Buffer.from(`${body.toString()} `), good())).toBe(false);
    expect(steadfastAdapter.verifyWebhook!(body, { 'x-signature': sig(body) })).toBe(false);
  });

  it('rejects everything when no webhook token is configured', () => {
    delete process.env.STEADFAST_WEBHOOK_TOKEN;
    resetEnvCache();
    expect(steadfastAdapter.verifyWebhook!(body, good())).toBe(false);
  });

  it('parses delivery_status with the Idempotency-Key as the event id and Dhaka time as UTC', () => {
    expect(steadfastAdapter.parseWebhook!(body, good())).toEqual([
      { courierOrderId: '12345', status: 'DELIVERED', providerEventId: 'idem-1', occurredAt: '2025-03-02T06:45:30.000Z' },
    ]);
  });

  it('falls back to a content key when no Idempotency-Key is sent', () => {
    const [u] = steadfastAdapter.parseWebhook!(body, {});
    expect(u!.providerEventId).toBe('12345|delivered|2025-03-02T06:45:30.000Z');
  });

  it('a partial delivery has no status and an attention message', () => {
    const raw = Buffer.from(JSON.stringify({ notification_type: 'delivery_status', consignment_id: 9, status: 'partial_delivered' }));
    const [u] = steadfastAdapter.parseWebhook!(raw, {});
    expect(u!.status).toBeNull();
    expect(u!.attention).toMatch(/partial delivery/);
  });

  it('ignores every other event type, and throws on malformed input', () => {
    for (const t of ['tracking_update', 'payment_request', 'user_update']) {
      expect(steadfastAdapter.parseWebhook!(Buffer.from(JSON.stringify({ notification_type: t, consignment_id: 1 })), {})).toEqual([]);
    }
    expect(() => steadfastAdapter.parseWebhook!(Buffer.from('not json'), {})).toThrow();
    expect(() => steadfastAdapter.parseWebhook!(Buffer.from(JSON.stringify({ notification_type: 'delivery_status' })), {})).toThrow();
  });
});
