import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../src/config/env.js';
import {
  buildOrderBody,
  mapPathaoStatus,
  normalizePhone,
  pathaoAdapter,
  resetPathaoTokenCache,
} from '../../src/services/courier/adapters/pathao.adapter.js';
import { CourierCallError } from '../../src/services/courier/types.js';
import { runCourierAdapterContract, SAMPLE_REQUEST } from './helpers/courierAdapterContract.ts';

/**
 * Pathao adapter against responses recorded from Pathao's sandbox on 2026-10-03
 * (issue-token, POST /orders, GET /orders/{id}/info). No network: global fetch is stubbed.
 */

const ENV = {
  PATHAO_BASE_URL: 'https://pathao.test',
  PATHAO_CLIENT_ID: 'TEST-ONLY-CLIENT-ID',
  PATHAO_CLIENT_SECRET: 'TEST-ONLY-CLIENT-SECRET-4d1e',
  PATHAO_USERNAME: 'tester@example.test',
  PATHAO_PASSWORD: 'TEST-ONLY-PASSWORD-77a',
  PATHAO_STORE_ID: '12345',
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let infoSlug = 'pending';
let orderResponse: { status: number; body: unknown } | null = null;
let tokenResponses: Array<{ status: number; body: unknown }> = [];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function installStub(): void {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: String(init.method), headers, body });
    if (url.endsWith('/issue-token')) {
      const next = tokenResponses.shift();
      return next ? json(next.status, next.body) : json(200, { token_type: 'Bearer', expires_in: 7776000, access_token: 'TOKEN-A', refresh_token: 'R' });
    }
    if (url.endsWith('/orders') && init.method === 'POST') {
      if (orderResponse) return json(orderResponse.status, orderResponse.body);
      return json(200, {
        message: 'Order Created Successfully', type: 'success', code: 200,
        data: { consignment_id: 'DT0310267F2RGX', merchant_order_id: body.merchant_order_id, order_status: 'Pending', delivery_fee: 60 },
      });
    }
    if (/\/orders\/[^/]+\/info$/.test(url)) {
      return json(200, {
        type: 'success', code: 200,
        data: { consignment_id: 'DT0310267F2RGX', invoice_id: null, merchant_order_id: 'X', order_status: 'Pending', order_status_slug: infoSlug, payment_status: '', updated_at: '2026-10-03 21:08:47' },
      });
    }
    return json(404, { message: 'not found' });
  });
}

beforeEach(() => {
  Object.assign(process.env, ENV);
  resetEnvCache();
  resetPathaoTokenCache();
  calls = [];
  infoSlug = 'pending';
  orderResponse = null;
  tokenResponses = [];
  installStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
  resetEnvCache();
});

runCourierAdapterContract('pathao (recorded sandbox fixtures)', pathaoAdapter);

