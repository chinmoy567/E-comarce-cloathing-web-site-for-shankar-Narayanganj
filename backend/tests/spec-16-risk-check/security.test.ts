import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.ts';
import { UpstreamError } from '../../src/lib/errors.ts';
import { makeSyncFakeAdapter } from '../spec-15-tracking/helpers/syncFakeAdapter.ts';
import { RESPONSE_KEYS, startRiskSuite, type RiskSuite } from './helpers/riskFixture.ts';

/**
 * Risk-check security properties (implementation spec 16, tests 8, 9, 16; acceptance 11, 13, 14,
 * 17; 09-fraud-risk-check §7.3, §7.4, §7.6, §7.8, §7.9; 02-customer §2.9.6; 04-courier §4.16).
 *
 *  - raw_result never escapes: exact response key set + a provider marker present in the stored
 *    raw_result but absent from every response.
 *  - outbound minimality: the REAL bdCourierProvider runs end to end (HTTP -> service -> adapter);
 *    only safeFetch (the SSRF-guarded network boundary) is mocked, and the captured request body
 *    must be exactly {phone}. The customer and order carry distinctive email / name / address /
 *    internal-note values that must appear nowhere in the captured request.
 *  - risk data is absent from every customer-facing payload: guest lookup, Track Order, customer
 *    order detail and history, asserted by exact key set AND by a recursive key/value scan after a
 *    HIGH result with a provider marker exists for that very customer.
 *
 * The provider body is shaped only from the adapter's documented contract (see
 * provider-mapping.unit.test.ts), plus one explicitly synthetic marker field to prove raw
 * passthrough is contained. No recorded official payload is claimed.
 */
const SCHEMA = 'spec16_security';
const API_KEY = 'TEST-ONLY-BDCOURIER-KEY-5e9a21';
const BASE = 'https://courier.example.test/api';
const MARKER = 'PROVIDER-RAW-MARKER-9c41';
const CUSTOMER_PASSWORD = 'CustomerPass12';

const safeFetchMock = vi.fn();
vi.mock('../../src/lib/safeFetch.ts', () => ({ safeFetch: (...args: unknown[]) => safeFetchMock(...args) }));

const providerBody = (level: string, summary: Record<string, unknown> = { total_parcel: 10, success_parcel: 2, cancelled_parcel: 8, success_ratio: 20 }) => ({
  status: 'success',
  data: { summary, syntheticProviderOnly: MARKER },
  risk_verdict: { level },
});
const respond = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

const keysDeep = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      out.push(k);
      keysDeep(val, out);
    }
  }
  return out;
};

const GUEST_KEYS = [
  'amounts', 'appliedCouponCode', 'deliveryAddressSummary', 'found', 'items', 'orderNumber', 'orderStatus', 'paymentMethod',
  'paymentResubmissionAllowed', 'paymentStatus', 'placedAt', 'shipment', 'shipmentStatus', 'statusHistory',
];
const TRACK_KEYS = ['courierName', 'courierTrackingUrl', 'deliveryAreaSummary', 'estimatedDeliveryAt', 'events', 'found', 'shipmentStatus', 'trackingId'];
const DETAIL_KEYS = [...GUEST_KEYS.filter((k) => k !== 'found'), 'deliveryAddress', 'trackOrder'].sort();
const HISTORY_ROW_KEYS = ['itemCount', 'orderNumber', 'orderStatus', 'paymentMethod', 'paymentStatus', 'placedAt', 'shipmentStatus', 'totalAmount'];

