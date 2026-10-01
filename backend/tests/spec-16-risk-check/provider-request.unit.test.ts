import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { UpstreamError } from '../../src/lib/errors.ts';

/**
 * BD Courier adapter, outbound side (implementation spec 16, test 9 and test 4's provider
 * half; acceptance 13, 14; 09-fraud-risk-check §7.3, §7.4, §7.9; security skill §6).
 *
 * S4, no database. safeFetch is mocked at the module boundary (the SSRF-guarded outbound
 * wrapper — a test must never reach BD Courier); the captured request is asserted exactly.
 * The wire contract (POST {BASE}/courier-check, Bearer key, body {phone}) is the one the
 * adapter documents for itself; the response bodies carry only the fields of that documented
 * contract, not recorded official payloads.
 */
const safeFetchMock = vi.fn();
vi.mock('../../src/lib/safeFetch.ts', () => ({ safeFetch: (...args: unknown[]) => safeFetchMock(...args) }));

const API_KEY = 'TEST-ONLY-BDCOURIER-KEY-81d3c7';
const BASE = 'https://courier.example.test/api';
const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const OK_BODY = { status: 'success', data: { summary: { total_parcel: 12, success_parcel: 10, cancelled_parcel: 2, success_ratio: 83 } }, risk_verdict: { level: 'low' } };

