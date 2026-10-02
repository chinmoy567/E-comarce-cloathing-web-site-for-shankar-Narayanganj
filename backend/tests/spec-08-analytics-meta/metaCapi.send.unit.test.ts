/**
 * Spec 18 — the real CAPI request (08-analytics-meta §6.5, §6.6, §6.8). safeFetch and the
 * log repository are stubbed; assertions are on what would leave the platform.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestEnv } from '../helpers/testEnv.ts';

applyTestEnv();

const safeFetch = vi.fn();
const createMetaEventLog = vi.fn(async () => undefined);
const updateMetaEventLogOutcome = vi.fn(async () => undefined);

vi.mock('../../src/lib/safeFetch.js', () => ({ safeFetch }));
vi.mock('../../src/lib/transaction.js', () => ({ withTransaction: async (fn: (c: unknown) => unknown) => fn({}) }));
vi.mock('../../src/repositories/analytics.repository.js', () => ({ createMetaEventLog, updateMetaEventLogOutcome }));

const { sendMetaCapiEvent, DEFAULT_GRAPH_API_VERSION } = await import('../../src/services/analytics/metaCapi.js');
const { resetEnvCache } = await import('../../src/config/env.js');

const payload = {
  event_name: 'AddToCart',
  event_id: '11111111-1111-4111-8111-111111111111',
  event_time: 1_700_000_000,
  event_source_url: 'https://fabrillke.com/product/x',
  value: 1000,
  currency: 'BDT',
} as never;

function configure(extra: Record<string, string | undefined> = {}) {
  process.env.META_PIXEL_ID = '123456789';
  process.env.META_CAPI_ACCESS_TOKEN = 'SECRET-TOKEN';
  delete process.env.META_GRAPH_API_VERSION;
  Object.assign(process.env, extra);
  resetEnvCache();
}

beforeEach(() => {
  vi.clearAllMocks();
  configure();
});

describe('sendMetaCapiEvent', () => {
  it('posts once to graph.facebook.com with a supported version, token in the body only, and action_source=website', async () => {
    safeFetch.mockResolvedValue({ ok: true, status: 200 });
    await sendMetaCapiEvent(payload, {}, {});

    expect(safeFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = safeFetch.mock.calls[0] as unknown as [string, { body: string; allowedHosts: string[] }];
    expect(url).toBe(`https://graph.facebook.com/${DEFAULT_GRAPH_API_VERSION}/123456789/events`);
    expect(url).not.toContain('SECRET-TOKEN');
    expect(Number(DEFAULT_GRAPH_API_VERSION.slice(1, -2))).toBeGreaterThanOrEqual(25);
    expect(opts.allowedHosts).toEqual(['graph.facebook.com']);

    const body = JSON.parse(opts.body);
    expect(body.access_token).toBe('SECRET-TOKEN');
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ event_name: 'AddToCart', action_source: 'website', event_id: payload.event_id });
    expect(body.data[0].custom_data.currency).toBe('BDT');
    expect(createMetaEventLog).toHaveBeenCalledWith({}, expect.objectContaining({ status: 'SENT', http_status: 200 }));
  });

  it('honours META_GRAPH_API_VERSION', async () => {
    configure({ META_GRAPH_API_VERSION: 'v27.0' });
    safeFetch.mockResolvedValue({ ok: true, status: 200 });
    await sendMetaCapiEvent(payload, {}, {});
    expect((safeFetch.mock.calls[0] as unknown as [string])[0]).toContain('/v27.0/');
  });

  it.each([
    ['a 500', () => safeFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })],
    ['a timeout', () => safeFetch.mockRejectedValue(new Error('timeout'))],
  ])('never throws and never retries on %s (§6.8)', async (_n, arrange) => {
    arrange();
    await expect(sendMetaCapiEvent(payload, {}, {})).resolves.toBeUndefined();
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(createMetaEventLog).toHaveBeenCalledWith({}, expect.objectContaining({ status: 'FAILED' }));
  });

  it('records SKIPPED and makes no request without configuration', async () => {
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_ACCESS_TOKEN;
    resetEnvCache();
    await sendMetaCapiEvent(payload, {}, {});
    expect(safeFetch).not.toHaveBeenCalled();
    expect(createMetaEventLog).toHaveBeenCalledWith({}, expect.objectContaining({ status: 'SKIPPED' }));
  });
});