describe('pathao adapter', () => {
  it('is configured only when every credential and the store id are present', () => {
    expect(pathaoAdapter.isConfigured()).toBe(true);
    delete process.env.PATHAO_CLIENT_SECRET;
    resetEnvCache();
    expect(pathaoAdapter.isConfigured()).toBe(false);
  });

  it('sends the documented order body, with COD in whole taka and kg weight', async () => {
    await pathaoAdapter.createShipment({ ...SAMPLE_REQUEST, codAmount: 1799.6 }, {});
    const order = calls.find((c) => c.url.endsWith('/orders'));
    expect(order?.headers.Authorization).toBe('Bearer TOKEN-A');
    expect(order?.body).toMatchObject({
      store_id: 12345,
      merchant_order_id: 'FB-CONTRACT-0001',
      recipient_phone: '01712340001',
      delivery_type: 48,
      item_type: 2,
      item_quantity: 2,
      item_weight: 0.6,
      amount_to_collect: 1800,
    });
    expect(String((order?.body as { recipient_address: string }).recipient_address)).toContain('House 12, Road 3');
  });

  it('collects nothing for a prepaid order', async () => {
    await pathaoAdapter.createShipment({ ...SAMPLE_REQUEST, codAmount: 0 }, {});
    expect((calls.find((c) => c.url.endsWith('/orders'))?.body as { amount_to_collect: number }).amount_to_collect).toBe(0);
  });

  it('clamps weight to Pathao’s 0.5–10 kg range', () => {
    expect(buildOrderBody({ ...SAMPLE_REQUEST, weightGrams: 100 }, 1).item_weight).toBe(0.5);
    expect(buildOrderBody({ ...SAMPLE_REQUEST, weightGrams: 25000 }, 1).item_weight).toBe(10);
  });

  it('reuses one access token across calls', async () => {
    await pathaoAdapter.createShipment(SAMPLE_REQUEST, {});
    await pathaoAdapter.trackShipment('DT0310267F2RGX', {});
    expect(calls.filter((c) => c.url.endsWith('/issue-token'))).toHaveLength(1);
  });

  it('reports a generic message when authentication fails, never the credentials', async () => {
    tokenResponses = [{ status: 400, body: { message: 'The user credentials were incorrect' } }];
    const err = await pathaoAdapter.createShipment(SAMPLE_REQUEST, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CourierCallError);
    const text = (err as Error).message;
    expect(text).toMatch(/authentication failed/i);
    for (const secret of Object.values(ENV)) expect(text).not.toContain(secret);
    expect(calls.some((c) => c.url.endsWith('/orders'))).toBe(false);
  });

  it('surfaces Pathao validation text and does NOT retry a failed creation', async () => {
    orderResponse = { status: 422, body: { message: 'Validation failed', errors: { recipient_address: ['The recipient address is too short.'] } } };
    const err = await pathaoAdapter.createShipment(SAMPLE_REQUEST, {}).catch((e: unknown) => e);
    expect((err as CourierCallError).message).toContain('The recipient address is too short.');
    expect((err as CourierCallError).httpStatus).toBe(422);
    expect(calls.filter((c) => c.url.endsWith('/orders'))).toHaveLength(1);
  });

  it('re-issues the token once on 401 and then succeeds', async () => {
    let first = true;
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/orders') && first) {
        first = false;
        calls.push({ url, method: 'POST', headers: init.headers as Record<string, string>, body: undefined });
        return json(401, { message: 'Unauthenticated.' });
      }
      return original(url, init);
    });
    const res = await pathaoAdapter.createShipment(SAMPLE_REQUEST, {});
    expect(res.courierOrderId).toBe('DT0310267F2RGX');
    expect(calls.filter((c) => c.url.endsWith('/issue-token'))).toHaveLength(2);
  });

  it('cancel is reported as unsupported, with no call to Pathao', async () => {
    const r = await pathaoAdapter.cancelShipment('DT0310267F2RGX', {});
    expect(r.cancelled).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('implements neither webhook method nor reference lookup', () => {
    expect(pathaoAdapter.verifyWebhook).toBeUndefined();
    expect(pathaoAdapter.parseWebhook).toBeUndefined();
    expect(pathaoAdapter.findShipmentByReference).toBeUndefined();
  });

  it('maps Pathao statuses into the shared vocabulary and refuses unknown ones', async () => {
    expect(mapPathaoStatus('pending')).toBe('CREATED');
    expect(mapPathaoStatus('In-Transit')).toBe('IN_TRANSIT');
    expect(mapPathaoStatus('delivered')).toBe('DELIVERED');
    expect(mapPathaoStatus('returned')).toBe('RETURNED');
    expect(() => mapPathaoStatus('something_new')).toThrow(CourierCallError);
    infoSlug = 'something_new';
    await expect(pathaoAdapter.trackShipment('DT0310267F2RGX', {})).rejects.toThrow(/does not recognise/);
  });

  it('reads the Bangladesh-time timestamp as UTC+6', async () => {
    const t = await pathaoAdapter.trackShipment('DT0310267F2RGX', {});
    expect(t.events[0]?.occurredAt).toBe('2026-10-03T15:08:47.000Z');
  });

  it('normalizes Bangladesh phone formats and rejects the rest', () => {
    expect(normalizePhone('+880 1712-340001')).toBe('01712340001');
    expect(normalizePhone('8801712340001')).toBe('01712340001');
    expect(() => normalizePhone('12345')).toThrow(CourierCallError);
  });
});
