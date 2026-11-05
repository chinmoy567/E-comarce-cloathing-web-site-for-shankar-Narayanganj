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

describe('pathao adapter — production go-live hardening', () => {
  const tokenCalls = () => calls.filter((c) => c.url.endsWith('/issue-token'));
  const orderCalls = () => calls.filter((c) => c.url.endsWith('/orders'));

  describe('token lifecycle', () => {
    it('first token uses the password grant with the configured credentials', async () => {
      await pathaoAdapter.trackShipment('DT0310267F2RGX', {});
      expect(tokenCalls()[0]?.body).toEqual({
        client_id: ENV.PATHAO_CLIENT_ID,
        client_secret: ENV.PATHAO_CLIENT_SECRET,
        grant_type: 'password',
        username: ENV.PATHAO_USERNAME,
        password: ENV.PATHAO_PASSWORD,
      });
    });

    it('an expired token is renewed with the refresh_token grant, without re-sending the password', async () => {
      // expires_in shorter than the safety margin -> already stale on the next call.
      tokenResponses = [
        { status: 200, body: { token_type: 'Bearer', expires_in: 1, access_token: 'TOKEN-1', refresh_token: 'REFRESH-1' } },
        { status: 200, body: { token_type: 'Bearer', expires_in: 432000, access_token: 'TOKEN-2', refresh_token: 'REFRESH-2' } },
      ];
      await pathaoAdapter.trackShipment('DT0310267F2RGX', {});
      await pathaoAdapter.trackShipment('DT0310267F2RGX', {});
      const second = tokenCalls()[1]?.body as Record<string, unknown>;
      expect(second).toEqual({
        client_id: ENV.PATHAO_CLIENT_ID,
        client_secret: ENV.PATHAO_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: 'REFRESH-1',
      });
      expect(second).not.toHaveProperty('password');
      const info = calls.filter((c) => c.url.endsWith('/info'));
      expect(info[1]?.headers.Authorization).toBe('Bearer TOKEN-2');
    });

    it('a rejected refresh token falls back to the password grant', async () => {
      tokenResponses = [
        { status: 200, body: { expires_in: 1, access_token: 'TOKEN-1', refresh_token: 'REFRESH-1' } },
        { status: 400, body: { message: 'The refresh token is invalid.' } },
        { status: 200, body: { expires_in: 432000, access_token: 'TOKEN-3', refresh_token: 'REFRESH-3' } },
      ];
      await pathaoAdapter.trackShipment('DT0310267F2RGX', {});
      await pathaoAdapter.trackShipment('DT0310267F2RGX', {});
      expect(tokenCalls().map((c) => (c.body as { grant_type: string }).grant_type)).toEqual(['password', 'refresh_token', 'password']);
      expect(calls.filter((c) => c.url.endsWith('/info'))[1]?.headers.Authorization).toBe('Bearer TOKEN-3');
    });

    it('a valid token is cached: many calls, one token request', async () => {
      for (let i = 0; i < 5; i++) await pathaoAdapter.trackShipment('DT0310267F2RGX', {});
      expect(tokenCalls()).toHaveLength(1);
    });

    it('concurrent calls share one in-flight token request (single-flight)', async () => {
      await Promise.all(Array.from({ length: 6 }, () => pathaoAdapter.trackShipment('DT0310267F2RGX', {})));
      expect(tokenCalls()).toHaveLength(1);
    });

    it('a failed token request is not cached: the next call tries again', async () => {
      tokenResponses = [{ status: 500, body: { message: 'Server Error' } }];
      await expect(pathaoAdapter.trackShipment('DT0310267F2RGX', {})).rejects.toThrow(/authentication failed/i);
      await expect(pathaoAdapter.trackShipment('DT0310267F2RGX', {})).resolves.toMatchObject({ status: 'CREATED' });
      expect(tokenCalls()).toHaveLength(2);
    });

    it('a 200 without an access_token is an authentication failure, not a cached empty token', async () => {
      tokenResponses = [{ status: 200, body: { message: 'ok but empty' } }];
      await expect(pathaoAdapter.createShipment(SAMPLE_REQUEST, {})).rejects.toThrow(/authentication failed/i);
      expect(orderCalls()).toHaveLength(0);
    });
  });

  describe('order payload rules (Merchant API create-order)', () => {
    it('never sends recipient_city/zone/area (no nulls): Pathao resolves them from the address', () => {
      const body = buildOrderBody(SAMPLE_REQUEST, 497221);
      for (const k of ['recipient_city', 'recipient_zone', 'recipient_area']) expect(body).not.toHaveProperty(k);
      expect(Object.values(body)).not.toContain(null);
      expect(Object.values(body)).not.toContain(undefined);
    });

    it('store_id is the integer from env and merchant_order_id is the order number', async () => {
      await pathaoAdapter.createShipment(SAMPLE_REQUEST, {});
      const body = orderCalls()[0]?.body as Record<string, unknown>;
      expect(body.store_id).toBe(12345);
      expect(Number.isInteger(body.store_id)).toBe(true);
      expect(body.merchant_order_id).toBe(SAMPLE_REQUEST.orderReference);
    });

    it('recipient_phone is exactly 11 digits', () => {
      const phone = buildOrderBody({ ...SAMPLE_REQUEST, recipient: { ...SAMPLE_REQUEST.recipient, phone: '+880-1812 345678' } }, 1).recipient_phone;
      expect(phone).toBe('01812345678');
      expect(String(phone)).toHaveLength(11);
    });

    it('an invalid phone never reaches Pathao', async () => {
      const req = { ...SAMPLE_REQUEST, recipient: { ...SAMPLE_REQUEST.recipient, phone: '0171234' } };
      await expect(pathaoAdapter.createShipment(req, {})).rejects.toBeInstanceOf(CourierCallError);
      expect(orderCalls()).toHaveLength(0);
    });

    it('recipient_name: under 3 chars is refused locally, over 100 is truncated', () => {
      const short = { ...SAMPLE_REQUEST, recipient: { ...SAMPLE_REQUEST.recipient, name: ' Al ' } };
      expect(() => buildOrderBody(short, 1)).toThrow(/too short/);
      const long = { ...SAMPLE_REQUEST, recipient: { ...SAMPLE_REQUEST.recipient, name: 'N'.repeat(150) } };
      expect(String(buildOrderBody(long, 1).recipient_name)).toHaveLength(100);
    });

    it('recipient_address: under 10 chars is refused locally, over 220 is truncated', () => {
      const tiny = { ...SAMPLE_REQUEST, recipient: { ...SAMPLE_REQUEST.recipient, detailedAddress: 'H1', wardUnitName: '', areaUnitName: '', district: '' } };
      expect(() => buildOrderBody(tiny, 1)).toThrow(/too short/);
      const huge = { ...SAMPLE_REQUEST, recipient: { ...SAMPLE_REQUEST.recipient, detailedAddress: 'Road '.repeat(80) } };
      const addr = String(buildOrderBody(huge, 1).recipient_address);
      expect(addr.length).toBeLessThanOrEqual(220);
      expect(addr.length).toBeGreaterThanOrEqual(10);
    });

    it('item_weight is a number in kg within 0.5–10', () => {
      for (const grams of [0, 1, 499, 500, 1234, 10_000, 99_999]) {
        const w = buildOrderBody({ ...SAMPLE_REQUEST, weightGrams: grams }, 1).item_weight;
        expect(typeof w).toBe('number');
        expect(w).toBeGreaterThanOrEqual(0.5);
        expect(w).toBeLessThanOrEqual(10);
      }
      expect(buildOrderBody({ ...SAMPLE_REQUEST, weightGrams: 1234 }, 1).item_weight).toBe(1.234);
    });

    it('amount_to_collect: COD is the whole-taka integer, prepaid is exactly 0, never negative', () => {
      const cod = buildOrderBody({ ...SAMPLE_REQUEST, codAmount: 1499.5 }, 1).amount_to_collect;
      expect(cod).toBe(1500);
      expect(Number.isInteger(cod)).toBe(true);
      expect(buildOrderBody({ ...SAMPLE_REQUEST, codAmount: 0 }, 1).amount_to_collect).toBe(0);
      expect(buildOrderBody({ ...SAMPLE_REQUEST, codAmount: -5 }, 1).amount_to_collect).toBe(0);
    });

    it('uses normal delivery (48) and parcel item type (2)', () => {
      const body = buildOrderBody(SAMPLE_REQUEST, 1);
      expect(body.delivery_type).toBe(48);
      expect(body.item_type).toBe(2);
    });

    it('creates through the single-order endpoint, never the asynchronous bulk endpoint', async () => {
      await pathaoAdapter.createShipment(SAMPLE_REQUEST, {});
      expect(calls.some((c) => c.url.includes('/orders/bulk'))).toBe(false);
      expect(orderCalls()[0]?.url).toBe('https://pathao.test/aladdin/api/v1/orders');
    });
  });

  describe('failures are reported, never retried, never leak credentials', () => {
    const leaks = (text: string) => Object.values(ENV).filter((v) => v.length > 8 && text.includes(v));

    it('5xx on create: CourierCallError with the status, exactly one create call', async () => {
      orderResponse = { status: 503, body: '<html>Service Unavailable</html>' };
      const err = (await pathaoAdapter.createShipment(SAMPLE_REQUEST, {}).catch((e: unknown) => e)) as CourierCallError;
      expect(err).toBeInstanceOf(CourierCallError);
      expect(err.httpStatus).toBe(503);
      expect(orderCalls()).toHaveLength(1);
      expect(leaks(err.message)).toEqual([]);
    });

    it('network failure / timeout on create: "could not be reached", exactly one create call', async () => {
      const original = globalThis.fetch;
      vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        if (url.endsWith('/orders')) {
          calls.push({ url, method: 'POST', headers: {}, body: undefined });
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        }
        return original(url, init);
      });
      const err = (await pathaoAdapter.createShipment(SAMPLE_REQUEST, {}).catch((e: unknown) => e)) as CourierCallError;
      expect(err).toBeInstanceOf(CourierCallError);
      expect(err.message).toMatch(/could not be reached/);
      expect(orderCalls()).toHaveLength(1);
    });

    it('a persistent 401 re-authenticates once, then fails without a third attempt', async () => {
      orderResponse = { status: 401, body: { message: 'Unauthenticated.' } };
      const err = (await pathaoAdapter.createShipment(SAMPLE_REQUEST, {}).catch((e: unknown) => e)) as CourierCallError;
      expect(err.httpStatus).toBe(401);
      expect(orderCalls()).toHaveLength(2);
      expect(tokenCalls()).toHaveLength(2);
      expect(leaks(err.message)).toEqual([]);
    });

    it('a 200 with no consignment_id is a failure, not a parcel with an empty id', async () => {
      orderResponse = { status: 200, body: { message: 'Order Created Successfully', data: { consignment_id: '' } } };
      await expect(pathaoAdapter.createShipment(SAMPLE_REQUEST, {})).rejects.toBeInstanceOf(CourierCallError);
    });

    it('the bearer token is sent only as a header and never appears in an error message', async () => {
      orderResponse = { status: 422, body: { message: 'Bad', errors: { x: ['Token TOKEN-A rejected'] } } };
      const err = (await pathaoAdapter.createShipment(SAMPLE_REQUEST, {}).catch((e: unknown) => e)) as CourierCallError;
      // The provider echoed text is passed through, but our own credentials never are.
      expect(leaks(err.message)).toEqual([]);
      expect(JSON.stringify(orderCalls()[0]?.body)).not.toContain('TOKEN-A');
    });
  });

  describe('status slugs', () => {
    it('the live-confirmed "Pending" slug maps to CREATED', () => {
      expect(mapPathaoStatus('Pending')).toBe('CREATED');
    });

    it('an unknown slug raises and names the slug (sanitized) so it can be recorded and mapped later', async () => {
      infoSlug = 'Weird-New Status';
      const err = (await pathaoAdapter.trackShipment('DT0310267F2RGX', {}).catch((e: unknown) => e)) as CourierCallError;
      expect(err).toBeInstanceOf(CourierCallError);
      expect(err.message).toContain('(weird_new_status)');
    });

    it('a missing or hostile slug is never guessed and never echoed raw', () => {
      expect(() => mapPathaoStatus(undefined)).toThrow(/\(empty\)/);
      expect(() => mapPathaoStatus(42)).toThrow(CourierCallError);
      let message = '';
      try {
        mapPathaoStatus('<script>alert(1)</script>');
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toMatch(/[<>()]{2}|script>/);
    });
  });
});