describe('bdCourierProvider.check (spec 16)', () => {
  let provider: typeof import('../../src/services/fraud/providers/bdCourierProvider.js').bdCourierProvider;

  async function configure(env: Record<string, string | undefined>) {
    applyTestEnv();
    delete process.env.BD_COURIER_API_KEY;
    delete process.env.BD_COURIER_BASE_URL;
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    resetEnvCache();
    ({ bdCourierProvider: provider } = await import('../../src/services/fraud/providers/bdCourierProvider.js'));
  }

  beforeEach(async () => {
    safeFetchMock.mockReset();
    await configure({ BD_COURIER_API_KEY: API_KEY, BD_COURIER_BASE_URL: BASE });
  });

  afterEach(() => {
    delete process.env.BD_COURIER_API_KEY;
    delete process.env.BD_COURIER_BASE_URL;
    resetEnvCache();
  });

  describe('outbound request (test 9; acceptance 14; §7.9)', () => {
    it('sends exactly one POST to {BASE}/courier-check whose body is exactly {"phone": <normalized phone>} and nothing else', async () => {
      safeFetchMock.mockResolvedValue(jsonResponse(OK_BODY));
      await provider.check('01712345678');

      expect(safeFetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = safeFetchMock.mock.calls[0]!;
      expect(url).toBe(`${BASE}/courier-check`);
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ phone: '01712345678' });
      expect(Object.keys(JSON.parse(opts.body))).toEqual(['phone']);
    });

    it('carries the key only in the Authorization header (Bearer), never in the URL or body', async () => {
      safeFetchMock.mockResolvedValue(jsonResponse(OK_BODY));
      await provider.check('01712345678');
      const [url, opts] = safeFetchMock.mock.calls[0]!;
      expect(Object.keys(opts.headers).sort()).toEqual(['Authorization', 'Content-Type']);
      expect(opts.headers.Authorization).toBe(`Bearer ${API_KEY}`);
      expect(url).not.toContain(API_KEY);
      expect(opts.body).not.toContain(API_KEY);
    });

    it('allowlists exactly the host of BD_COURIER_BASE_URL (SSRF guard input, not a wildcard) and bounds the call', async () => {
      safeFetchMock.mockResolvedValue(jsonResponse(OK_BODY));
      await provider.check('01712345678');
      const [, opts] = safeFetchMock.mock.calls[0]!;
      expect(opts.allowedHosts).toEqual(['courier.example.test']);
      expect(opts.timeoutMs).toBeGreaterThan(0);
      expect(opts.timeoutMs).toBeLessThanOrEqual(10_000);
      expect(opts.maxResponseBytes).toBeGreaterThan(0);
      expect(opts.maxResponseBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    });

    it('tolerates a trailing slash on the base URL', async () => {
      await configure({ BD_COURIER_API_KEY: API_KEY, BD_COURIER_BASE_URL: `${BASE}///` });
      safeFetchMock.mockResolvedValue(jsonResponse(OK_BODY));
      await provider.check('01712345678');
      expect(safeFetchMock.mock.calls[0]![0]).toBe(`${BASE}/courier-check`);
    });

    it('maps a successful answer to the result (end to end through the adapter)', async () => {
      safeFetchMock.mockResolvedValue(jsonResponse(OK_BODY));
      expect(await provider.check('01712345678')).toMatchObject({ riskLevel: 'LOW', riskScore: null, totalOrders: 12, successfulOrders: 10, returnedOrders: 2 });
    });
  });

  describe('configuration (§7.4)', () => {
    it('isConfigured() reflects the presence of BD_COURIER_API_KEY', async () => {
      expect(provider.isConfigured()).toBe(true);
      await configure({ BD_COURIER_BASE_URL: BASE });
      expect(provider.isConfigured()).toBe(false);
    });

    it('without a key, check() fails with RiskProviderError and makes no outbound call', async () => {
      await configure({ BD_COURIER_BASE_URL: BASE });
      await expect(provider.check('01712345678')).rejects.toMatchObject({ name: 'RiskProviderError', message: 'Risk provider is not configured.' });
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });

  describe('provider failures surface as RiskProviderError with sanitised detail (test 4; §7.8)', () => {
    it('a timeout / unreachable provider (UpstreamError from safeFetch)', async () => {
      safeFetchMock.mockRejectedValue(new UpstreamError('The external service could not be reached.', undefined, 'UPSTREAM_UNREACHABLE'));
      await expect(provider.check('01712345678')).rejects.toMatchObject({
        name: 'RiskProviderError',
        message: 'Risk provider could not be reached.',
        detail: { reason: 'UPSTREAM_UNREACHABLE' },
      });
    });

    it('an unexpected thrown value is still a RiskProviderError', async () => {
      safeFetchMock.mockRejectedValue(new Error(`socket hang up Bearer ${API_KEY}`));
      const err = await provider.check('01712345678').catch((e: unknown) => e);
      expect(err).toMatchObject({ name: 'RiskProviderError', message: 'Risk provider could not be reached.' });
    });

    it.each([500, 502, 503, 401, 429])('HTTP %i is a RiskProviderError carrying only the status', async (status) => {
      safeFetchMock.mockResolvedValue(jsonResponse({ error: `upstream said ${API_KEY}` }, status));
      const err = await provider.check('01712345678').catch((e: unknown) => e);
      expect(err).toMatchObject({ name: 'RiskProviderError', message: 'Risk provider returned an error status.', detail: { httpStatus: status } });
    });

    it('a non-JSON body is a RiskProviderError', async () => {
      safeFetchMock.mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }));
      await expect(provider.check('01712345678')).rejects.toMatchObject({ name: 'RiskProviderError', message: 'Risk provider returned a non-JSON response.' });
    });

    it('a well-formed JSON body of the wrong shape is a RiskProviderError (status != success)', async () => {
      safeFetchMock.mockResolvedValue(jsonResponse({ status: 'error', message: 'quota exceeded' }));
      await expect(provider.check('01712345678')).rejects.toMatchObject({ name: 'RiskProviderError' });
    });

    it('no failure message or detail ever contains the API key (acceptance 13)', async () => {
      const failures: Array<() => void> = [
        () => safeFetchMock.mockRejectedValue(new Error(`boom ${API_KEY}`)),
        () => safeFetchMock.mockResolvedValue(jsonResponse({ detail: API_KEY }, 500)),
        () => safeFetchMock.mockResolvedValue(new Response(API_KEY, { status: 200 })),
        () => safeFetchMock.mockResolvedValue(jsonResponse({ status: 'error', message: API_KEY })),
      ];
      for (const arm of failures) {
        arm();
        const err = (await provider.check('01712345678').catch((e: unknown) => e)) as { message: string; detail?: unknown };
        expect(JSON.stringify({ message: err.message, detail: err.detail })).not.toContain(API_KEY);
      }
    });
  });
});