describe.skipIf(!TEST_DATABASE_URL)('risk check security (spec 16)', () => {
  let s: RiskSuite;
  const trackFake = makeSyncFakeAdapter('riskfake');

  beforeAll(async () => {
    s = await startRiskSuite(SCHEMA, { BD_COURIER_API_KEY: API_KEY, BD_COURIER_BASE_URL: BASE });
    // Use the REAL BD Courier adapter (only safeFetch is mocked).
    (await import('../../src/services/fraud/providers/registry.js')).setRiskProvider();
    (await import('../../src/services/courier/registry.js')).registerAdapter(trackFake);
    await s.q(`INSERT INTO couriers (code, name, adapter_key, display_order) VALUES ('FAKERISK','Fake Risk Courier','riskfake',100)`);
  }, 120_000);

  afterAll(async () => {
    (await import('../../src/services/courier/registry.js')).unregisterAdapter();
    await s?.teardown();
  });

  beforeEach(() => {
    safeFetchMock.mockReset();
    safeFetchMock.mockImplementation(async () => respond(providerBody('danger')));
    trackFake.reset();
  });

  describe('raw_result never escapes (test 8; acceptance 11; §7.6, §7.8)', () => {
    it('POST and GET return exactly the 13 documented fields; the provider marker is stored in raw_result but absent from both responses', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      const post = await a.post(s.url(o.orderNumber)).send({});
      const get = await a.agent.get(s.url(o.orderNumber));

      expect(post.status).toBe(200);
      expect(post.body.data).toMatchObject({ riskLevel: 'HIGH', totalOrders: 10, successfulOrders: 2, returnedOrders: 8, successRatePercent: 20 });
      for (const res of [post, get]) {
        expect(Object.keys(res.body.data).sort()).toEqual(RESPONSE_KEYS);
        const text = JSON.stringify(res.body);
        for (const leaked of [MARKER, 'syntheticProviderOnly', 'raw_result', 'rawResult', 'raw', 'risk_verdict', 'summary', 'total_parcel', 'danger', 'BD_COURIER']) {
          expect(text, `leaked ${leaked}`).not.toContain(leaked);
        }
      }
      const [row] = await s.riskRows(c.id);
      expect(JSON.stringify(row.raw_result)).toContain(MARKER);
      expect(row.provider).toBe('BD_COURIER');
    });

    it('the key set also holds for UNKNOWN, CHECK_FAILED and never-checked responses', async () => {
      const a = await s.admin();
      const never = await s.newOrder((await s.newCustomer()).id);
      expect(Object.keys((await a.agent.get(s.url(never.orderNumber))).body.data).sort()).toEqual(RESPONSE_KEYS);

      const noHistory = await s.newOrder((await s.newCustomer()).id);
      safeFetchMock.mockImplementation(async () => respond(providerBody('safe', { total_parcel: 0 })));
      const nh = await a.post(s.url(noHistory.orderNumber)).send({});
      expect(Object.keys(nh.body.data).sort()).toEqual(RESPONSE_KEYS);
      expect(nh.body.data).toMatchObject({ riskLevel: 'UNKNOWN', message: 'No courier history found.' });

      const failed = await s.newOrder((await s.newCustomer()).id);
      safeFetchMock.mockImplementation(async () => respond({ oops: MARKER }, 500));
      const f = await a.post(s.url(failed.orderNumber)).send({});
      expect(Object.keys(f.body.data).sort()).toEqual(RESPONSE_KEYS);
      expect(f.body.data.riskLevel).toBe('CHECK_FAILED');
      expect(JSON.stringify(f.body)).not.toContain(MARKER);
    });

    it('an error response carries no raw payload either (409 / 404 bodies are plain error envelopes)', async () => {
      const a = await s.admin();
      const cancelled = await s.newOrder((await s.newCustomer()).id, { status: 'CANCELLED' });
      const res = await a.post(s.url(cancelled.orderNumber)).send({});
      expect(res.body.error).toMatchObject({ code: 'RISK_CHECK_NOT_ALLOWED' });
      expect(JSON.stringify(res.body)).not.toMatch(/raw|BD_COURIER|summary/);
    });

    it('source scan: the display projection never selects raw_result, there is no SELECT * path, and getRaw has no caller outside the repository', () => {
      const root = fileURLToPath(new URL('../../src/', import.meta.url));
      const repo = readFileSync(join(root, 'repositories/customerRiskChecks.repository.ts'), 'utf8');
      const display = /const DISPLAY_COLUMNS = `([^`]*)`/.exec(repo)?.[1] ?? '';
      expect(display.length).toBeGreaterThan(0);
      expect(display).not.toMatch(/raw_result|\*/);
      const code = repo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/SELECT\s+\*|\bc\.\*|RETURNING\s+\*/i);

      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else if (/\.ts$/.test(name) && !p.endsWith('customerRiskChecks.repository.ts') && /\bgetRaw\b/.test(readFileSync(p, 'utf8'))) offenders.push(p);
        }
      };
      walk(root);
      expect(offenders).toEqual([]);
    });
  });

  describe('outbound minimality (test 9; acceptance 14; §7.9)', () => {
    it('the captured request body is exactly {phone: <normalized phone>}; no email, name, address, order content, note or customer id leaves the platform', async () => {
      const c = await s.newCustomer({ name: 'Distinct Customer Name', email: 'distinct.person@example.com' });
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      expect((await a.post(s.url(o.orderNumber)).send({})).status).toBe(200);

      expect(safeFetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = safeFetchMock.mock.calls[0]!;
      expect(url).toBe(`${BASE}/courier-check`);
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ phone: c.phone });
      expect(Object.keys(JSON.parse(opts.body))).toHaveLength(1);

      const everything = JSON.stringify([url, opts]);
      for (const forbidden of [
        'Distinct Customer Name', 'distinct.person@example.com', 'House 99', 'Secret Lane', 'Gulshan', 'ADMIN-ONLY-NOTE', o.orderNumber, o.id, c.id,
        'password', 'otp', 'csrf', 'cookie', 'admin_at', 'admin_rt', 'COD',
      ]) {
        expect(everything.toLowerCase(), `outbound contains ${forbidden}`).not.toContain(forbidden.toLowerCase());
      }
      expect(Object.keys(opts.headers).sort()).toEqual(['Authorization', 'Content-Type']);
    });

    it('the admin session credentials are not forwarded: the Authorization header is the provider key, not the admin token', async () => {
      const o = await s.newOrder((await s.newCustomer()).id);
      const a = await s.admin();
      await a.post(s.url(o.orderNumber)).send({});
      const [, opts] = safeFetchMock.mock.calls[0]!;
      expect(opts.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    });

    it('a status-gated or unpermitted request makes no outbound call at all', async () => {
      const a = await s.admin();
      const cancelled = await s.newOrder((await s.newCustomer()).id, { status: 'CANCELLED' });
      await a.post(s.url(cancelled.orderNumber)).send({});
      await request(s.app).post(s.url(cancelled.orderNumber)).send({});
      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it('GET (opening the order page) makes no outbound call, with or without a stored result', async () => {
      const a = await s.admin();
      const o = await s.newOrder((await s.newCustomer()).id);
      await a.agent.get(s.url(o.orderNumber));
      await a.post(s.url(o.orderNumber)).send({});
      safeFetchMock.mockClear();
      await a.agent.get(s.url(o.orderNumber));
      await a.agent.get(s.url(o.orderNumber));
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });

  describe('the API key never leaves the server (acceptance 13; §7.4)', () => {
    it.each([
      ['success', async () => respond(providerBody('low'))],
      ['HTTP 500 echoing the key', async () => respond({ error: `bad key ${API_KEY}` }, 500)],
      ['network error naming the key', async () => { throw new Error(`connect failed Bearer ${API_KEY}`); }],
      ['SSRF-guard rejection', async () => { throw new UpstreamError('The external service could not be reached.', undefined, 'UPSTREAM_UNREACHABLE'); }],
    ])('%s: the key is in no response, no stored row and no audit row', async (_name, impl) => {
      safeFetchMock.mockImplementation(impl);
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      const post = await a.post(s.url(o.orderNumber)).send({});
      const get = await a.agent.get(s.url(o.orderNumber));
      const rows = await s.q(`SELECT to_jsonb(r) AS j FROM customer_risk_checks r WHERE customer_id=$1`, [c.id]);
      const audit = await s.q(`SELECT to_jsonb(a) AS j FROM audit_logs a WHERE entity_id=$1`, [o.id]);
      for (const blob of [post.text, get.text, JSON.stringify(rows), JSON.stringify(audit)]) expect(blob).not.toContain(API_KEY);
    });

    it('source scan: the key variable names appear nowhere in the frontend bundle sources (acceptance 13: grep -ri BD_COURIER frontend/, tests excluded)', () => {
      const frontend = fileURLToPath(new URL('../../../frontend/', import.meta.url));
      if (!existsSync(frontend)) return;
      // `tests/` is excluded: the frontend's own tests may NAME the string in order to forbid it.
      const skip = new Set(['node_modules', '.next', '.git', 'coverage', 'out', 'dist', 'tests']);
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          if (skip.has(name)) continue;
          const p = join(dir, name);
          const st = statSync(p);
          if (st.isDirectory()) walk(p);
          else if (st.size < 2_000_000 && /\.(ts|tsx|js|jsx|mjs|cjs|json|env|md|css)$/i.test(name) && /BD_COURIER/i.test(readFileSync(p, 'utf8'))) hits.push(p);
        }
      };
      walk(frontend);
      expect(hits).toEqual([]);
    });

    it('source scan: the risk service never imports the courier shipment services, nor they it (§7.3: separate modules)', () => {
      const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), 'utf8');
      expect(src('services/fraud/customerRiskService.ts')).not.toMatch(/from\s+['"][^'"]*services\/courier|from\s+['"]\.\.\/courier\//);
      for (const f of ['services/shipment.service.ts', 'services/courierSync.service.ts', 'services/shipmentSync.service.ts', 'services/shipmentStatus.service.ts']) {
        expect(src(f), f).not.toMatch(/fraud\//);
      }
    });
  });

  describe('risk data is absent from customer-facing payloads (test 16; acceptance 17; §2.9.6, §4.16)', () => {
    const FORBIDDEN_KEY = /risk|raw|provider|score|verdict|checked_?by|parcel/i;
    const FORBIDDEN_TEXT = ['riskLevel', 'risk_level', 'HIGH', 'danger', 'BD_COURIER', MARKER, 'syntheticProviderOnly', 'customer_risk', 'cancelled_parcel', 'successRatePercent'];

    let phoneSeq = 0;
    async function setup() {
      phoneSeq += 1;
      const phone = `0179999${String(phoneSeq).padStart(4, '0')}`;
      const agent = request.agent(s.app);
      expect((await agent.post('/api/customer/auth/register').send({ phone_number: phone, password: CUSTOMER_PASSWORD })).status).toBe(201);
      expect((await agent.post('/api/customer/auth/login').send({ phone_number: phone, password: CUSTOMER_PASSWORD })).status).toBe(200);
      const [{ id: customerId }] = await s.q(`SELECT id FROM customers WHERE phone_number=$1 AND account_type='REGISTERED'`, [phone]);
      const o = await s.newOrder(customerId, { status: 'PROCESSING' });
      await s.q(`UPDATE orders SET phone_number=$2 WHERE id=$1`, [o.id, phone]);
      const parcel = `TEST-ONLY-RISK-PARCEL-${phoneSeq}`;
      await s.q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id) VALUES ($1,'IN_TRANSIT','FAKERISK',$2)`, [o.id, parcel]);

      // A HIGH result with provider payload now exists for this very customer.
      const a = await s.admin();
      const post = await a.post(s.url(o.orderNumber)).send({});
      expect(post.body.data.riskLevel).toBe('HIGH');
      expect(await s.riskRows(customerId)).toHaveLength(1);
      return { agent, o, phone, parcel };
    }

    const assertClean = (label: string, body: unknown) => {
      const keys = keysDeep(body);
      expect(keys.filter((k) => FORBIDDEN_KEY.test(k)), `${label}: risk-shaped keys`).toEqual([]);
      const text = JSON.stringify(body);
      for (const t of FORBIDDEN_TEXT) expect(text, `${label} contains ${t}`).not.toContain(t);
    };

    it('guest lookup (POST /api/orders/lookup): exact §2.9.6 key set and no risk key/value anywhere', async () => {
      const { o, phone } = await setup();
      const res = await request(s.app).post('/api/orders/lookup').send({ orderNumber: o.orderNumber, phoneNumber: phone });
      expect(res.status).toBe(200);
      expect(res.body.data.found).toBe(true);
      expect(Object.keys(res.body.data).sort()).toEqual(GUEST_KEYS);
      assertClean('guest lookup', res.body);
    });

    it('Track Order (POST /api/track-order): exact key set and no risk key/value anywhere', async () => {
      const { parcel } = await setup();
      const res = await request(s.app).post('/api/track-order').send({ trackingId: parcel });
      expect(res.status).toBe(200);
      expect(res.body.data.found).toBe(true);
      expect(Object.keys(res.body.data).sort()).toEqual(TRACK_KEYS);
      assertClean('track order', res.body);
    });

    it('customer order detail (GET /api/customer/orders/:orderNumber): exact key set and no risk key/value anywhere', async () => {
      const { agent, o } = await setup();
      const res = await agent.get(`/api/customer/orders/${o.orderNumber}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data).sort()).toEqual(DETAIL_KEYS);
      assertClean('customer order detail', res.body);
    });

    it('customer order history (GET /api/customer/orders): exact row key set and no risk key/value anywhere', async () => {
      const { agent } = await setup();
      const res = await agent.get('/api/customer/orders');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const row of res.body.data) expect(Object.keys(row).sort()).toEqual(HISTORY_ROW_KEYS);
      assertClean('customer order history', res.body);
    });
  });
});