describe('pathao adapter — "did a parcel get created?" classification (0026)', () => {
  const outcomeOf = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as CourierCallError).outcome;
  const withRecipient = (r: Partial<typeof SAMPLE_REQUEST.recipient>) => ({
    ...SAMPLE_REQUEST,
    recipient: { ...SAMPLE_REQUEST.recipient, ...r },
  });

  it('CourierCallError defaults: a 4xx answer is NOT_CREATED, no answer or a 5xx is UNKNOWN', () => {
    expect(new CourierCallError('x', 422).outcome).toBe('NOT_CREATED');
    expect(new CourierCallError('x', 401).outcome).toBe('NOT_CREATED');
    expect(new CourierCallError('x', 503).outcome).toBe('UNKNOWN');
    expect(new CourierCallError('x', 200).outcome).toBe('UNKNOWN');
    expect(new CourierCallError('x').outcome).toBe('UNKNOWN');
    expect(new CourierCallError('x', null, { outcome: 'NOT_CREATED' }).outcome).toBe('NOT_CREATED');
    expect(new CourierCallError('x').unrecognizedStatus).toBe(false);
  });

  it('refused locally before sending (bad phone, short name/address, not configured): NOT_CREATED', async () => {
    expect(await outcomeOf(pathaoAdapter.createShipment(withRecipient({ phone: '123' }), {}))).toBe('NOT_CREATED');
    expect(await outcomeOf(pathaoAdapter.createShipment(withRecipient({ name: 'Al' }), {}))).toBe('NOT_CREATED');
    expect(
      await outcomeOf(
        pathaoAdapter.createShipment(withRecipient({ detailedAddress: 'H1', wardUnitName: '', areaUnitName: '', district: '' }), {}),
      ),
    ).toBe('NOT_CREATED');
    delete process.env.PATHAO_PASSWORD;
    resetEnvCache();
    expect(await outcomeOf(pathaoAdapter.createShipment(SAMPLE_REQUEST, {}))).toBe('NOT_CREATED');
    expect(calls.filter((c) => c.url.endsWith('/orders'))).toHaveLength(0);
  });

  it('login failed or Pathao unreachable during login: NOT_CREATED (the order was never sent)', async () => {
    tokenResponses = [{ status: 500, body: {} }];
    expect(await outcomeOf(pathaoAdapter.createShipment(SAMPLE_REQUEST, {}))).toBe('NOT_CREATED');

    resetPathaoTokenCache();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    expect(await outcomeOf(pathaoAdapter.createShipment(SAMPLE_REQUEST, {}))).toBe('NOT_CREATED');
  });

  it('Pathao rejected the order (422): NOT_CREATED, so a retry is safe', async () => {
    orderResponse = { status: 422, body: { message: 'Invalid', errors: { recipient_phone: ['Invalid phone.'] } } };
    expect(await outcomeOf(pathaoAdapter.createShipment(SAMPLE_REQUEST, {}))).toBe('NOT_CREATED');
  });

  it('the order got no definite answer (5xx, 200 without an id, timeout): UNKNOWN', async () => {
    orderResponse = { status: 502, body: {} };
    expect(await outcomeOf(pathaoAdapter.createShipment(SAMPLE_REQUEST, {}))).toBe('UNKNOWN');

    orderResponse = { status: 200, body: { data: {} } };
    expect(await outcomeOf(pathaoAdapter.createShipment(SAMPLE_REQUEST, {}))).toBe('UNKNOWN');

    orderResponse = null;
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/orders')) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return original(url, init);
    });
    expect(await outcomeOf(pathaoAdapter.createShipment(SAMPLE_REQUEST, {}))).toBe('UNKNOWN');
  });

  it('an unknown status slug is flagged unrecognizedStatus, so sync marks it "needs attention"', async () => {
    infoSlug = 'brand_new_slug';
    const err = (await pathaoAdapter.trackShipment('DT0310267F2RGX', {}).catch((e: unknown) => e)) as CourierCallError;
    expect(err.unrecognizedStatus).toBe(true);
  });

  it("tracking reports Pathao's merchant_order_id so a hand-linked parcel can be verified", async () => {
    const t = await pathaoAdapter.getShipmentDetails('DT0310267F2RGX', {});
    expect(t.merchantReference).toBe('X');
  });
});
