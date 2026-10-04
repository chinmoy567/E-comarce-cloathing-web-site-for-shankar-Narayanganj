import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiGet } from '../src/lib/apiClient';

process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:4000';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiClient (spec 01 §Frontend work)', () => {
  it('unwraps the ApiSuccess envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { data: { status: 'ok' } }));

    await expect(apiGet<{ status: string }>('/api/health')).resolves.toEqual({ status: 'ok' });
  });

  it('sends credentials so either session transport works', async () => {
    const fetchMock = mockFetch(200, { data: null });
    vi.stubGlobal('fetch', fetchMock);

    await apiGet('/api/health');

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('throws a typed ApiClientError carrying code, message and field details', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid fields.',
          details: [{ field: 'phone', message: 'Unrecognized field.' }],
        },
        requestId: 'req-1',
      }),
    );

    await expect(apiGet('/api/thing')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      requestId: 'req-1',
    });
  });

  it('exposes a per-field error message for rendering beside an input', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid fields.',
          details: [{ field: 'phone', message: 'Invalid phone number.' }],
        },
        requestId: 'req-2',
      }),
    );

    try {
      await apiGet('/api/thing');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).fieldError('phone')).toBe('Invalid phone number.');
    }
  });

  it('converts a network failure into a readable message, not a raw error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

    await expect(apiGet('/api/health')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('apiClient silent customer refresh (spec 08)', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('renews the session once on a 401, then replays the request', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/api/customer/auth/refresh')) return json(200, { data: { message: 'ok' } });
        return calls.filter((c) => c.endsWith('/api/customer/orders')).length === 1
          ? json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } })
          : json(200, { data: [{ orderNumber: 'A1' }] });
      }),
    );

    await expect(apiGet('/api/customer/orders')).resolves.toEqual([{ orderNumber: 'A1' }]);
    expect(calls.map((c) => c.replace('http://localhost:4000', ''))).toEqual([
      '/api/customer/orders',
      '/api/customer/auth/refresh',
      '/api/customer/orders',
    ]);
  });

  it('shares one refresh between parallel 401s (rotating tokens must not be refreshed twice)', async () => {
    let refreshes = 0;
    const seen = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/customer/auth/refresh')) {
          refreshes += 1;
          await new Promise((r) => setTimeout(r, 10));
          return json(200, { data: {} });
        }
        const n = (seen.get(url) ?? 0) + 1;
        seen.set(url, n);
        return n === 1 ? json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }) : json(200, { data: 'ok' });
      }),
    );

    await Promise.all([apiGet('/api/customer/orders'), apiGet('/api/cart'), apiGet('/api/wishlist')]);
    expect(refreshes).toBe(1);
  });

  it('gives up with the original 401 when the refresh fails, without looping', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/refresh')
        ? json(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired.' } })
        : json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/api/customer/orders')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never tries to refresh on the login, admin or recovery endpoints', async () => {
    const fetchMock = vi.fn(async () => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'bad' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/api/customer/auth/login')).rejects.toMatchObject({ status: 401 });
    await expect(apiGet('/api/admin/orders')).rejects.toMatchObject({ status: 401 });
    await expect(apiGet('/api/customer/auth/verify-otp')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
